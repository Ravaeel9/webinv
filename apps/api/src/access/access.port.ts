/**
 * Port matrycy uprawnień — wąski wycinek Prisma, przez który rozmawia
 * `AccessService`.
 *
 * Osobny typ zamiast `PrismaService`, bo testy serwisu nie podnoszą bazy:
 * atrapa rzutowana na `ConstructorParameters<typeof AccessService>[0]` musi
 * zawierać dokładnie to, czego serwis woła (`test/helpers/access-fake.ts`).
 * Nazwy delegatów powtarzają nazwy modeli Prisma — inaczej test dawałby
 * pole `persons`, a serwis dostałby `undefined` zamiast błędu kompilacji.
 *
 * Enum poziomu jest tu zdefiniowany ręcznie, a nie importem
 * z `@prisma/client`, żeby port pozostał czytelnym kontraktem bez
 * wygenerowanego klienta — tak samo robi to `ipam.port.ts`.
 */

/** Poziom dostępu do aplikacji — dokładnie wartości enumu `AccessLevel`. */
export type AccessLevelName = 'OWNER' | 'ADMIN' | 'USER' | 'READ_ONLY';

/** Wiersz `Person` — wszystkie pola skalarny modelu. */
export type PersonRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  position: string | null;
  department: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Osoba wraz z liczbą przypisań — do katalogu osób.
 *
 * Licznik pochodzi z `_count` w zapytaniu, nie z liczenia w serwisie:
 * jedno zapytanie z `_count` jest tańsze niż pobranie wszystkich
 * przypisań i zsumowanie ich w pamięci.
 */
export type PersonWithCounts = PersonRow & { accessCount: number };

/** Wiersz `ApplicationAccess` — pola skalarny modelu, bez relacji. */
export type ApplicationAccessRow = {
  applicationId: string;
  personId: string;
  level: AccessLevelName;
  grantedOn: Date;
  expiresOn: Date | null;
  note: string | null;
  createdAt: Date;
};

/** Przypisanie wraz z osobą — do macierzy jednej aplikacji. */
export type AccessGrantWithPerson = ApplicationAccessRow & { person: PersonRow };

/**
 * Przypisanie w kształcie odpowiedzi API: daty jako `YYYY-MM-DD`.
 *
 * Osobny typ, bo `expires_on` i `granted_on` to kolumny `@db.Date`, a
 * serializacja `Date` dałaby w JSON znacznik czasu z godziną — interfejs
 * pokazuje datę nadania, nie moment nadania.
 */
export type AccessGrantDto = Omit<
  AccessGrantWithPerson,
  'grantedOn' | 'expiresOn' | 'createdAt'
> & {
  grantedOn: string;
  expiresOn: string | null;
};

/** Przypisanie wraz z osobą i aplikacją — do macierzy zbiorczej. */
export type AccessGrantWithRelations = AccessGrantWithPerson & {
  application: ApplicationRefRow;
};

export type DeliveryTypeName = 'GENERAL_USE' | 'SELF_HOSTED' | 'SAAS' | 'VENDOR_MANAGED';

/** Aplikacja w wersji okrojonej — nazwa, identyfikator i typ dostarczenia wystarczą w macierzy. */
export type ApplicationRefRow = {
  id: string;
  name: string;
  deletedAt: Date | null;
  deliveryType?: DeliveryTypeName;
};

/** Warunek „pole zawiera tekst", tak jak go rozumie Prisma. */
export type PersonTextFilter = { contains: string; mode: 'insensitive' };

/** Warunki `where` dla osób — opisane pola, a nie dowolne `any`. */
export type PersonWhere = {
  id?: string;
  email?: string;
  isActive?: boolean;
  department?: string;
  OR?: Array<{
    firstName?: PersonTextFilter;
    lastName?: PersonTextFilter;
    email?: PersonTextFilter;
  }>;
};

