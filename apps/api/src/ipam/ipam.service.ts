/**
 * Katalog IPAM — podsieci.
 *
 * Cała logika zakresów jest w `cidr.ts`; serwis tylko składa z niego
 * reguły katalogu: dwa zapisy nie mogą obejmować tego samego zakresu,
 * węższy CIDR nie może zostawić adresów poza podsiecią, a każdy zapis
 * idzie do dziennika. Dialogi z bazą idą przez port (`ipam.port.ts`),
 * dzięki czemu testy nie podnoszą Postgresa.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/decorators';
import {
  cidrErrorMessage,
  ipInCidr,
  ipToNumber,
  isValidIpv4,
  parseCidr,
  rangesOverlap,
  type Cidr,
} from './cidr';
import type {
  CreateAddressDto,
  CreateSubnetDto,
  SetApplicationIpAddressesDto,
  UpdateAddressDto,
  UpdateSubnetDto,
} from './dto/ipam.dto';
import type {
  ApplicationIpAddressRef,
  ApplicationRefRow,
  IpAddressCreateData,
  IpAddressRow,
  IpAddressUpdateData,
  SubnetCreateData,
  SubnetDetail,
  SubnetRow,
  SubnetUpdateData,
  SubnetWithCounts,
} from './ipam.port';

/**
 * Typ odpowiedzi karty aplikacji jest zdefiniowany przy porcie (tam leżą
 * pozostałe kontrakty odpowiedzi), a wystawiamy go jeszcze raz przy
 * serwisie — to serwis jest tym, co kontroler wystawia w trasie.
 */
export type { ApplicationIpAddressRef } from './ipam.port';

