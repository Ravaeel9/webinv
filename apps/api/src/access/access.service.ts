import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/decorators';
import {
  ACCESS_PORT,
  type AccessGrantDto,
  type AccessGrantWithPerson,
  type AccessGrantWithRelations,
  type AccessLevelName,
  type AccessPort,
  type ApplicationAccessRow,
  type GrantWhere,
  type PersonOrderBy,
  type PersonRow,
  type PersonWhere,
  type PersonWithCounts,
} from './access.port';
import {
  CsvError,
  MAX_PERSON_ROWS,
  parsePersonsCsv,
  type HeaderMapping,
} from './csv';

/**
 * Katalog osób i macierz uprawnień do aplikacji.
 *
 * Osobny serwis, a nie rozszerzenie `UsersService`, bo osoby z ewidencji
 * nie są kontami panelu: nie mają loginu, hasła, roli ani sesji. Trzymanie
 * ich w `users` wymuszałoby wypełnianie pól, które dla nich nie mają
 * znaczenia, a kasowanie konta gniecie historię macierzy.
 *
 * Reguły, które tu pilnujemy (w kolejności, w jakiej je sprawdzamy —
 * komunikat ma być pomocny, a nie tylko zgodny):
 *
 *  1. **E-mail to tożsamość.** Ponowna rejestracja zwraca 409 z id istniejącej
 *     osoby, żeby panel mógł zaproponować dodanie do macierzy.
 *  2. **Ta sama osoba nie wchodzi dwa razy do tej samej aplikacji** — 409.
 *  3. **Osoby nieaktywnej nie da się dodać do macierzy** — 400. Jej dotychczasowe
 *     przypisania zostają, bo odebranie dostępu to inna decyzja niż kasowanie.
 *  4. **Data wygaśnięcia w przeszłości** jest dozwolona przy edycji (porządkowanie
 *     danych) i odrzucona przy dodaniu (nowo nadany dostęp nie może być od razu
 *     wygasły).
 */
@Injectable()
export class AccessService {
  constructor(
    @Inject(ACCESS_PORT) private readonly prisma: AccessPort,
    private readonly audit: AuditService,
  ) {}

  // ─── Katalog osób ────────────────────────────────────────────

  /**
   * Lista osób. `search` szuka w nazwisku, imieniu i e-mailu; `department`
   * jest filtrem dokładnym, bo dział jest tekstem wpisywanym ręcznie.
   */
  async listPersons(filters: {
    search?: string;
    department?: string;
    includeInactive?: boolean;
    sort?: string;
  }): Promise<PersonWithCounts[]> {
    const where: PersonWhere = {};
    if (filters.includeInactive === false) where.isActive = true;
    if (filters.department) where.department = filters.department;

    const szukaj = filters.search?.trim();
    if (szukaj) {
      // `contains` z `mode: 'insensitive'` zamiast porównania w JS: baza
      // filtruje, a nie serwis, więc lista nie rośnie z rozmiarem katalogu.
      where.OR = [
        { firstName: { contains: szukaj, mode: 'insensitive' } },
        { lastName: { contains: szukaj, mode: 'insensitive' } },
        { email: { contains: szukaj, mode: 'insensitive' } },
      ];
    }

    const osoby = await this.prisma.person.findMany({
      where,
      orderBy: this.sortOsoby(filters.sort),
      // `_count` jest jedynym sposobem, żeby kolumna „Aplikacje” w katalogu
      // osób miała prawdziwą wartość zamiast `undefined` — jedno zapytanie
      // jest tańsze niż pobranie przypisań i policzenie ich w serwisie.
      include: { _count: { select: { access: true } } },
    } as never);

    // Prisma zwraca licznik jako `_count.access`; nazwa, której używa
    // interfejs, to dopiero wynik tego przeniesienia. Bez tego katalog osób
    // pokazywałby w kolumnie „Aplikacje” wartość `undefined`.
    return (osoby as unknown as Array<PersonRow & { _count?: { access: number } }>).map(
      (osoba) => ({ ...osoba, accessCount: osoba._count?.access ?? 0 }),
    );
  }

