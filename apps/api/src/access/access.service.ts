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
  type AccessVerificationDto,
  type AccessVerificationRow,
  type VerificationScopeName,
  type ApplicationAccessRow,
  type ApplicationRefRow,
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
import { parseMatrixCsv, MAX_MATRIX_ROWS, type ParsedMatrixRow } from './matrix-csv';
import { ACCESS_LEVELS } from './dto/access.dto';

/**
 * Kształt adresu e-mail — jedno źródło prawdy dla `walidujEmail` (ręczne
 * zapisy, import osób) i rozstrzygania wiersza macierzy (kod wierszowy
 * `INVALID_EMAIL`). Prosty, nie pełny parser RFC: kolumna `email` jest
 * `@db.Citext` z unikalnością, więc wadliwy adres i tak nie zapisze się
 * dwukrotnie.
 */
const EMAIL_WZOR = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Poziomy akceptowane przy zapisie importu macierzy — te same co w DTO. */
const POZIOMY_ZAPISU: readonly string[] = ACCESS_LEVELS;

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
 *  5. **Twarde usunięcie osoby** (`DELETE /persons/:id`) to droga tylko dla
 *     błędnie wprowadzonych wpisów — kaskada grantów działa jak w schemacie;
 *     dezaktywacja idzie PATCH-em, bo przypisania mają zostać czytelne.
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

  /**
   * Licznik katalogu osób — pasek podsumowania nad listą na /uprawnienia.
   * Liczenie idzie do bazy (COUNT), bo lista osób jest filtrowana
   * i nie mówi nic o globalnym stanie katalogu.
   */
  async licznikOsob(): Promise<{ total: number; active: number; inactive: number }> {
    const [total, active] = await Promise.all([
      this.prisma.person.count({}),
      this.prisma.person.count({ where: { isActive: true } }),
    ]);
    return { total, active, inactive: total - active };
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

    const changes = AuditService.diff(
      przed as unknown as Record<string, unknown>,
      { ...przed, ...data } as unknown as Record<string, unknown>,
      ['updatedAt', 'createdAt', 'accessCount'],
    );
    if (Object.keys(changes).length === 0) return osoba;

    // Akcja dziennika wynika ze zmiany aktywności, nie z kształtu payloadu:
    // PATCH z `isActive: false` to w dzienniku „Dezaktywowano osobę",
    // nie „Zmieniono dane osoby".
    const zmianaAktywnosci = data.isActive !== undefined && data.isActive !== przed.isActive;
    const action =
      zmianaAktywnosci
        ? data.isActive
          ? 'person.activated'
          : 'person.deactivated'
        : 'person.updated';

    await this.audit.record({
      action,
      entity: 'Person',
      entityId: id,
      actorId: actor.id,
      actorName: actor.username,
      changes,
      ip,
    });

    return osoba;
  }

  /**
   * Twarde usunięcie osoby — wyłącznie dla błędnie wprowadzonych wpisów.
   * Baza sama kaskadowo kasuje przypisania (`onDelete: Cascade` przy
   * `ApplicationAccess.person`) i czyści powiązania właściciela, więc tu
   * wystarczy skasować wiersz i zapisać w dzienniku migawkę: po usunięciu
   * w katalogu nie ma już czego czytać, dlatego liczbę przypisań trzeba
   * znać **przed** kasowaniem.
   *
   * Odchodzące z organizacji osoby przechodzą przez PATCH z
   * `isActive: false` — ich przypisania mają zostać czytelne.
   */
  async deletePerson(id: string, actor: AuthUser, ip?: string): Promise<void> {
    const osoba = await this.getPerson(id);
    const przypisania = await this.prisma.applicationAccess.count({
      where: { personId: id },
    });

    await this.prisma.person.delete({ where: { id } });

    await this.audit.record({
      action: 'person.deleted',
      entity: 'Person',
      entityId: id,
      actorId: actor.id,
      actorName: actor.username,
      changes: {
        fullName: { from: `${osoba.firstName} ${osoba.lastName}`, to: null },
        email: { from: osoba.email, to: null },
        accessCount: { from: null, to: przypisania },
      },
      ip,
    });
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
      verifiedOn: grant.verifiedOn ? this.data(grant.verifiedOn) : null,
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
    await this.requireApplicationWithMatrix(applicationId);

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
    await this.requireApplicationWithMatrix(applicationId);

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
    // Zmiana poziomu unieważnia potwierdzenie: weryfikacja dotyczyła
    // dawnego stanu dostępu, a nie tego, który dopiero powstaje. Notatka
    // i data wygasania takiej siły nie mają — to opisy, nie zmiana uprawnienia.
    if (dto.level !== undefined && dto.level !== przed.level) data.verifiedOn = null;

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
    // Aplikacje GENERAL_USE nie mają macierzy — pomijamy je nawet, gdy
    // w bazie zostały historyczne granty (serwerowo, bo frontend filtruje
    // tylko listę wyboru aplikacji).
    where.application = { is: { deliveryType: { not: 'GENERAL_USE' } } };

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
      verifiedOn: g.verifiedOn ? this.data(g.verifiedOn) : null,
      note: g.note,
    }));
  }

  // ─── Weryfikacje dostępów ────────────────────────────────────

  /**
   * Rejestr przeglądów macierzy: wpis „dnia X osoba Y potwierdziła,
   * że zapisane dostępy są aktualne".
   *
   * Zakres jest trójstopniowy i decyduje, które pola dto mają sens:
   *
   *  - `MATRIX` — cała macierz; `applicationId`/`personId` nie mogą
   *    wystąpić (sprzeczny request to 400, nie ciche zignorowanie pola),
   *  - `APPLICATION` — jedna aplikacja, wymagana,
   *  - `GRANT` — aplikacja + osoba; grant musi istnieć, bo weryfikacja
   *    nieistniejącego przypisania nic nie potwierdza.
   *
   * Wpis i stamp grantów idą jednym przepływem: wpis bez stampu zostawiłby
   * historię, z którą macierz się rozjechała (wiersze „—" mimo przeglądu).
   */
  async createVerification(
    dto: {
      scope: VerificationScopeName;
      verifiedOn?: string;
      note?: string;
      applicationId?: string;
      personId?: string;
    },
    actor: AuthUser,
    ip?: string,
  ): Promise<AccessVerificationDto> {
    // Data przeglądu jest opcjonalna (domyślnie dziś) i nie może być
    // z przyszłości — przegląd, który się jeszcze nie odbył, to wpis
    // zaśmiecający historię.
    const verifiedOn = this.walidujDateWeryfikacji(dto.verifiedOn);
    const note = this.walidujNotatke(dto.note);

    if (dto.scope === 'MATRIX' && dto.applicationId) {
      throw new BadRequestException(
        'Weryfikacja całej macierzy nie przyjmuje aplikacji — zawęź zakres do APPLICATION.',
      );
    }

    let aplikacja: ApplicationRefRow | null = null;
    if (dto.scope === 'APPLICATION' || dto.scope === 'GRANT') {
      if (!dto.applicationId) {
        throw new BadRequestException('Podaj aplikację objętą weryfikacją.');
      }
      aplikacja = await this.requireApplicationWithMatrix(dto.applicationId);
    }

    let osoba: PersonRow | null = null;
    if (dto.scope === 'GRANT') {
      if (!dto.personId) {
        throw new BadRequestException('Podaj osobę, której dostęp weryfikujesz.');
      }
      osoba = await this.getPerson(dto.personId);
      const grant = await this.prisma.applicationAccess.findUnique({
        where: {
          applicationId_personId: { applicationId: aplikacja!.id, personId: osoba.id },
        },
      });
      if (!grant) throw new NotFoundException('To przypisanie nie istnieje.');
    }

    // Blokada 24 h: weryfikacja aplikacji i całej macierzy to dowód
    // przeglądu — dwie tego samego dnia nie dowodzą dwóch przeglądów.
    // Liczymy od `createdAt` (moment zapisu), nie od `verifiedOn`:
    // cofnięcie daty w formularzu nie może otworzyć blokady.
    await this.walidujOdstepWeryfikacji(dto.scope, aplikacja?.id ?? null);

    const wpis = await this.prisma.accessVerification.create({
      data: {
        scope: dto.scope,
        verifiedOn,
        note,
        applicationId: aplikacja?.id ?? null,
        personId: osoba?.id ?? null,
        personName: osoba ? `${osoba.firstName} ${osoba.lastName}` : null,
        actorId: actor.id,
        // Nazwisko z sesji, nie login: weryfikującego pokazuje się
        // właścicielom aplikacji, którzy logina nie znają.
        actorName: actor.fullName,
      },
    });

    await this.stampujGranty(dto.scope, aplikacja?.id ?? null, osoba?.id ?? null, verifiedOn);

    await this.audit.record({
      action: 'access.verified',
      entity: 'AccessVerification',
      entityId: wpis.id,
      actorId: actor.id,
      actorName: actor.username,
      changes: {
        scope: { from: null, to: dto.scope },
        application: { from: null, to: aplikacja?.name ?? null },
        person: { from: null, to: osoba ? this.opisOsoby(osoba) : null },
        verifiedOn: { from: null, to: this.data(verifiedOn) },
      },
      ip,
    });

    return this.formatWeryfikacja(wpis, aplikacja);
  }

  /**
   * Historia weryfikacji — od najnowszej. Filtr aplikacji służy sekcji na
   * karcie aplikacji, brak filtrów — rejestrowi całej macierzy.
   */
  async listVerifications(filters: {
    applicationId?: string;
    scope?: VerificationScopeName;
  }): Promise<{ wpisy: AccessVerificationDto[] }> {
    const wpisy = await this.prisma.accessVerification.findMany({
      where: {
        ...(filters.applicationId ? { applicationId: filters.applicationId } : {}),
        ...(filters.scope ? { scope: filters.scope } : {}),
      },
      orderBy: [{ verifiedOn: 'desc' }],
      // Nazwa aplikacji w odpowiedzi: sekcja rejestru ma pokazać „co objęto"
      // bez drugiego zapytania. Bez `include` relacja w Prisma wychodzi
      // jako `undefined` i wpis wyglądałby jak przegląd całej macierzy.
      include: { application: true },
    });
    return { wpisy: wpisy.map((w) => this.formatWeryfikacja(w, w.application)) };
  }

  /**
   * Stawia znacznik `verifiedOn` grantom w zasięgu wpisu. Pętla aktualizacji
   * zamiast `updateMany`, bo port macierzy nie eksponuje updateMany —
   * stampowanie dotyczy raportu jednorazowego, a granty w zasięgu liczy się
   * w tysiącach najwyżej.
   */
  private async stampujGranty(
    scope: VerificationScopeName,
    applicationId: string | null,
    personId: string | null,
    verifiedOn: Date,
  ): Promise<void> {
    const where: GrantWhere = {};
    if (scope === 'APPLICATION') where.applicationId = applicationId!;
    if (scope === 'GRANT') {
      where.applicationId = applicationId!;
      where.personId = personId!;
    }
    if (scope === 'MATRIX') {
      // Historyczne granty aplikacji GENERAL_USE nie wracają do macierzy
      // razem z resztą — ten sam odsiew, którego używa widok macierzy.
      where.application = { is: { deliveryType: { not: 'GENERAL_USE' } } };
    }

    const granty = (await this.prisma.applicationAccess.findMany({ where })) as ApplicationAccessRow[];
    for (const grant of granty) {
      await this.prisma.applicationAccess.update({
        where: {
          applicationId_personId: { applicationId: grant.applicationId, personId: grant.personId },
        },
        data: { verifiedOn },
      });
    }
  }

  /**
   * Blokada 24 h między przeglądami (weryfikacja APPLICATION i MATRIX).
   *
   * Punkt odniesienia to `createdAt` wpisu — zapis w bazie, nie
   * deklarowana data przeglądu; cofnięcie `verifiedOn` nie otwiera
   * blokady. Wpis `GRANT` nie bierze udziału: drobna korekta jednego
   * wiersza nie jest przeglądem, więc nie blokuje i nie jest blokowana.
   * Wpis MATRIX obejmuje wszystkie aplikacje, więc blokuje weryfikację
   * aplikacji; odwrotnie — nie (przegląd jednej aplikacji nie zwalnia
   * z przeglądu reszty macierzy).
   */
  private async walidujOdstepWeryfikacji(
    scope: VerificationScopeName,
    applicationId: string | null,
  ): Promise<void> {
    if (scope === 'GRANT') return;

    const granica = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const wpisy = await this.prisma.accessVerification.findMany({
      where: { createdAt: { gt: granica } },
    });

    const ostatni = wpisy.find((w) =>
      scope === 'MATRIX'
        ? w.scope === 'MATRIX'
        : w.scope === 'MATRIX' ||
          (w.scope === 'APPLICATION' && w.applicationId === applicationId),
    );
    if (!ostatni) return;

    const nastepna = new Date(ostatni.createdAt.getTime() + 24 * 60 * 60 * 1000);
    const godzina = nastepna.toISOString().slice(0, 16).replace('T', ' ');
    const co = ostatni.scope === 'MATRIX'
      ? 'Weryfikacja całej macierzy'
      : 'Weryfikacja tej aplikacji';
    throw new ConflictException(
      `${co} została już odnotowana w ciągu ostatnich 24 godzin — ` +
        `kolejna możliwa od ${godzina} (czas serwera).`,
    );
  }

  /** Data przeglądu: opcjonalna (domyślnie dziś), nigdy z przyszłości. */
  private walidujDateWeryfikacji(wartosc: string | undefined): Date {
    if (wartosc === undefined || wartosc === '') return new Date();
    const data = new Date(wartosc);
    if (Number.isNaN(data.getTime())) {
      throw new BadRequestException(`„${wartosc}" nie jest datą.`);
    }
    // Porównanie po dacie, nie po znaczniku czasu — jak w
    // `walidujWygasanie`, bo `@db.Date` nie zna godzin.
    if (this.data(data) > this.data(new Date())) {
      throw new BadRequestException('Data weryfikacji nie może być w przyszłości.');
    }
    return data;
  }

  /** Kształt wpisu w odpowiedzi API — daty jako `YYYY-MM-DD`. */
  private formatWeryfikacja(
    wpis: AccessVerificationRow,
    aplikacja: ApplicationRefRow | null,
  ): AccessVerificationDto {
    return {
      id: wpis.id,
      scope: wpis.scope,
      verifiedOn: this.data(wpis.verifiedOn),
      note: wpis.note,
      application: aplikacja ? { id: aplikacja.id, name: aplikacja.name } : null,
      personId: wpis.personId,
      personName: wpis.personName,
      actorName: wpis.actorName,
    };
  }

  // ─── Raport macierzy (eksport CSV) ──────────────────────────

  /**
   * Eksport raportu macierzy — pełny albo jednej aplikacji.
   *
   * Raport jest dowodem półrocznego przeglądu, więc pokazuje stan całej
   * ewidencji: każdą aplikację z macierzą (także bez grantów — wiersz
   * `(brak pozycji)`), z datą wygenerowania w pierwszej linii. Filtry
   * katalogu tu nie działają — przegląd obejmuje wszystko albo jedną
   * aplikację, do wręczenia jej właścicielowi.
   *
   * Aplikacja usunięta nie wchodzi do raportu: przegląd dotyczy żywego
   * rejestru, a granty usuniętej aplikacji nie mogą wypaść bez nagłówka
   * aplikacji. GENERAL_USE nie ma macierzy — pomijane razem z filtrami
   * `matrix()`.
   */
  async exportMatrixCsv(
    applicationId?: string,
  ): Promise<{ csv: string; nazwaPliku: string }> {
    const dzisiaj = new Date().toISOString().slice(0, 10);

    let aplikacjeBaza: ApplicationRefRow[];
    if (applicationId) {
      const jedna = await this.requireApplication(applicationId);
      if (jedna.deliveryType === 'GENERAL_USE') {
        throw new NotFoundException('Aplikacja ogólnego użytku nie ma macierzy uprawnień.');
      }
      aplikacjeBaza = [jedna];
    } else {
      aplikacjeBaza = await this.prisma.application.findMany({
        where: { deletedAt: null, deliveryType: { not: 'GENERAL_USE' } },
      });
      // Sortowanie w serwisie: lista aplikacji do raportu jest jednorazowa,
      // a `localeCompare('pl')` daje kolejność, której spodziewa się człowiek.
      aplikacjeBaza.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    }

    const granty = await this.matrix(applicationId ? { applicationId } : {});
    // Granty aplikacji, których nie ma na liście (usunięte), odsiewamy tu —
    // ich aplikacja nie dostanie wiersza, więc grant nie może im towarzyszyć.
    const identyfikatory = new Set(aplikacjeBaza.map((a) => a.id));

    const wlasciciele = new Map<string, string>();
    const identyfikatoryWlascicieli = [
      ...new Set(
        aplikacjeBaza.map((a) => a.ownerId).filter((id): id is string => Boolean(id)),
      ),
    ];
    for (const id of identyfikatoryWlascicieli) {
      const osoba = await this.prisma.person.findUnique({ where: { id } });
      if (osoba) wlasciciele.set(id, `${osoba.firstName} ${osoba.lastName}`);
    }

    const raportAplikacje: RaportAplikacja[] = aplikacjeBaza.map((a) => ({
      id: a.id,
      nazwa: a.name,
      status: a.status ?? '',
      klasyfikacja: a.securityClass ?? '',
      krytycznosc: a.criticality ?? 0,
      typDostarczania: a.deliveryType ?? '',
      wlasciciel: a.ownerId ? (wlasciciele.get(a.ownerId) ?? '') : '',
    }));

    const raportGranty: RaportGrantu[] = granty
      .filter((g) => identyfikatory.has(g.application.id))
      .map((g) => ({
        aplikacjaId: g.application.id,
        osoba: `${g.person.firstName} ${g.person.lastName}`,
        email: g.person.email,
        departament: g.person.department,
        stanowisko: g.person.position,
        poziom: g.level,
        nadane: g.grantedOn,
        wygasa: g.expiresOn,
        notatka: g.note,
      }));

    return {
      csv: budujRaportCsv(raportAplikacje, raportGranty, dzisiaj),
      nazwaPliku: applicationId
        ? `raport-uprawnien-${slugNazwy(aplikacjeBaza[0]!.name)}-${dzisiaj}.csv`
        : `macierz-uprawnien-${dzisiaj}.csv`,
    };
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

  // ─── Import macierzy z CSV ──────────────────────────────────────

  /**
   * Podgląd importu macierzy: klasyfikuje każdy wiersz, nic nie zapisuje.
   *
   * Import jest okrężny z eksportem — plik raportu po poprawkach właściciela
   * wraca do ewidencji. Semantyka: **upsert** — wiersz nadaje nowy grant
   * albo aktualizuje istniejący; osoba nieobecna w pliku zachowuje dostęp,
   * więc pusty lub ucięty plik nic nie odbiera.
   *
   * Tryb pojedynczy (`applicationId`) rozpoznaje aplikację z requestu
   * i pilnuje, żeby wiersze nie wskazywały innej. Tryb całościowy
   * rozpoznaje aplikacje po unikalnej nazwie z kolumny „Aplikacja".
   */
  async previewMatrixImport(
    text: string,
    applicationId?: string,
  ): Promise<MatrixImportPreview> {
    const kontekst = applicationId
      ? await this.requireApplicationWithMatrix(applicationId)
      : null;
    const wczytany = this.wczytajMacierzCsv(text, Boolean(applicationId));

    const rozstrzygniete: Array<{
      wiersz: ParsedMatrixRow;
      aplikacja: ApplicationRefRow | null;
      osoba: PersonRow | null;
      grant: ApplicationAccessRow | null;
      errors: string[];
      diff: MatrixDiffZmiana[];
    }> = [];
    for (const wiersz of wczytany.rows) {
      rozstrzygniete.push(await this.rozstrzygnijWierszMacierzy(wiersz, kontekst));
    }

    const rows = rozstrzygniete.map((r) => ({
      ...r.wiersz,
      // Błędy parsera + błędy rozstrzygnięcia (baza) w jednym koszu —
      // podgląd pokazuje komplet, nie tylko składnię pliku.
      errors: r.errors,
      status: this.statusWierszaMacierzy(r),
      diff: r.diff,
    }));

    const licznikAplikacji = new Map<string, { id: string; nazwa: string; wiersze: number }>();
    for (const r of rozstrzygniete) {
      if (!r.aplikacja) continue;
      const wpis =
        licznikAplikacji.get(r.aplikacja.id) ??
        { id: r.aplikacja.id, nazwa: r.aplikacja.name, wiersze: 0 };
      wpis.wiersze++;
      licznikAplikacji.set(r.aplikacja.id, wpis);
    }

    return {
      rows,
      aplikacje: [...licznikAplikacji.values()],
      summary: {
        total: rows.length,
        new: rows.filter((w) => w.status === 'NEW').length,
        newPerson: rows.filter((w) => w.status === 'NEW_PERSON').length,
        update: rows.filter((w) => w.status === 'UPDATE').length,
        unchanged: rows.filter((w) => w.status === 'UNCHANGED').length,
        invalid: rows.filter((w) => w.status === 'ERROR').length,
      },
    };
  }

  /** Parser macierzy z ujednoliconym tłumaczeniem błędów wejścia na 400. */
  private wczytajMacierzCsv(text: string, pojedyncza: boolean) {
    try {
      return parseMatrixCsv(text, { pojedyncza });
    } catch (blad) {
      if (blad instanceof CsvError) {
        throw new BadRequestException(blad.message);
      }
      throw blad;
    }
  }

  /**
   * Rozstrzyga jeden wiersz importu macierzy: aplikację, osobę i grant.
   *
   * Błędy wiersza zbierają się tu w jeden kosz — te z parsera (składnia
   * pliku) i te z bazy (nieznana aplikacja, nieaktywna osoba, wygasanie
   * w przeszłości). Zapis użyje tej samej metody po swojej walidacji,
   * żeby podgląd i zapis nie rozeszły się regułami.
   */
  private async rozstrzygnijWierszMacierzy(
    wiersz: WierszMacierzyWejscie,
    kontekst: ApplicationRefRow | null,
  ): Promise<{
    wiersz: ParsedMatrixRow;
    aplikacja: ApplicationRefRow | null;
    osoba: PersonRow | null;
    grant: ApplicationAccessRow | null;
    errors: string[];
    diff: MatrixDiffZmiana[];
  }> {
    const errors = [...wiersz.errors];

    // Kształt e-maila: pełna walidacja modułu (`walidujEmail` — spacje,
    // kształt, długość), ale tłumaczona na kod wiersza, żeby podgląd pokazał
    // popełniony błąd zamiast nieobjaśnionego odrzucenia.
    if (wiersz.email !== '') {
      try {
        this.walidujEmail(wiersz.email);
      } catch {
        errors.push('INVALID_EMAIL');
      }
    }

    let aplikacja: ApplicationRefRow | null = null;
    if (kontekst) {
      // Tryb pojedynczy: aplikacja z requestu; kolumna „Aplikacja" jest
      // tylko kontrolą, że właściciel nie pomylił plików. Porównanie
      // case-insensitive jak citext nazwy — po drodze przez Excel
      // wielkość liter bywa poprawiona ręcznie i nie jest to pomyłka
      // pliku.
      if (
        wiersz.aplikacja !== null &&
        wiersz.aplikacja.toLowerCase() !== kontekst.name.toLowerCase()
      ) {
        errors.push('APP_MISMATCH');
      } else {
        aplikacja = kontekst;
      }
    } else if (wiersz.aplikacja === null) {
      // Całościowy bez nazwy aplikacji: nie ma czego rozpoznać.
      errors.push('UNKNOWN_APP');
    } else {
      const znaleziona = await this.prisma.application.findUnique({
        where: { name: wiersz.aplikacja },
      });
      if (!znaleziona || znaleziona.deletedAt) {
        errors.push('UNKNOWN_APP');
      } else if (znaleziona.deliveryType === 'GENERAL_USE') {
        errors.push('GENERAL_USE_APP');
      } else {
        aplikacja = znaleziona;
      }
    }

    let osoba: PersonRow | null = null;
    let grant: ApplicationAccessRow | null = null;
    let diff: MatrixDiffZmiana[] = [];

    if (errors.length === 0) {
      osoba = wiersz.email
        ? await this.prisma.person.findFirst({ where: { email: wiersz.email } })
        : null;

      if (osoba && !osoba.isActive) {
        // Reguła jak przy ręcznym nadawaniu: nieaktywna osoba nie wchodzi
        // do macierzy, dopóki administrator nie aktywuje jej w katalogu.
        errors.push('PERSON_INACTIVE');
      } else if (!osoba && (!wiersz.firstName || !wiersz.lastName)) {
        errors.push('MISSING_NAME');
      } else if (osoba && aplikacja) {
        grant = await this.prisma.applicationAccess.findUnique({
          where: { applicationId_personId: { applicationId: aplikacja.id, personId: osoba.id } },
        });
        if (grant) {
          diff = this.diffGranta(grant, wiersz);
        } else if (
          wiersz.expiresOn !== null &&
          this.data(new Date(wiersz.expiresOn)) < this.data(new Date())
        ) {
          // Granica jak przy ręcznym nadawaniu: nowy dostęp nie może być
          // od razu wygasły. Przy aktualizacji porządkowanie daty jest
          // dozwolone — diff powyżej to pokazuje.
          errors.push('EXPIRY_IN_PAST');
        }
      }
    }

    return { wiersz: wiersz as ParsedMatrixRow, aplikacja, osoba, grant, errors, diff };
  }

  /**
   * Różnice wiersza wobec istniejącego grantu — tylko pola, które import
   * zmienia. Pusta komórka „Wygasa"/„Notatka" czyści wartość: plik jest
   * żądanym stanem pól grantu, a bez tego nie da się zdjąć daty wygasania.
   */
  private diffGranta(
    grant: ApplicationAccessRow,
    wiersz: WierszMacierzyWejscie,
  ): MatrixDiffZmiana[] {
    const zmiany: MatrixDiffZmiana[] = [];
    if (grant.level !== wiersz.level) {
      zmiany.push({ pole: 'poziom', od: grant.level, do: wiersz.level });
    }
    const odWygasa = grant.expiresOn ? this.data(grant.expiresOn) : '';
    const doWygasa = wiersz.expiresOn ?? '';
    if (odWygasa !== doWygasa) {
      zmiany.push({ pole: 'wygasa', od: odWygasa, do: doWygasa });
    }
    const odNota = grant.note ?? '';
    const doNota = wiersz.note ?? '';
    if (odNota !== doNota) {
      zmiany.push({ pole: 'notatka', od: odNota, do: doNota });
    }
    return zmiany;
  }

  private statusWierszaMacierzy(r: {
    osoba: PersonRow | null;
    grant: ApplicationAccessRow | null;
    errors: string[];
    diff: MatrixDiffZmiana[];
  }): MatrixImportRowStatus {
    if (r.errors.length > 0) return 'ERROR';
    if (r.grant) return r.diff.length > 0 ? 'UPDATE' : 'UNCHANGED';
    return r.osoba ? 'NEW' : 'NEW_PERSON';
  }

  /**
   * Zapis importu macierzy: upsert grantów.
   *
   * Podgląd i zapis rozdziela przerwa w pracy — payload z przeglądarki jest
   * niezaufany, więc **każdy wiersz jest walidowany od nowa** tymi samymi
   * regułami. Wiersz, którego nie da się zapisać, jest pomijany i zliczany
   * (z powodem, który administrator widzi w wyniku); pozostałe przechodzą.
   *
   * `grantedOn` ustawia baza (default) — kolumna „Nadane" z pliku jest
   * ignorowana, dokładnie jak przy ręcznym nadawaniu.
   */
  async applyMatrixImport(
    rows: MatrixApplyRowInput[],
    actor: AuthUser,
    ip?: string,
    applicationId?: string,
  ): Promise<MatrixImportResult> {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestException('Import nie zawiera żadnego wiersza.');
    }
    if (rows.length > MAX_MATRIX_ROWS) {
      throw new BadRequestException(`Import przekracza limit ${MAX_MATRIX_ROWS} wierszy.`);
    }
    const kontekst = applicationId
      ? await this.requireApplicationWithMatrix(applicationId)
      : null;

    let createdGrants = 0;
    let updatedGrants = 0;
    let createdPersons = 0;
    let unchanged = 0;
    const skippedRows: MatrixImportResult['skippedRows'] = [];

    // Duplikaty w payloadzie: podgląd je wykrywa, ale między podglądem
    // a zapisem payload może przyjść z innego klienta — bez tego drugi
    // wiersz nadpisywałby pierwszy po cichu.
    const widziane = new Set<string>();

    for (const wejscie of rows) {
      const wiersz = this.zbudujWierszMacierzy(wejscie);
      if (wiersz.email !== '') {
        const klucz = `${wiersz.aplikacja ?? kontekst?.name ?? ''}\u0000${wiersz.email.toLowerCase()}`;
        if (widziane.has(klucz)) wiersz.errors.push('DUPLICATE_IN_FILE');
        else widziane.add(klucz);
      }

      const rozstrzygniety = await this.rozstrzygnijWierszMacierzy(wiersz, kontekst);

      if (rozstrzygniety.errors.length > 0) {
        skippedRows.push({
          email: wiersz.email,
          aplikacja: rozstrzygniety.aplikacja?.name ?? wiersz.aplikacja,
          errors: rozstrzygniety.errors,
        });
        continue;
      }

      const { aplikacja: ap, grant, diff } = rozstrzygniety;
      const aplikacjaDocelowa = ap!;
      let osobaZap = rozstrzygniety.osoba;

      if (!osobaZap) {
        try {
          osobaZap = await this.prisma.person.create({
            data: this.walidujOsobe({
              firstName: wiersz.firstName!,
              lastName: wiersz.lastName!,
              email: wiersz.email,
              position: wejscie.position,
              department: wejscie.department,
            }),
          });
        } catch {
          // Wiersz doszedł tu w pełni zwalidowany (limitów, imienia i e-maila
          // pilnowały wcześniejsze kody), więc wyjątek zapisu to awaria bazy
          // albo wyścig unikalności — powód ma to mówić, a nie sugerować
          // brak imienia, który odsiał się wcześniej.
          skippedRows.push({
            email: wiersz.email,
            aplikacja: aplikacjaDocelowa.name,
            errors: ['PERSON_SAVE_FAILED'],
          });
          continue;
        }
        createdPersons++;
      }

      const expiresOn = wiersz.expiresOn ? new Date(wiersz.expiresOn) : null;

      // Wiersze z poziomem spoza `POZIOMY_ZAPISU` mają błąd `INVALID_LEVEL`
      // i są pominięte przed tym miejscem, więc rzut jest bezpieczny.
      const poziom = wiersz.level as AccessLevelName;

      if (!grant) {
        await this.prisma.applicationAccess.create({
          data: {
            applicationId: aplikacjaDocelowa.id,
            personId: osobaZap.id,
            level: poziom,
            expiresOn,
            note: wiersz.note,
          },
        });
        createdGrants++;
      } else if (diff.length > 0) {
        await this.prisma.applicationAccess.update({
          where: { applicationId_personId: { applicationId: aplikacjaDocelowa.id, personId: osobaZap.id } },
          data: {
            level: poziom,
            expiresOn,
            note: wiersz.note,
            // Plik żąda zmiany grantu — jeżeli rusza poziom, to znaczy, że
            // zweryfikowany stan nie istnieje i znacznik musi spaść. Notatka
            // i wygasanie opisują grant, więc ich zmiana stampu nie rusza.
            ...(diff.some((z) => z.pole === 'poziom') ? { verifiedOn: null } : {}),
          },
        });
        updatedGrants++;
      } else {
        unchanged++;
      }
    }

    const skipped = skippedRows.length;

    // Jeden wpis z liczbami — import tysiąca wierszy nie może zasypać
    // dziennika tysiącem wpisów (wzorzec `person.imported`).
    await this.audit.record({
      action: 'access.imported',
      entity: 'ApplicationAccess',
      entityId: null,
      actorId: actor.id,
      actorName: actor.username,
      changes: {
        createdGrants: { from: null, to: createdGrants },
        updatedGrants: { from: null, to: updatedGrants },
        createdPersons: { from: null, to: createdPersons },
        unchanged: { from: null, to: unchanged },
        skipped: { from: null, to: skipped },
      },
      ip,
    });

    return { createdGrants, updatedGrants, createdPersons, unchanged, skipped, skippedRows };
  }

  /**
   * Walidacja wiersza z payloadu i przepięcie na kształt wspólny
   * z parserem — zapis nie ufa polom „po walidacji" z przeglądarki,
   * więc każdy wiersz przechodzi tę samą drogę co wiersz z pliku.
   */
  private zbudujWierszMacierzy(wejscie: MatrixApplyRowInput): WierszMacierzyWejscie {
    const errors: string[] = [];

    const email = (wejscie.email ?? '').trim();
    if (email === '') errors.push('MISSING_EMAIL');

    // Poziom spoza listy jest błędem wiersza, a nie błędem requestu —
    // DTO (class-validator) go łapie, ale serwis nie ufa payloadowi.
    if (!POZIOMY_ZAPISU.includes(wejscie.level ?? '')) errors.push('INVALID_LEVEL');

    const wygasa = wejscie.expiresOn?.trim() ?? '';
    if (wygasa !== '' && !(/^\d{4}-\d{2}-\d{2}$/.test(wygasa) && !Number.isNaN(new Date(wygasa).getTime()))) {
      errors.push('INVALID_DATE');
    }

    const notatka = wejscie.note?.trim() || null;
    if (notatka !== null && notatka.length > 2000) errors.push('NOTE_TOO_LONG');

    // Limity długości pól jak w DTO i parserze: podgląd i zapis mają
    // mówić jednym językiem, długi wiersz jest pomijany z powodem,
    // a nie wywraca całości requestu na 400.
    const pola: Array<[string | undefined, number]> = [
      [email, 200],
      [wejscie.firstName?.trim(), 100],
      [wejscie.lastName?.trim(), 100],
      [wejscie.position, 150],
      [wejscie.department, 150],
      [wejscie.applicationName?.trim(), 200],
    ];
    if (pola.some(([wartosc, limit]) => wartosc !== undefined && wartosc !== null && wartosc.length > limit)) {
      errors.push('FIELD_TOO_LONG');
    }

    return {
      aplikacja: wejscie.applicationName?.trim() || null,
      email,
      firstName: wejscie.firstName?.trim() || null,
      lastName: wejscie.lastName?.trim() || null,
      level: wejscie.level,
      expiresOn: wygasa === '' ? null : wygasa,
      note: notatka,
      errors,
    };
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
   * Aplikacja z macierzą uprawnień. Aplikacje ogólnego użytku (GENERAL_USE)
   * macierzy nie mają — nie da się im nadać ani zmienić dostępu.
   * `revokeGrant` celowo omija ten warunek: odbiór dostępu ma zawsze działać,
   * żeby dało się posprzątać historyczne wpisy.
   */
  private async requireApplicationWithMatrix(applicationId: string) {
    const aplikacja = await this.requireApplication(applicationId);
    if (aplikacja.deliveryType === 'GENERAL_USE') {
      throw new BadRequestException(
        'Aplikacje ogólnego użytku nie mają macierzy uprawnień.',
      );
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
    if (!EMAIL_WZOR.test(wartosc)) {
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

// ─── Import macierzy uprawnień (CSV) ────────────────────────────

/** Status wiersza importu macierzy w podglądzie. */
export type MatrixImportRowStatus = 'NEW' | 'NEW_PERSON' | 'UPDATE' | 'UNCHANGED' | 'ERROR';

/** Jedna zmiana wiersza `UPDATE` — „od → do" dla pola grantu. */
export type MatrixDiffZmiana = {
  pole: 'poziom' | 'wygasa' | 'notatka';
  od: string;
  do: string;
};

/**
 * Wiersz macierzy po walidacji wejścia — kształt wspólny dla parsera
 * (`ParsedMatrixRow`) i walidacji zapisu, żeby rozstrzyganie aplikacji,
 * osoby i grantu działało na jednym typie.
 */
type WierszMacierzyWejscie = {
  aplikacja: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  level: string;
  expiresOn: string | null;
  note: string | null;
  errors: string[];
};

/** Odpowiedź podglądu importu macierzy. */
export type MatrixImportPreview = {
  rows: Array<ParsedMatrixRow & { status: MatrixImportRowStatus; diff: MatrixDiffZmiana[] }>;
  aplikacje: Array<{ id: string; nazwa: string; wiersze: number }>;
  summary: {
    total: number;
    new: number;
    newPerson: number;
    update: number;
    unchanged: number;
    invalid: number;
  };
};

/**
 * Wiersz zapisu importu macierzy — dane **niezaufane** z przeglądarki.
 * Serwis waliduje każdy wiersz od nowa (powyższe reguły), bez pola `errors`
 * z podglądu — tak jak import osób.
 */
export type MatrixApplyRowInput = {
  email: string;
  firstName?: string;
  lastName?: string;
  position?: string;
  department?: string;
  level: string;
  expiresOn?: string;
  note?: string;
  applicationName?: string;
};

/** Wynik zapisu importu macierzy — liczniki i lista pominiętych wierszy. */
export type MatrixImportResult = {
  createdGrants: number;
  updatedGrants: number;
  createdPersons: number;
  unchanged: number;
  skipped: number;
  skippedRows: Array<{ email: string; aplikacja: string | null; errors: string[] }>;
};

// ─── Raport macierzy uprawnień (eksport CSV) ──────────────────

/**
 * Aplikacja w wersji na potrzeby raportu — pola już spłaszczone.
 *
 * Osobne typy od wierszy Prisma, bo raport ma swoją kolejność kolumn
 * i własne nazwy — builder ma być czytelny bez zaglądania w schemat bazy.
 */
export type RaportAplikacja = {
  id: string;
  nazwa: string;
  status: string; // wartość enumu AppStatus, np. 'PROD'
  klasyfikacja: string; // wartość enumu SecurityClass
  krytycznosc: number; // 1–4
  typDostarczania: string; // wartość enumu DeliveryType, nigdy GENERAL_USE
  wlasciciel: string; // 'Imię Nazwisko' albo ''
};

/** Jeden grant w wersji na potrzeby raportu — daty jako `YYYY-MM-DD`. */
export type RaportGrantu = {
  aplikacjaId: string;
  osoba: string; // 'Imię Nazwisko'
  email: string;
  departament: string | null;
  stanowisko: string | null;
  poziom: AccessLevelName; // surowe wartości enumu, jak w API
  nadane: string;
  wygasa: string | null;
  notatka: string | null;
};

/** Mapowanie polskich liter przed NFD — `ł` nie rozwija się do postaci bazowej. */
const POLSKIE_LITERY: Record<string, string> = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ź: 'z',
  ż: 'z',
};

/**
 * Slug nazwy aplikacji do nazwy pliku: `Żółw 3D` → `zolw-3d`.
 * Po polskich literach i odcięciu znaków diakrytycznych (NFD) zostają
 * litery, cyfry i myślniki; pusty wynik (nazwa ze samych symboli) → `aplikacja`.
 */
function slugNazwy(nazwa: string): string {
  return (
    nazwa
      .toLowerCase()
      .replace(/[ąćęłńóśźż]/g, (znak) => POLSKIE_LITERY[znak]!)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'aplikacja'
  );
}

const NAGLOWEK_RAPORTU = [
  'Aplikacja',
  'Status aplikacji',
  'Klasyfikacja',
  'Krytyczność',
  'Typ dostarczania',
  'Właściciel aplikacji',
  'Osoba',
  'E-mail',
  'Departament',
  'Stanowisko',
  'Poziom',
  'Nadane',
  'Wygasa',
  'Status grantu',
  'Notatka',
];

/**
 * Buduje CSV raportu macierzy.
 *
 * Wzorzec jak eksport rejestru (`applications.service.ts`), z tą różnicą,
 * że separator to `;` — zgodnie z dotychczasowym eksportem macierzy
 * w przeglądarce i z decyzją w specyfikacji.
 *
 * Struktura pliku: linia `Raport wygenerowano: <data>` (dowód momentu
 * przeglądu), potem wiersz nagłówkowy, potem wiersze grantów zgrupowane
 * po aplikacji w kolejności przekazanej listy. Aplikacja bez grantów
 * dostaje jeden wiersz `(brak pozycji)` — widać, że rejestr niczego
 * o niej nie ewidencjonuje, a nie że ją pominięto.
 *
 * Status grantu: wygasający **dzisiaj** jest jeszcze aktywny — `expiresOn`
 * to data, od której dostęp już nie obowiązuje, więc „wczoraj" oznacza
 * `Wygasł` (ta sama granica, którą pilnuje karta aplikacji w panelu).
 */
export function budujRaportCsv(
  aplikacje: RaportAplikacja[],
  granty: RaportGrantu[],
  dzisiaj: string,
): string {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const poAplikacji = new Map<string, RaportGrantu[]>();
  for (const g of granty) {
    const wiersze = poAplikacji.get(g.aplikacjaId) ?? [];
    wiersze.push(g);
    poAplikacji.set(g.aplikacjaId, wiersze);
  }

  const wiersze = aplikacje.flatMap((a) => {
    const grantyA = poAplikacji.get(a.id) ?? [];
    if (grantyA.length === 0) {
      return [
        [
          a.nazwa,
          a.status,
          a.klasyfikacja,
          String(a.krytycznosc),
          a.typDostarczania,
          a.wlasciciel,
          '(brak pozycji)',
          '', '', '', '', '', '', '', '',
        ].map(escape),
      ];
    }
    return grantyA.map((g) =>
      [
        a.nazwa,
        a.status,
        a.klasyfikacja,
        String(a.krytycznosc),
        a.typDostarczania,
        a.wlasciciel,
        g.osoba,
        g.email,
        g.departament,
        g.stanowisko,
        g.poziom,
        g.nadane,
        g.wygasa,
        // Granica jak w panelu: wygasa dzisiaj → jeszcze aktywny.
        g.wygasa !== null && g.wygasa < dzisiaj ? 'Wygasł' : 'aktywny',
        g.notatka,
      ].map(escape),
    );
  });

  // BOM, żeby Excel poprawnie odczytał UTF-8 (polskie znaki).
  return (
    '\ufeff' +
    [
      `Raport wygenerowano: ${dzisiaj}`,
      NAGLOWEK_RAPORTU.join(';'),
      ...wiersze.map((w) => w.join(';')),
    ].join('\r\n')
  );
}