@Injectable()
export class IpamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Podsieci ────────────────────────────────────────────────

  async listSubnets(): Promise<SubnetWithCounts[]> {
    // `applicationCount` liczy ADRESY z co najmniej jednym przypisaniem,
    // nie pary adres–aplikacja — VIP obsługujący trzy aplikacje to
    // w podsumowaniu jeden zajęty adres, nie trzy.
    // Trzy zbiorcze odczyty, nie zapytanie per podsieć: katalog jest mały,
    // a liczniki i tak składamy w pamięci (kolizje też sprawdzamy po
    // całości — baza nie ma indeksu na zakres).
    const [podsieci, adresy, przypisania] = await Promise.all([
      this.prisma.subnet.findMany(),
      this.prisma.ipAddress.findMany(),
      this.prisma.applicationIpAddress.findMany(),
    ]);

    const przypisaneAdresy = new Set(przypisania.map((p) => p.ipAddressId));
    // W mapie tylko trójka liczników — wiersz doklejamy niżej, przy mapowaniu.
    const liczniki = new Map<
      string,
      { addressCount: number; applicationCount: number; freeCount: number }
    >();
    for (const adres of adresy) {
      const licznik = liczniki.get(adres.subnetId) ?? {
        addressCount: 0,
        applicationCount: 0,
        freeCount: 0,
      };
      licznik.addressCount += 1;
      if (adres.status === 'FREE') licznik.freeCount += 1;
      if (przypisaneAdresy.has(adres.id)) licznik.applicationCount += 1;
      liczniki.set(adres.subnetId, licznik);
    }

    // Kolejność jak w `sortCidrs` (sieć, potem prefiks), a przy tych samych
    // bitach alfabetycznie po nazwie. Wiersz, którego CIDR nie da się
    // sparsować (ręczna edycja w bazie), ląduje na końcu: `Infinity`
    // daje porównanie „najgorszy”, a `NaN` z `Infinity - Infinity`
    // przechodzi dalej do nazwy — bez specjalnego przypadku.
    const uporządkowane = podsieci.map((row) => ({ row, cidr: parseCidr(row.cidr) }));
    uporządkowane.sort((a, b) => {
      const networkA = a.cidr?.network ?? Number.POSITIVE_INFINITY;
      const networkB = b.cidr?.network ?? Number.POSITIVE_INFINITY;
      const prefixA = a.cidr?.prefix ?? Number.POSITIVE_INFINITY;
      const prefixB = b.cidr?.prefix ?? Number.POSITIVE_INFINITY;
      return (
        networkA - networkB ||
        prefixA - prefixB ||
        a.row.name.localeCompare(b.row.name, 'pl')
      );
    });

    return uporządkowane.map(({ row }) => ({
      ...row,
      ...(liczniki.get(row.id) ?? {
        addressCount: 0,
        applicationCount: 0,
        freeCount: 0,
      }),
    }));
  }

  async getSubnet(id: string): Promise<SubnetDetail> {
    const subnet = await this.prisma.subnet.findUnique({ where: { id } });
    if (!subnet) throw new NotFoundException('Podsieć nie istnieje.');
    return this.toDetail(subnet);
  }

  async createSubnet(
    dto: CreateSubnetDto,
    actor: AuthUser,
    ip?: string,
  ): Promise<SubnetDetail> {
    const cidr = parseCidr(dto.cidr);
    if (!cidr) {
      // Komunikat DOKŁADNIE z `cidrErrorMessage` — to samo zdanie co w DTO,
      // bez otoczki serwisu (dwa źródła prawdy o jednym błędzie).
      throw new BadRequestException(
        cidrErrorMessage(dto.cidr) ?? 'Wpisz adres sieci w formacie CIDR.',
      );
    }

    await this.assertZakresWolny(cidr, null);

    // Zapisujemy znormalizowany `cidr.text`, nie surowe `dto.cidr` —
    // decyzja z przeglądu Task 4: '10.20.0.0/016' i '10.20.0.0/16' to ten
    // sam zakres, a przy surowym tekście kontrola kolizji i unikalność
    // widziałyby dwa różne wiersze dla jednej sieci.
    const dane: SubnetCreateData = {
      name: dto.name,
      cidr: cidr.text,
      description: dto.description ?? null,
      // Jawnie, choć schemat ma `@default("slate")`: wiersz z `create`
      // wraca do odpowiedzi i musi mieć wypełnione pola bez drugiego odczytu.
      color: dto.color ?? 'slate',
      vlan: dto.vlan ?? null,
      location: dto.location ?? null,
    };
    const created = await this.prisma.subnet.create({ data: dane });

    await this.audit.record({
      action: 'subnet.created',
      entity: 'Subnet',
      entityId: created.id,
      actorId: actor.id,
      actorName: actor.username,
      changes: {
        name: { from: null, to: created.name },
        cidr: { from: null, to: created.cidr },
      },
      ip,
    });

    return { ...created, addresses: [] };
  }

  async updateSubnet(
    id: string,
    dto: UpdateSubnetDto,
    actor: AuthUser,
    ip?: string,
  ): Promise<SubnetDetail> {
    const before = await this.prisma.subnet.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Podsieć nie istnieje.');

    // PATCH: `undefined` znaczy „nie ruszaj pola”, więc pola doklejamy
    // warunkowo — puste `data` odrzuciłby sam Prisma.
    const dane: SubnetUpdateData = {};
    if (dto.name !== undefined) dane.name = dto.name;
    if (dto.description !== undefined) dane.description = dto.description;
    if (dto.color !== undefined) dane.color = dto.color;
    if (dto.vlan !== undefined) dane.vlan = dto.vlan;
    if (dto.location !== undefined) dane.location = dto.location;

    if (dto.cidr !== undefined) {
      const cidr = parseCidr(dto.cidr);
      if (!cidr) {
        throw new BadRequestException(
          cidrErrorMessage(dto.cidr) ?? 'Wpisz adres sieci w formacie CIDR.',
        );
      }

      // Wszystkie sprawdzenia — format, kolizja, objęcie adresów — kończą
      // robotę ZANIM cokolwiek zapiszemy. Częściowo zastosowany PATCH
      // (nazwa wpisana, CIDR odrzucony) byłby gorszy niż brak PATCH-u.
      await this.assertZakresWolny(cidr, id);

      const adresy = await this.prisma.ipAddress.findMany({
        where: { subnetId: id },
      });
      const poza = adresy.filter((a) => !ipInCidr(a.address, cidr));
      if (poza.length > 0) {
        throw new BadRequestException(
          `Nowy zakres (${cidr.text}) nie obejmuje adresów: ` +
            `${poza.map((a) => a.address).join(', ')}. ` +
            'Przenieś lub usuń je przed zmianą podsieci.',
        );
      }

      // Normalizacja jak w `createSubnet` — patrz komentarz tam.
      dane.cidr = cidr.text;
    }

    if (Object.keys(dane).length === 0) {
      // Pusty PATCH nie woła `update` (Prisma wymaga co najmniej jednego
      // pola) i nie pisze dziennika — nic się nie zmieniło.
      return this.toDetail(before);
    }

    const after = await this.prisma.subnet.update({ where: { id }, data: dane });
    await this.audit.record({
      action: 'subnet.updated',
      entity: 'Subnet',
      entityId: id,
      actorId: actor.id,
      actorName: actor.username,
      changes: AuditService.diff(
        before as unknown as Record<string, unknown>,
        after as unknown as Record<string, unknown>,
        ['updatedAt', 'createdAt', 'addresses'],
      ),
      ip,
    });

    return this.toDetail(after);
  }

  async removeSubnet(id: string, actor: AuthUser, ip?: string): Promise<void> {
    const before = await this.prisma.subnet.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Podsieć nie istnieje.');

    // Kasowanie i wpis do dziennika w jednej transakcji — wzorzec
    // `deleteDemoData`: podsieć skasowana bez śladu w audycie byłaby
    // nie do odtworzenia. Adresy i przypisania znikają kaskadą FK
    // (`onDelete: Cascade` w schemacie), więc serwis kasuje tylko
    // wiersz `Subnet`. Jeden wpis zbiorczy, nie osobne zdarzenia
    // na adres: dziennik ma odpowiadać „co się stało”, nie dublować.
    await this.prisma.$transaction(async () => {
      await this.prisma.subnet.delete({ where: { id } });

      await this.audit.record({
        action: 'subnet.deleted',
        entity: 'Subnet',
        entityId: id,
        actorId: actor.id,
        actorName: actor.username,
        changes: {
          name: { from: before.name, to: null },
          cidr: { from: before.cidr, to: null },
        },
        ip,
      });
    });
  }

  // ── Adresy IP ───────────────────────────────────────────────

  async listAddresses(subnetId: string): Promise<{ addresses: IpAddressRow[]; total: number }> {
    // `total` osobno od długości listy: to ten sam kontrakt, którego
    // pilnując `findMany` + `count`, katalog nie musi wymyślać paginacji
    // od zera przy pierwszej potrzebie nagłówka „znaleziono N".
    const [adresy, total] = await Promise.all([
      this.prisma.ipAddress.findMany({ where: { subnetId } }),
      this.prisma.ipAddress.count({ where: { subnetId } }),
    ]);
    return { addresses: this.sortByAdres(adresy), total };
  }

  async createAddress(
    subnetId: string,
    dto: CreateAddressDto,
    actor: AuthUser,
    ip?: string,
  ): Promise<IpAddressRow> {
    const subnet = await this.prisma.subnet.findUnique({ where: { id: subnetId } });
    if (!subnet) throw new NotFoundException('Podsieć nie istnieje.');

    this.assertAdresWPodsieci(dto.address, subnet);

    const istniejace = await this.prisma.ipAddress.findMany({
      where: { subnetId, address: dto.address },
    });
    if (istniejace.length > 0) this.throwDuplikat(dto.address);

    // `lastSeenAt: null` jawnie — ręcznie dodany adres nie był potwierdzony
    // skanem, a pominięte pole wyglądałoby w dzienniku tak samo jak skasowane.
    const dane: IpAddressCreateData = {
      subnetId,
      address: dto.address,
      status: dto.status ?? 'FREE',
      description: dto.description ?? null,
      lastSeenAt: null,
    };

    const created = await this.prisma.ipAddress.create({ data: dane }).catch((e: unknown) => {
      // Wyścig: dwa żądania z tym samym adresem minęły oba `findMany`.
      this.throwDuplikat(dto.address, e);
    });

    await this.audit.record({
      action: 'address.created',
      entity: 'IpAddress',
      entityId: created.id,
      actorId: actor.id,
      actorName: actor.username,
      // Wpis ma jeden atrybut tożsamości — adres. `status` i opis obsługuje
      // już `address.updated` (diff obejmuje wszystkie pola), więc dublowanie
      // ich tutaj tylko rozbudowywałoby wpis bez nowej informacji.
      changes: { address: { from: null, to: created.address } },
      ip,
    });

    return created;
  }

  async updateAddress(
    id: string,
    dto: UpdateAddressDto,
    actor: AuthUser,
    ip?: string,
  ): Promise<IpAddressRow> {
    const before = await this.prisma.ipAddress.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Adres nie istnieje.');

    // PATCH: `undefined` znaczy „nie ruszaj pola" — pola doklejamy warunkowo.
    const dane: IpAddressUpdateData = {};
    if (dto.status !== undefined) dane.status = dto.status;
    if (dto.description !== undefined) dane.description = dto.description;

    if (dto.address !== undefined && dto.address !== before.address) {
      const subnet = await this.prisma.subnet.findUnique({ where: { id: before.subnetId } });
      if (!subnet) throw new NotFoundException('Podsieć nie istnieje.');

      this.assertAdresWPodsieci(dto.address, subnet);

      const kolidujace = await this.prisma.ipAddress.findMany({
        where: { subnetId: before.subnetId, address: dto.address },
      });
      if (kolidujace.length > 0) this.throwDuplikat(dto.address);

      dane.address = dto.address;
    }

    if (Object.keys(dane).length === 0) {
      // Pusty PATCH nie woła `update` i nie pisze dziennika — patrz `updateSubnet`.
      return before;
    }

    const after = await this.prisma.ipAddress
      .update({ where: { id }, data: dane })
      .catch((e: unknown) => {
        // Wyścig z innym edytorem tego samego wiersza — ta sama semantyka
        // konfliktu co przy tworzeniu.
        this.throwDuplikat(dto.address ?? before.address, e);
      });

    await this.audit.record({
      action: 'address.updated',
      entity: 'IpAddress',
      entityId: id,
      actorId: actor.id,
      actorName: actor.username,
      changes: AuditService.diff(
        before as unknown as Record<string, unknown>,
        after as unknown as Record<string, unknown>,
        ['updatedAt', 'createdAt'],
      ),
      ip,
    });

    return after;
  }

  async removeAddress(id: string, actor: AuthUser, ip?: string): Promise<void> {
    const before = await this.prisma.ipAddress.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Adres nie istnieje.');

    const przypisania = await this.prisma.applicationIpAddress.count({
      where: { ipAddressId: id },
    });
    // Świadoma odmowa. `onDelete: Cascade` i tak posadziłby `IN_USE` bez
    // aplikacji, a wpis zniknąłby dopiero razem z aplikacją — użytkownik
    // traciłby powiązanie bez ostrzeżenia. Liczba i podpowiedź w komunikacie
    // mówią, co dokładnie trzeba zdjąć i gdzie.
    if (przypisania > 0) {
      throw new ConflictException(
        `Adres ${before.address} jest przypisany do ${this.aplikacje(przypisania)}. ` +
          'Zdejmij przypisanie na karcie aplikacji, zanim usuniesz adres.',
      );
    }

    // Kasowanie i dziennik w jednej transakcji — jak `removeSubnet`.
    await this.prisma.$transaction(async () => {
      await this.prisma.ipAddress.delete({ where: { id } });

      await this.audit.record({
        action: 'address.deleted',
        entity: 'IpAddress',
        entityId: id,
        actorId: actor.id,
        actorName: actor.username,
        changes: { address: { from: before.address, to: null } },
        ip,
      });
    });
  }

  async applicationsForAddress(
    id: string,
  ): Promise<{ id: string; name: string; url: string }[]> {
    // Filtrowanie `deletedAt` w SQL, a nie w pamięci: usunięta aplikacja ma
    // nie wracać na kartę adresu, a zdejmowanie jej przypisań i odbudowa
    // statusu to własność Task 7, nie pytania „kto tu jest przypisany".
    const aplikacje = await this.prisma.application.findMany({
      where: { deletedAt: null, ipAddresses: { some: { ipAddressId: id } } },
      select: { id: true, name: true, baseUrl: true },
    });
    return aplikacje.map((a) => this.toApplicationRef(a));
  }

  // ── Przypisania aplikacja ↔ adres ───────────────────────────

  /**
   * Adresy przypisane do aplikacji, z danymi swojej podsieci.
   *
   * Czytamy przypisania, a nie relację z aplikacji: klucz złożony
   * `[applicationId, ipAddressId]` jest jedynym miejscem, gdzie wiadomo,
   * co jest przypisane — i pozwala odciąć cudze wiersze w zapytaniu,
   * zamiast odfiltrowywać je w pamięci.
   *
   * Adresy przychodzą gotowe: nie dopasowujemy ich do podsieci po CIDR,
   * bo to zadanie skanera (import zadania 10), a tu tylko prezentacja.
   */
  async getApplicationIpAddresses(appId: string): Promise<ApplicationIpAddressRef[]> {
    const przypisania = await this.prisma.applicationIpAddress.findMany({
      where: { applicationId: appId },
    });
    if (przypisania.length === 0) return [];

    const adresy = await this.prisma.ipAddress.findMany({
      where: { id: { in: przypisania.map((p) => p.ipAddressId) } },
      include: { subnet: { select: { id: true, name: true, cidr: true } } },
    });

    return this.sortByAdres(adresy).map((a) => ({
      id: a.id,
      address: a.address,
      status: a.status,
      description: a.description,
      subnet: a.subnet,
    }));
  }

  /**
   * Wymiana pełnego zestawu przypisań aplikacji.
   *
   * Formularz wysyła całą listę, więc porównujemy ją z tym, co jest
   * w bazie, i zapisujemy różnicę. Kasowanie całego zestawu i tworzenie
   * go od nowa zgubiłoby daty utworzenia przypisań, których nie ruszano,
   * a przy 100 pozycjach oznaczałoby 200 zapisów przy jednym kliknięciu.
   *
   * Kolejność walidacji: aplikacja (istnieje? nie usunięta miękko?),
   * potem identyfikatory adresów. Wszystko przed pierwszym zapisem —
   * częściowo zastosowana wymiana zostawiłaby aplikację w stanie, o którym
   * nikt nie prosił.
   */
  async setApplicationIpAddresses(
    appId: string,
    dto: SetApplicationIpAddressesDto,
    actor: AuthUser,
    ip?: string,
  ): Promise<void> {
    const aplikacja = await this.prisma.application.findFirst({
      where: { id: appId, deletedAt: null },
    });
    // `deletedAt: null` w filtrze, nie w pamięci: usunięta aplikacja
    // istnieje w bazie i przyjęłaby powiązania, których nikt nie zamawiał.
    if (!aplikacja) throw new NotFoundException('Aplikacja nie istnieje.');

    const obecne = await this.prisma.applicationIpAddress.findMany({
      where: { applicationId: appId },
    });
    const obecneIds = new Set(obecne.map((p) => p.ipAddressId));
    // `Set` zamiast tablicy: powtórzony identyfikator w formularzu trafiłby
    // do `createMany` dwa razy i klucz złożony zamieniłby to w 500 z P2002.
    const zadaneIds = new Set(dto.ipAddressIds);

    const doDodania = [...zadaneIds].filter((id) => !obecneIds.has(id));
    const doUsuniecia = [...obecneIds].filter((id) => !zadaneIds.has(id));

    // Niezmieniony zestaw nie jest zapisem. Bez tego warunku każde
    // otwarcie karty aplikacji i zapis bez zmian pchałby do bazy pustą
    // transakcję i śmieciowy wpis w dzienniku.
    if (doDodania.length === 0 && doUsuniecia.length === 0) return;

    if (doDodania.length > 0) {
      const znalezione = await this.prisma.ipAddress.findMany({
        where: { id: { in: doDodania } },
      });
      const istniejaceIds = new Set(znalezione.map((a) => a.id));
      const brak = doDodania.find((id) => !istniejaceIds.has(id));
      // Sam identyfikator w komunikacie: administrator ma wskazać, który
      // wpis z formularza przestał istnieć, a nie zgadywać po pozycji.
      if (brak) throw new NotFoundException(`Adres ${brak} nie istnieje.`);
    }

    await this.prisma.$transaction(async () => {
      if (doUsuniecia.length > 0) {
        await this.prisma.applicationIpAddress.deleteMany({
          where: { applicationId: appId, ipAddressId: { in: doUsuniecia } },
        });
      }
      if (doDodania.length > 0) {
        await this.prisma.applicationIpAddress.createMany({
          data: doDodania.map((ipAddressId) => ({ applicationId: appId, ipAddressId })),
        });
      }

      // JEDEN wpis na całą wymianę, nie osobny na każdy adres: formularz
      // wysyła pełny zestaw przy każdym zapisie, więc wpisy per pozycja
      // zaśmiecałyby dziennik informacją, której nikt nie czyta. Dziennik
      // odpowiada na pytanie „co się stało" — tu: zmienił się zestaw o N
      // dodanych i M zdjętych adresów.
      await this.audit.record({
        action: 'ip_addresses.update',
        entity: 'Application',
        entityId: appId,
        actorId: actor.id,
        actorName: actor.username,
        changes: {
          addedCount: { from: 0, to: doDodania.length },
          removedCount: { from: doUsuniecia.length, to: 0 },
        },
        ip,
      });
    });
  }

  /**
   * Zdejmuje przypisania aplikacji i przestawia status ich adresów.
   *
   * Wywoływane przez `ApplicationsService.remove()` — soft delete aplikacji
   * musi zdejmować jej przypisania, bo `onDelete: Cascade` zadziałałby
   * dopiero przy kasowaniu definicji, której soft delete nie robi. Bez tego
   * adres zostałby `IN_USE` bez właściciela, a `removeAddress` odmawiałby
   * jego skasowania.
   *
   * Kolejność operacji jest tu zgubiona celowo:
   *
   *  1. `findMany` po `applicationId` i odczyt statusów tych adresów —
   *     zbiór identyfikatorów czytamy PRZED skasowaniem wierszy, które
   *     zaraz znikają, bo potem nie ma skąd wziąć ani `ipAddressId`,
   *     ani poprzedniego statusu.
   *  2. `deleteMany` na przypisaniach tej aplikacji.
   *  3. `findMany` po pozostałych przypisaniach — filtrowane
   *     `application: { deletedAt: null }`, czyli liczymy tylko aplikacje
   *     żywe. Dopiero po skasowaniu wiemy, co zostało.
   *  4. `updateMany` na adresach: `IN_USE` tam, gdzie zostało żywe
   *     przypisanie, i `FREE` tam, gdzie nie zostało żadne.
   *
   * Dwa osobne `updateMany`, nie jeden bezwarunkowy `FREE`: adres
   * współdzielony z inną, żywą aplikacją musi zostać `IN_USE`. Bez tego
   * żaden kod w systemie nie wróciłby mu `IN_USE` (przypisanie niczego nie
   * zmienia w statusie), więc błąd byłby trwały i naprawialny tylko przez
   * ręczną edycję bazy.
   *
   * `DEPRECATED` („wycofywany, czeka na zwolnienie") zostaje, jak był:
   * to decyzja katalogu, a nie skutek przypisania, więc zdjęcie
   * przypisania jej nie cofa.
   *
   * Transakcję z soft delete zakłada wołający (`ApplicationsService`), ale
   * to tylko kolejność wywołań: zapytania idą bazowym klientem Prisma,
   * którego Prisma nie włącza w `$transaction(fn)`. Śmierć procesu
   * w trakcie zostawia więc aplikację usuniętą, a przypisania (albo
   * statusy) nie do końca — wtedy wystarczy powtórzyć operację.
   */
  async releaseIpAddressesForApplication(appId: string): Promise<void> {
    const przypisania = await this.prisma.applicationIpAddress.findMany({
      where: { applicationId: appId },
    });
    if (przypisania.length === 0) return;

    const adresy = [...new Set(przypisania.map((p) => p.ipAddressId))];
    const wiersze = await this.prisma.ipAddress.findMany({ where: { id: { in: adresy } } });

    await this.prisma.applicationIpAddress.deleteMany({
      where: { applicationId: appId },
    });

    const pozostale = await this.prisma.applicationIpAddress.findMany({
      where: { ipAddressId: { in: adresy }, application: { deletedAt: null } },
    });
    const zajete = new Set(pozostale.map((p) => p.ipAddressId));

    const doWolnych: string[] = [];
    const doZajetych: string[] = [];
    for (const wiersz of wiersze) {
      if (zajete.has(wiersz.id)) doZajetych.push(wiersz.id);
      else if (wiersz.status !== 'DEPRECATED') doWolnych.push(wiersz.id);
    }

    if (doWolnych.length > 0) {
      await this.prisma.ipAddress.updateMany({
        where: { id: { in: doWolnych } },
        data: { status: 'FREE' },
      });
    }
    if (doZajetych.length > 0) {
      await this.prisma.ipAddress.updateMany({
        where: { id: { in: doZajetych } },
        data: { status: 'IN_USE' },
      });
    }
  }

  // ── Pomocnicze ──────────────────────────────────────────────

  /**
   * Kolizje sprawdzamy przez pobranie WSZYSTKICH podsieci i `rangesOverlap`,
   * nie przez SQL: baza nie ma indeksu na zakres, a i tak czytamy
   * podsieci w całości dla podsumowań.
   *
   * `selfId` wyklucza aktualizowany wiersz — każdy PATCH z CIDR
   * (nawet niezmienionym) kolizowałby inaczej sam ze sobą.
   *
   * Wiersz z niesparsowalnym CIDR (ręczna edycja w bazie) pomijamy:
   * bez zakresu nie da się orzec nakładania, a blokada zapisu
   * cudzym śmieciem byłaby gorsza od jej braku.
   */
  private async assertZakresWolny(cidr: Cidr, selfId: string | null): Promise<void> {
    const wszystkie = await this.prisma.subnet.findMany();
    for (const other of wszystkie) {
      if (other.id === selfId) continue;
      const inny = parseCidr(other.cidr);
      if (!inny) continue;
      if (rangesOverlap(cidr, inny)) {
        // Nazwa kolidującej podsieci w komunikacie: administrator musi
        // wiedzieć, którą podsieć powiększyć albo zmienić.
        // 409, nie 400 — nakładanie zakresu to konflikt STANU z istniejącym
        // zasobem (spec §3 „Błędy"), tak samo jak zajęta nazwa w
        // `UsersService` czy kolizja właściciela w `ApplicationsService`.
        throw new ConflictException(
          `Zakres koliduje z podsiecią „${other.name}” (${other.cidr}).`,
        );
      }
    }
  }

  /**
   * Kolejność walidacji adresu: format → zawieranie → adres specjalny →
   * duplikat (ten ostatni etap jest zapytaniem, więc robi go wołający).
   *
   * Kolejność ma znaczenie dla komunikatu: użytkownik dostaje pierwszy
   * błąd, który faktycznie popełnił, a nie losowy z dalszego etapu.
   */
  private assertAdresWPodsieci(address: string, subnet: SubnetRow): void {
    if (!isValidIpv4(address)) {
      // Ten sam komunikat, co walidator DTO — jedno zdanie o jednym błędzie.
      throw new BadRequestException(
        'Nieprawidłowy adres IP — podaj cztery oktety 0–255, np. 10.20.1.15.',
      );
    }

    const cidr = parseCidr(subnet.cidr);
    // Wiersz z niesparsowalnym CIDR (ręczna edycja w bazie) przepuszczamy
    // przez sam format: bez zakresu nie da się orzec zawierania, a blokada
    // zapisu cudzym śmieciem była gorsza od jej braku — tak samo, jak
    // w `assertZakresWolny`.
    if (!cidr) return;

    if (!ipInCidr(address, cidr)) {
      throw new BadRequestException(
        `Adres ${address} jest poza zakresem podsieci „${subnet.name}” (${cidr.text}).`,
      );
    }

    // Adres sieciowy i rozgłoszeniowy nie są adresami hostów, więc katalog
    // adresów nie powinien ich zawierać. Wyjątek to /31 i /32: tam oba
    // końce zakresu to ten sam adres hosta (RFC 3021 dla łączy punkt-punkt),
    // a odrzucanie ich wykluczałoby realne podsieci.
    if (cidr.prefix <= 30) {
      const numer = ipToNumber(address);
      if (numer !== null && (numer === cidr.first || numer === cidr.broadcast)) {
        throw new BadRequestException(
          `Adres ${address} jest ${numer === cidr.first ? 'sieciowym' : 'rozgłoszeniowym'} ` +
            `adresem podsieci „${subnet.name}” (${cidr.text}) — ` +
            'wpisz adres hosta z tego zakresu.',
        );
      }
    }
  }

  /**
   * Zawsze rzuca — sygnatura `never` pozwala użyć jej jako wyrażenia
   * w `.catch()`, gdzie zmienna musi mieć typ.
   *
   * Drugi argument to błąd z bazy: `P2002` na `@@unique([subnetId, address])`
   * to ta sama semantyka co duplikat znaleziony wstępnie, więc użytkownik
   * dostaje 409 i to samo zdanie zamiast 500 oraz „Unique constraint failed
   * on the fields: (`subnetId`,`address`)”. Rzucamy tylko dla `P2002` —
   * pozostałe błędy bazy muszą zostać nietknięte i zobaczone w logach.
   */
  private throwDuplikat(address: string, przyczyna?: unknown): never {
    if (przyczyna !== undefined && !this.isP2002(przyczyna)) throw przyczyna;
    throw new ConflictException(`Adres ${address} jest już zarejestrowany w tej podsieci.`);
  }

  /**
   * Sprawdzenie kodu błędu, a nie `instanceof` — klasa
   * `PrismaClientKnownRequestError` nie przeżywa wielu granic (pakiety
   * instancji klienta, bundler, `unknown` z `.catch()`), a `code` to
   * jedyna część komunikatu Prisma, na której opiera się cała obsługa
   * błędów w jego dokumentacji.
   */
  private isP2002(e: unknown): boolean {
    return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';
  }

  /** Polska liczba mnoga dla „aplikacja" przy komunikacie o przypisaniach. */
  private aplikacje(n: number): string {
    if (n === 1) return '1 aplikacja';
    const ostatnia = n % 10;
    const dziesiatki = n % 100;
    if (ostatnia >= 2 && ostatnia <= 4 && (dziesiatki < 12 || dziesiatki > 14)) {
      return `${n} aplikacje`;
    }
    return `${n} aplikacji`;
  }

  /** Wiersz aplikacji sprowadzony do kontraktu `{ id, name, url }`. */
  private toApplicationRef(a: ApplicationRefRow): { id: string; name: string; url: string } {
    // `url` jest `string`, a `baseUrl` w schemacie nullable — `undefined`
    // trafiłby do frontu jako brakujące pole i rozjechałoby typy.
    return { id: a.id, name: a.name, url: a.baseUrl ?? '' };
  }

  /** Wiersz podsieci z adresami posortowanymi numerycznie. */
  private async toDetail(subnet: SubnetRow): Promise<SubnetDetail> {
    const adresy = await this.prisma.ipAddress.findMany({
      where: { subnetId: subnet.id },
    });
    return { ...subnet, addresses: this.sortByAdres(adresy) };
  }

  /**
   * Sortowanie numeryczne adresów.
   *
   * Generyczne, bo wiersze bywają szersze niż `IpAddressRow` — przy
   * odczycie przypisań niesą podpiętą podsieć, a sortowanie nie może jej
   * zgubić po drodze.
   */
  private sortByAdres<T extends IpAddressRow>(adresy: T[]): T[] {
    // Numerycznie, nie leksykograficznie: „10.20.0.40" < „10.20.0.5"
    // to porządek, który w katalogu wygląda na błąd.
    return [...adresy].sort(
      (a, b) => (ipToNumber(a.address) ?? 0) - (ipToNumber(b.address) ?? 0),
    );
  }
}