  /**
   * Biała lista sortowania. Sortowanie po polskim nazwisku działa bez
   * znajomości reguł PostgreSQL, a nazwa spoza listy jest ignorowana —
   * dokładnie jak w `SORTABLE` modułu aplikacji.
   */
  private sortOsoby(sort?: string): PersonOrderBy {
    const dozwolone = ['lastName', 'department', 'createdAt'];
    const pole = dozwolone.includes(sort ?? '') ? sort! : 'lastName';
    // Obiekt, nie nazwa pola: Prisma odrzuca goły napis w `orderBy`.
    return { [pole]: 'asc' };
  }

  async getPerson(id: string): Promise<PersonRow> {
    const osoba = await this.prisma.person.findUnique({ where: { id } });
    if (!osoba) throw new NotFoundException('Osoba nie istnieje.');
    return osoba;
  }

  async createPerson(
    dto: {
      firstName: string;
      lastName: string;
      email: string;
      position?: string;
      department?: string;
      isActive?: boolean;
    },
    actor: AuthUser,
    ip?: string,
  ): Promise<PersonRow> {
    const dane = this.walidujOsobe(dto);

    const istniejaca = await this.prisma.person.findFirst({
      where: { email: dane.email },
    });
    if (istniejaca) {
      throw new ConflictException(
        `Osoba z adresem „${dane.email}" już jest w katalogu (${istniejaca.id}). ` +
          'Dodaj ją do macierzy zamiast tworzyć nową.',
      );
    }

    const osoba = await this.prisma.person.create({ data: dane });

    await this.audit.record({
      action: 'person.created',
      entity: 'Person',
      entityId: osoba.id,
      actorId: actor.id,
      actorName: actor.username,
      changes: {
        email: { from: null, to: osoba.email },
        fullName: { from: null, to: `${osoba.firstName} ${osoba.lastName}` },
        department: { from: null, to: osoba.department },
      },
      ip,
    });

    return osoba;
  }

  /**
   * Edycja danych osoby. Budujemy `data` tylko z kluczy obecnych w `dto` —
   * `undefined` znaczy „nie ruszaj", a nie „wyczyść".
   */
  async updatePerson(
    id: string,
    dto: {
      firstName?: string;
      lastName?: string;
      email?: string;
      position?: string;
      department?: string;
      isActive?: boolean;
    },
    actor: AuthUser,
    ip?: string,
  ): Promise<PersonRow> {
    const przed = await this.getPerson(id);

    // Nazwy przez tę samą walidację co przy tworzeniu. `@MinLength(1)` w DTO
    // przepuszcza ciąg samych spacji, a w katalogu i w macierzy zostałaby
    // osoba widoczna jako samo „Nazwisko".
    if (dto.firstName !== undefined) this.wymagajTekstu(dto.firstName, 'Imię');
    if (dto.lastName !== undefined) this.wymagajTekstu(dto.lastName, 'Nazwisko');

    const data: Partial<PersonRow> = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) data.lastName = dto.lastName.trim();
    if (dto.email !== undefined) data.email = this.walidujEmail(dto.email);
    if (dto.position !== undefined) data.position = this.walidujTekst(dto.position, 'Stanowisko');
    if (dto.department !== undefined) data.department = this.walidujTekst(dto.department, 'Dział');
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    if (dto.email !== undefined && dto.email.toLowerCase() !== przed.email.toLowerCase()) {
      const istniejaca = await this.prisma.person.findFirst({
        where: { email: data.email },
      });
      if (istniejaca) {
        throw new ConflictException(
          `Osoba z adresem „${data.email}" już jest w katalogu (${istniejaca.id}).`,
        );
      }
    }

    const osoba = await this.prisma.person.update({ where: { id }, data });

    await this.audit.record({
      action: 'person.updated',
      entity: 'Person',
      entityId: id,
      actorId: actor.id,
      actorName: actor.username,
      changes: AuditService.diff(
        przed as unknown as Record<string, unknown>,
        { ...przed, ...data } as unknown as Record<string, unknown>,
        ['updatedAt', 'createdAt', 'accessCount'],
      ),
      ip,
    });

