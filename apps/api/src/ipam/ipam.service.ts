/**
 * Katalog IPAM — podsieci.
 *
 * Cała logika zakresów jest w `cidr.ts`; serwis tylko składa z niego
 * reguły katalogu: dwa zapisy nie mogą obejmować tego samego zakresu,
 * węższy CIDR nie może zostawić adresów poza podsiecią, a każdy zapis
 * idzie do dziennika. Dialogi z bazą idą przez port (`ipam.port.ts`),
 * dzięki czemu testy nie podnoszą Postgresa.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/decorators';
import {
  cidrErrorMessage,
  ipInCidr,
  ipToNumber,
  parseCidr,
  rangesOverlap,
  type Cidr,
} from './cidr';
import type { CreateSubnetDto, UpdateSubnetDto } from './dto/ipam.dto';
import type {
  IpAddressRow,
  SubnetCreateData,
  SubnetDetail,
  SubnetRow,
  SubnetUpdateData,
  SubnetWithCounts,
} from './ipam.port';

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
        throw new BadRequestException(
          `Zakres koliduje z podsiecią „${other.name}” (${other.cidr}).`,
        );
      }
    }
  }

  /** Wiersz podsieci z adresami posortowanymi numerycznie. */
  private async toDetail(subnet: SubnetRow): Promise<SubnetDetail> {
    const adresy = await this.prisma.ipAddress.findMany({
      where: { subnetId: subnet.id },
    });
    return { ...subnet, addresses: this.sortByAdres(adresy) };
  }

  private sortByAdres(adresy: IpAddressRow[]): IpAddressRow[] {
    // Numerycznie, nie leksykograficznie: „10.20.0.40” < „10.20.0.5”
    // to porządek, który w katalogu wygląda na błąd.
    return [...adresy].sort(
      (a, b) => (ipToNumber(a.address) ?? 0) - (ipToNumber(b.address) ?? 0),
    );
  }
}