/**
 * Sortowanie dozwolone w katalogu — nazwa pola z UI musi tu pasować.
 *
 * Wartość to obiekt Prisma (`{ lastName: 'asc' }`), a nie nazwa pola:
 * Prisma przyjmuje obiekt albo tablicę obiektów i **odrzuca** goły napis.
 */
export type PersonOrderBy = Record<string, 'asc' | 'desc'>;

export type PersonFindManyArgs = {
  where?: PersonWhere;
  orderBy?: PersonOrderBy;
};

/** Warunki `where` dla przypisań — filtry macierzy zbiorczej. */
export type GrantWhere = {
  applicationId?: string;
  personId?: string;
  level?: AccessLevelName;
  person?: { isActive?: boolean };
};

export interface PersonDelegate {
  findMany(args: PersonFindManyArgs): Promise<PersonWithCounts[]>;
  findFirst(args: { where: PersonWhere }): Promise<PersonRow | null>;
  findUnique(args: { where: { id: string } }): Promise<PersonRow | null>;
  // `position` i `department` bywają `undefined` przy tworzeniu (puste pole
  // formularza), a `PersonRow` trzyma tam `null` — stąd typ, który dopuszcza
  // oba zapisy zamiast kazać rzutować na miejscu.
  create(args: {
    data: { firstName: string; lastName: string; email: string } & Partial<Omit<PersonRow, 'id' | 'createdAt' | 'updatedAt'>>;
  }): Promise<PersonRow>;
  update(args: { where: { id: string }; data: Partial<PersonRow> }): Promise<PersonRow>;
  count(args: { where?: PersonWhere }): Promise<number>;
}

/**
 * Klucz złożony przypisania.
 *
 * Prisma nie przyjmuje płaskiego `{ applicationId, personId }` dla klucza
 * głównego złożonego — trzeba podać go jako jedno pole
 * `applicationId_personId`. Płaska postać wygląda naturalnie, więc błąd
 * wychodzi dopiero na żywej bazie, jako 500.
 */
export type GrantKey = {
  applicationId_personId: { applicationId: string; personId: string };
};

export interface GrantDelegate {
  findMany(args: {
    where?: GrantWhere;
    /** Relacje do dołączenia — `person` i `application` są zawsze potrzebne. */
    include?: { person: true; application?: true };
    /** Sortowanie: obiekt albo tablica obiektów — Prisma odrzuca goły napis. */
    orderBy?: Record<string, unknown> | Array<Record<string, unknown>>;
  }): Promise<AccessGrantWithPerson[] | AccessGrantWithRelations[]>;
  findUnique(args: { where: GrantKey }): Promise<ApplicationAccessRow | null>;
  create(args: { data: Omit<ApplicationAccessRow, 'createdAt' | 'grantedOn'> }): Promise<ApplicationAccessRow>;
  update(args: { where: GrantKey; data: Partial<ApplicationAccessRow> }): Promise<ApplicationAccessRow>;
  delete(args: { where: GrantKey }): Promise<ApplicationAccessRow>;
  count(args: { where?: GrantWhere }): Promise<number>;
}

export interface ApplicationDelegate {
  findUnique(args: { where: { id: string } }): Promise<ApplicationRefRow | null>;
}

/**
 * Cały port. Trzymany jako jeden interfejs, a nie trzy osobne, bo serwis
 * i tak używa wszystkich trzech naraz — rozbicie na osobne pliki dałoby
 * trzy typy, których nikt nie używa pojedynczo.
 */
export interface AccessPort {
  person: PersonDelegate;
  applicationAccess: GrantDelegate;
  application: ApplicationDelegate;
}
/**
 * Token wstrzykiwania portu.
 *
 * Port jest interfejsem, więc Nest nie umie go rozpoznać po typie —
 * `design:paramtypes` dałby `Object`. Moduł podaje pod tym tokenem
 * `PrismaService` (`useExisting`), więc produkcja i testy mają ten sam
 * kształt konstruktora.
 */
export const ACCESS_PORT = 'ACCESS_PORT';