    return osoba;
  }

  /**
   * Dezaktywacja — nie kasowanie. Osoba znika z listy wyboru, ale jej
   * przypisania w macierzach muszą zostać czytelne: to one są dowodem,
   * kto miał dostęp.
   */
  async deactivatePerson(id: string, actor: AuthUser, ip?: string): Promise<PersonRow> {
    const osoba = await this.getPerson(id);
    if (!osoba.isActive) return osoba;

    const po = await this.prisma.person.update({ where: { id }, data: { isActive: false } });

    await this.audit.record({
      action: 'person.deactivated',
      entity: 'Person',
      entityId: id,
      actorId: actor.id,
      actorName: actor.username,
      changes: {
        isActive: { from: true, to: false },
        fullName: { from: `${osoba.firstName} ${osoba.lastName}`, to: null },
      },
      ip,
    });

    return po;
  }

  // ─── Macierz uprawnień ───────────────────────────────────────

  /**
   * Macierz jednej aplikacji — do sekcji w karcie aplikacji.
   * Sortowanie po nazwisku, bo to najczęstsze pytanie przy przeglądaniu:
   * „kto tu ma dostęp".
   */
  async listApplicationAccess(applicationId: string): Promise<AccessGrantDto[]> {
    await this.requireApplication(applicationId);
    const granty = (await this.prisma.applicationAccess.findMany({
      where: { applicationId },
      include: { person: true },
      orderBy: { person: { lastName: 'asc' } },
    })) as AccessGrantWithPerson[];
    return granty.map((g) => this.formatGrant(g, g.person));
  }

  /**
   * Ujednolicony kształt przypisania dla odpowiedzi API: daty jako
   * `YYYY-MM-DD`. Ten sam format co w macierzy zbiorczej, więc interfejs
   * nie musi znać dwóch reprezentacji tej samej daty.
   */
  private formatGrant(
    grant: ApplicationAccessRow,
    person: PersonRow,
  ): AccessGrantDto {
    return {
      applicationId: grant.applicationId,
      personId: grant.personId,
      level: grant.level,
      grantedOn: this.data(grant.grantedOn),
      expiresOn: grant.expiresOn ? this.data(grant.expiresOn) : null,
      note: grant.note,
      person,
    };
  }

  /**
   * Nadanie dostępu. Kolejność sprawdzeń jest tu celowa i wynika z tego,
   * co administrator musi zrozumieć z komunikatu:
   *
   *  1. czy aplikacja w ogóle istnieje,
   *  2. czy osoba już jest w katalogu (a może tylko nie ma tu dostępu),
   *  3. czy osoba jest aktywna,
   *  4. czy nie ma jej już w tej aplikacji,
   *  5. czy data wygaśnięcia nie jest w przeszłości.
   *
   * Dopiero potem cokolwiek zapisujemy — nieudana próba nie może zostawić
   * w katalogu osoby utworzonej „w trakcie” odrzuconego nadania.
   */
  async grantAccess(
    applicationId: string,
    dto: {
      email: string;
      // Opcjonalne: istniejącą osobę dodajemy samym e-mailem.
      // Wymagamy ich dopiero wtedy, gdy naprawdę musimy utworzyć osobę.
      firstName?: string;
      lastName?: string;
      position?: string;
      department?: string;
      level?: AccessLevelName;
      expiresOn?: string;
      note?: string;
    },
    actor: AuthUser,
    ip?: string,
  ): Promise<AccessGrantDto> {
    await this.requireApplication(applicationId);

    const email = this.walidujEmail(dto.email);

    // Walidacja daty wygaśnięcia **przed** jakimkolwiek zapisem. Jeśli później,
    // to odrzucone nadanie zostawiałoby w katalogu osobę utworzoną „w trakcie”
    // albo nadpisywało dział osoby istniejącej — a administrator widziałby 400
    // i nie wiedziałby, że katalog jednak się zmienił.
    const expiresOn = this.walidujWygasanie(dto.expiresOn, true);

    let osoba = await this.prisma.person.findFirst({ where: { email } });

    if (osoba && !osoba.isActive) {
      throw new BadRequestException(
        `Osoba „${osoba.firstName} ${osoba.lastName}" jest nieaktywna — najpierw aktywuj ją w katalogu osób.`,
      );
    }

    if (!osoba) {
      // Osoba spoza katalogu: bez imienia i nazwiska nie da się jej zapisać,
      // a komunikat ma powiedzieć wprost, czego brakuje.
      if (!dto.firstName?.trim() || !dto.lastName?.trim()) {
        throw new BadRequestException(
          'Ta osoba nie ma jeszcze wpisu w katalogu — podaj też imię i nazwisko.',
        );
      }
      osoba = await this.prisma.person.create({
        data: this.walidujOsobe({
          firstName: dto.firstName,
          lastName: dto.lastName,
          email,
          position: dto.position,
          department: dto.department,
        }),
      });
    } else if (dto.position !== undefined || dto.department !== undefined) {
      // Dane z matrycy mogą uzupełnić katalog (np. dział wgrywany
      // przy okazji), ale nie nadpisujemy tego, co tam już jest.
      await this.prisma.person.update({
        where: { id: osoba.id },
        data: {
          ...(dto.position !== undefined ? { position: this.walidujTekst(dto.position, 'Stanowisko') ?? null } : {}),
          ...(dto.department !== undefined ? { department: this.walidujTekst(dto.department, 'Dział') ?? null } : {}),
        },
      });
    }

    const istniejace = await this.prisma.applicationAccess.findUnique({
      where: { applicationId_personId: { applicationId, personId: osoba.id } },
    });
    if (istniejace) {
      throw new ConflictException(
        `Ta osoba ma już dostęp do tej aplikacji (poziom ${istniejace.level}).`,
      );
    }

    const grant = await this.prisma.applicationAccess.create({
      data: {
        applicationId,
        personId: osoba.id,
        level: dto.level ?? 'USER',
        expiresOn,
        note: this.walidujNotatke(dto.note),
      },
    });

    await this.audit.record({
      action: 'access.granted',
      entity: 'ApplicationAccess',
      entityId: grant.personId,
      actorId: actor.id,
      actorName: actor.username,
      changes: {
        // Nazwa osoby w zmianie: dziennik ma czytać się bez dodatkowych
        // zapytań o każdą osobę z osobna.
        person: { from: null, to: this.opisOsoby(osoba) },
        level: { from: null, to: grant.level },
        expiresOn: { from: null, to: grant.expiresOn ? this.data(grant.expiresOn) : null },
      },
      ip,
    });

    return this.formatGrant(grant, await this.getPerson(osoba.id));
  }

  /** Zmiana poziomu, daty wygaśnięcia i notatki. Daty nadania nie ruszamy. */
  async updateGrant(
    applicationId: string,
    personId: string,
    dto: { level?: AccessLevelName; expiresOn?: string | null; note?: string | null },
    actor: AuthUser,
    ip?: string,
  ): Promise<AccessGrantDto> {
    const przed = await this.prisma.applicationAccess.findUnique({
      where: { applicationId_personId: { applicationId, personId } },
    });
    if (!przed) throw new NotFoundException('To przypisanie nie istnieje.');

    const data: Record<string, unknown> = {};
    if (dto.level !== undefined) data.level = dto.level;
    if (dto.expiresOn !== undefined) {
      data.expiresOn =
        dto.expiresOn === null ? null : this.walidujWygasanie(dto.expiresOn, false);
    }
    if (dto.note !== undefined) data.note = dto.note === null ? null : this.walidujNotatke(dto.note);

    const grant = await this.prisma.applicationAccess.update({
      where: { applicationId_personId: { applicationId, personId } },
      data: data as never,
    });

    await this.audit.record({
      action: 'access.updated',
      entity: 'ApplicationAccess',
      entityId: personId,
      actorId: actor.id,
      actorName: actor.username,
      changes: AuditService.diff(
        przed as unknown as Record<string, unknown>,
        { ...przed, ...data } as unknown as Record<string, unknown>,
        ['createdAt', 'grantedOn'],
      ),
      ip,
    });

    return this.formatGrant(grant, await this.getPerson(personId));
  }

  /**
   * Odebranie dostępu. Kasujemy przypisanie, nie osobę — osoba może mieć
   * dostęp do innych aplikacji, a poza tym sama ewidencja ma wartość.
   */
  async revokeGrant(
    applicationId: string,
    personId: string,
    actor: AuthUser,
    ip?: string,
  ): Promise<void> {
    const grant = await this.prisma.applicationAccess.findUnique({
      where: { applicationId_personId: { applicationId, personId } },
    });
    if (!grant) throw new NotFoundException('To przypisanie nie istnieje.');

    const osoba = await this.prisma.person.findUnique({ where: { id: personId } });
    await this.prisma.applicationAccess.delete({
      where: { applicationId_personId: { applicationId, personId } },
    });

    await this.audit.record({
      action: 'access.revoked',
      entity: 'ApplicationAccess',
      entityId: personId,
      actorId: actor.id,
      actorName: actor.username,
      changes: {
        person: { from: osoba ? this.opisOsoby(osoba) : personId, to: null },
        level: { from: grant.level, to: null },
      },
      ip,
    });
  }

  /**
   * Macierz zbiorcza: każdy wiersz to osoba, aplikacja i poziom.
   * Filtry są dokładne (`department` to tekst z katalogu), a wygasłe
   * przypisania zostają — macierz ma pokazywać stan nadania, nie tylko
   * stan bieżący.
   */
  async matrix(filters: {
    applicationId?: string;
    personId?: string;
    department?: string;
    level?: AccessLevelName;
  }) {
    const where: GrantWhere = {};
    if (filters.applicationId) where.applicationId = filters.applicationId;
    if (filters.personId) where.personId = filters.personId;
    if (filters.level) where.level = filters.level;

    const granty = (await this.prisma.applicationAccess.findMany({
      where,
      // Oba warunki są konieczne: bez `person` wiersz nie ma nazwiska,
      // a bez `application` nie ma nazwy aplikacji. Prisma nie dołącza
      // relacji domyślnie — jawny `include` albo 500 przy `undefined`.
      include: { person: true, application: true },
      orderBy: [{ application: { name: 'asc' } }, { person: { lastName: 'asc' } }],
    })) as AccessGrantWithRelations[];

    // Filtr działu jedziemy po stronie serwisu: dział to wolny tekst bez
    // indeksu, a macierz jest jednorazowym raportem, nie stroną katalogu.
    const przefiltrowane = filters.department
      ? granty.filter((g) => g.person.department === filters.department)
      : granty;

    return przefiltrowane.map((g) => ({
      application: { id: g.application.id, name: g.application.name },
      person: {
        id: g.person.id,
        firstName: g.person.firstName,
        lastName: g.person.lastName,
        email: g.person.email,
        position: g.person.position,
        department: g.person.department,
        isActive: g.person.isActive,
      },
      level: g.level,
      // Daty jako `YYYY-MM-DD`, nie pełne znaczniki czasu: interfejs
      // pokazuje datę nadania, a godzina z dokładnością do sekundy
      // tylko zaciemnia obraz.
      grantedOn: this.data(g.grantedOn),
      expiresOn: g.expiresOn ? this.data(g.expiresOn) : null,
      note: g.note,
    }));
  }

  // ─── Import osób z CSV ──────────────────────────────────────

  /**
   * Podgląd importu: klasyfikuje każdy wiersz jako `NEW`, `UPDATE` lub
   * `ERROR`. Nic tu nie jest zapisywane — podgląd ma być bezpieczny do
   * klikania w kółko.
   */
  async previewPersonsImport(text: string, mapping?: HeaderMapping) {
    const wczytany = this.wczytajCsv(text, mapping);

    const rows = await Promise.all(
      wczytany.rows.map(async (wiersz) => {
        if (wiersz.errors.length > 0) {
          return { ...wiersz, status: 'ERROR' as const, existingPersonId: null };
        }
        const istniejaca = await this.prisma.person.findFirst({
          where: { email: wiersz.email },
        });
        return {
          ...wiersz,
          status: istniejaca ? ('UPDATE' as const) : ('NEW' as const),
          existingPersonId: istniejaca?.id ?? null,
        };
      }),
    );

    return {
      rows,
      mapping: wczytany.mapping,
      unmapped: wczytany.unmapped,
      summary: {
        total: rows.length,
        create: rows.filter((r) => r.status === 'NEW').length,
        update: rows.filter((r) => r.status === 'UPDATE').length,
        invalid: rows.filter((r) => r.status === 'ERROR').length,
      },
    };
  }

  /**
   * Zapis importu. Każdy wiersz jest walidowany od nowa — podgląd i zapis
   * rozdziela przerwa w pracy, więc payload z przeglądarki traktujemy jako
   * niezaufany. Wiersz, którego nie da się zapisać, jest pomijany
   * i zliczany; pozostałe przechodzą.
   */
  async applyPersonsImport(
    rows: ImportRowInput[],
    actor: AuthUser,
    ip?: string,
  ): Promise<{ created: number; updated: number; skipped: number }> {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestException('Import nie zawiera żadnego wiersza.');
    }
    if (rows.length > MAX_PERSON_ROWS) {
      throw new BadRequestException(
        `Import przekracza limit ${MAX_PERSON_ROWS} wierszy.`,
      );
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;

    // Duplikaty w **jednym** payloadzie. Podgląd je wykrywa, ale między
    // podglądem a zapisem payload może trafić z innego klienta (albo zostać
    // podmieniony) — bez tego sprawdzenia drugi wiersz z tym samym e-mailem
    // nadpisałby pierwszy po cichu („ostatni wygrywa").
    const widziane = new Set<string>();
    let duplikaty = 0;

    for (const wiersz of rows) {
      const klucz = (wiersz.email ?? '').trim().toLowerCase();
      if (klucz && widziane.has(klucz)) {
        duplikaty++;
        continue;
      }
      if (klucz) widziane.add(klucz);

      let dane: ReturnType<AccessService['walidujOsobe']>;
      try {
        dane = this.walidujOsobe(wiersz);
      } catch {
        // Śmieciowy wiersz nie może wywracać całego importu — pomijamy
        // go i pokazujemy licznik, z którego administrator widzi,
        // że coś trzeba poprawić w pliku.
        skipped++;
        continue;
      }

      const istniejaca = await this.prisma.person.findFirst({
        where: { email: dane.email },
      });

      if (istniejaca) {
        await this.prisma.person.update({
          where: { id: istniejaca.id },
          data: {
            firstName: dane.firstName,
            lastName: dane.lastName,
            // `undefined` znaczy „pliku tu nie było, nie ruszaj pola” —
            // nadpisanie `null` skasowałoby ręcznie uzupełniony dział.
            ...(dane.position !== undefined ? { position: dane.position } : {}),
            ...(dane.department !== undefined ? { department: dane.department } : {}),
            ...(dane.isActive !== undefined ? { isActive: dane.isActive } : {}),
          },
        });
        updated++;
      } else {
        await this.prisma.person.create({ data: dane });
        created++;
      }
    }

    // Duplikaty z payloadu liczymy jako pominięte — administrator widzi
    // w liczniku, że plik wymaga poprawki.
    skipped += duplikaty;

    // Jeden wpis z liczbami: import tysiąca osób nie może zasypać dziennika
    // tysiącem wierszy, bo nikt nigdy by go nie przeczytał.
    await this.audit.record({
      action: 'person.imported',
      entity: 'Person',
      entityId: null,
      actorId: actor.id,
      actorName: actor.username,
      changes: {
        created: { from: null, to: created },
        updated: { from: null, to: updated },
        skipped: { from: null, to: skipped },
      },
      ip,
    });

    return { created, updated, skipped };
  }

  /** Parser z ujednoliconym tłumaczeniem błędów wejścia na 400. */
  private wczytajCsv(text: string, mapping?: HeaderMapping) {
    try {
      return parsePersonsCsv(text, mapping);
    } catch (blad) {
      if (blad instanceof CsvError) {
        throw new BadRequestException(blad.message);
      }
      throw blad;
    }
  }

  /** Aplikacja musi istnieć i nie być oznaczona jako usunięta. */
  private async requireApplication(applicationId: string) {
    const aplikacja = await this.prisma.application.findUnique({
      where: { id: applicationId },
    });
    if (!aplikacja || aplikacja.deletedAt) {
      throw new NotFoundException('Aplikacja nie istnieje.');
    }
    return aplikacja;
  }

  /**
   * Data wygasania. Przy nadaniu data z przeszłości oznaczałaby „dodaj
   * dostęp, który już wygasł" — nie ma sensu, więc odrzucamy. Przy edycji
   * jest dopuszczalna: ktoś porządkuje zapis i zaznacza, że dostęp
   * zakończył się wtedy.
   */
  private walidujWygasanie(wartosc: string | undefined, odrzucPrzeszle: boolean): Date | null {
    if (wartosc === undefined || wartosc === '') return null;
    const data = new Date(wartosc);
    if (Number.isNaN(data.getTime())) {
      throw new BadRequestException(`„${wartosc}" nie jest datą.`);
    }
    // Porównanie **po dacie**, nie po znaczniku czasu: `new Date('RRRR-MM-DD')`
    // to północ UTC, więc „wygaśnie dzisiaj" (kolumna `@db.Date`, bez godziny)
    // wypadałoby wcześniej niż `Date.now()` i zostałoby odrzucone jako
    // „w przeszłości". Dostęp do końca dziś jest normalnym wyborem.
    if (odrzucPrzeszle && this.data(data) < this.data(new Date())) {
      throw new BadRequestException('Data wygaśnięcia nie może być w przeszłości.');
    }
    return data;
  }

  private walidujNotatke(wartosc: string | undefined): string | null {
    if (wartosc === undefined) return null;
    const obcieta = wartosc.trim();
    if (!obcieta) return null;
    if (obcieta.length > 2000) {
      throw new BadRequestException('Notatka ma maksymalnie 2000 znaków.');
    }
    return obcieta;
  }

  /** Opis osoby w dzienniku — czytelny bez otwierania katalogu. */
  private opisOsoby(osoba: PersonRow): string {
    const dzial = osoba.department ? ` (${osoba.department})` : '';
    return `${osoba.firstName} ${osoba.lastName}${dzial}`;
  }

  /** Format daty dla odpowiedzi API: `YYYY-MM-DD`. */
  private data(wartosc: Date): string {
    return wartosc.toISOString().slice(0, 10);
  }

  // ─── Walidacja wspólna z importem CSV ────────────────────────

  /**
   * Wspólna walidacja osoby. Osobna funkcja, nie wbudowana w `createPerson`,
   * bo import z CSV waliduje dokładnie te same reguły dla wierszy, które
   * przeszły podgląd — jeśli reguły rozejdą się, podgląd obiecuje
   * poprawny wiersz, a zapis go odrzuca.
   *
   * Zwraca znormalizowane dane, więc serwis zapisuje to, co zwalidował,
   * a nie to, co przyszło z formularza.
   */
  walidujOsobe(dto: {
    firstName: string;
    lastName: string;
    email: string;
    position?: string;
    department?: string;
    isActive?: boolean;
  }): {
    firstName: string;
    lastName: string;
    email: string;
    position?: string;
    department?: string;
    isActive?: boolean;
  } {
    const firstName = (dto.firstName ?? '').trim();
    const lastName = (dto.lastName ?? '').trim();
    if (!firstName) throw new BadRequestException('Podaj imię.');
    if (firstName.length > 100) throw new BadRequestException('Imię ma maksymalnie 100 znaków.');
    if (!lastName) throw new BadRequestException('Podaj nazwisko.');
    if (lastName.length > 100) throw new BadRequestException('Nazwisko ma maksymalnie 100 znaków.');

    return {
      firstName,
      lastName,
      email: this.walidujEmail(dto.email),
      position: this.walidujTekst(dto.position, 'Stanowisko'),
      department: this.walidujTekst(dto.department, 'Dział'),
      ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
    };
  }

  walidujEmail(email: string): string {
    const wartosc = (email ?? '').trim();
    if (!wartosc) throw new BadRequestException('Podaj adres e-mail.');
    if (/\s/.test(wartosc)) {
      throw new BadRequestException('Adres e-mail nie może zawierać spacji.');
    }
    // Prosty kształt, a nie pełny parser: kolumna `email` jest `@db.Citext`
    // z unikalnością, więc wadliwy adres i tak nie zapisze się dwukrotnie.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(wartosc)) {
      throw new BadRequestException(`„${wartosc}" nie wygląda na adres e-mail.`);
    }
    if (wartosc.length > 200) {
      throw new BadRequestException('Adres e-mail ma maksymalnie 200 znaków.');
    }
    return wartosc;
  }

  /** Wymaga niepustej wartości — pusty tekst po trimowaniu jest błędem. */
  private wymagajTekstu(wartosc: string, etykieta: string): void {
    if (!wartosc || !wartosc.trim()) {
      throw new BadRequestException(`Podaj ${etykieta.toLowerCase()}.`);
    }
    if (wartosc.trim().length > 100) {
      throw new BadRequestException(`${etykieta} ma maksymalnie 100 znaków.`);
    }
  }

  /** Pole opcjonalne: brak to `null`, nie pusty tekst. */
  private walidujTekst(wartosc: string | undefined, etykieta: string): string | undefined {
    if (wartosc === undefined) return undefined;
    const obcieta = wartosc.trim();
    if (!obcieta) return undefined;
    if (obcieta.length > 150) {
      throw new BadRequestException(`${etykieta} ma maksymalnie 150 znaków.`);
    }
    return obcieta;
  }
}
/**
 * Wiersz importu przychodzący od przeglądarki.
 *
 * Osobny typ od `ParsedPersonRow`, bo to dane niezaufane — serwis nie może
 * użyć pola `errors` z podglądu zamiast walidować wiersz od nowa.
 */
export type ImportRowInput = {
  email: string;
  firstName: string;
  lastName: string;
  position?: string;
  department?: string;
  isActive?: boolean;
};
