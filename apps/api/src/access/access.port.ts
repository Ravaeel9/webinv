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

/** Osoba wraz z liczbą przypisań — do katalogu osób. */
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

/** Przypisanie wraz z osobą i aplikacją — do macierzy zbiorczej. */
export type AccessGrantWithRelations = AccessGrantWithPerson & {
  application: ApplicationRefRow;
};

/** Aplikacja w wersji okrojonej — nazwa i identyfikator wystarczą w macierzy. */
export type ApplicationRefRow = {
  id: string;
  name: string;
  deletedAt: Date | null;
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

/** Sortowanie dozwolone w katalogu — nazwa pola z UI musi tu pasować. */
export type PersonOrderBy = 'lastName' | 'department' | 'createdAt';

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

export interface GrantDelegate {
  findMany(args: {
    where?: GrantWhere;
    include?: { person?: false; application?: true };
    orderBy?: 'person';
  }): Promise<AccessGrantWithPerson[] | AccessGrantWithRelations[]>;
  findUnique(args: { where: { applicationId: string; personId: string } }): Promise<ApplicationAccessRow | null>;
  create(args: { data: Omit<ApplicationAccessRow, 'createdAt' | 'grantedOn'> }): Promise<ApplicationAccessRow>;
  update(args: { where: { applicationId: string; personId: string }; data: Partial<ApplicationAccessRow> }): Promise<ApplicationAccessRow>;
  delete(args: { where: { applicationId: string; personId: string } }): Promise<ApplicationAccessRow>;
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