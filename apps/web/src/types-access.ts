/**
 * Macierz uprawnień do aplikacji i katalog osób.
 */
// ─── Macierz uprawnień do aplikacji ─────────────────────────────

/**
 * Poziom dostępu do aplikacji — lustrzane odbicie enumu `AccessLevel`
 * w `apps/api/prisma/schema.prisma`.
 */
export type AccessLevel = 'OWNER' | 'ADMIN' | 'USER' | 'READ_ONLY';

/**
 * Osoba z katalogu ewidencji.
 *
 * To nie jest konto panelu: `Person` nie ma loginu, hasła ani roli, bo
 * osoba z dostępem do aplikacji nie musi logować się do panelu.
 */
export interface Person {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  position: string | null;
  department: string | null;
  isActive: boolean;
  accessCount: number;
}

/** Globalny licznik katalogu osób — z bazy, niezależnie od filtrów listy. */
export interface PersonsCount {
  total: number;
  active: number;
  inactive: number;
}

/** Osoba wraz z listą przypisań — szczegóły osoby. */
export interface PersonDetailResponse {
  person: Omit<Person, 'accessCount'>;
  grants: AccessMatrixRow[];
}

/**
 * Osoba w macierzy.
 *
 * Osobny typ bez `accessCount`: API w macierzy liczby nie zwraca (licznik
 * pojawia się tylko w katalogu osób), a udawanie, że jest, kończyłoby się
 * kolumną `undefined` w miejscu, które wygląda na liczbę.
 */
export interface AccessPerson {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  position: string | null;
  department: string | null;
  isActive: boolean;
}

/** Przypisanie w macierzy aplikacji — osoba wraz z poziomem i datami. */
export interface ApplicationGrant {
  applicationId: string;
  personId: string;
  level: AccessLevel;
  grantedOn: string;
  expiresOn: string | null;
  /** Data ostatniego przeglądu grantu — null znaczy „nigdy nie zweryfikowano". */
  verifiedOn: string | null;
  note: string | null;
  person: AccessPerson;
}

/** Wiersz macierzy zbiorczej: osoba, aplikacja i poziom. */
export interface AccessMatrixRow {
  application: { id: string; name: string };
  person: AccessPerson;
  level: AccessLevel;
  grantedOn: string;
  expiresOn: string | null;
  /** Data ostatniego przeglądu grantu — null znaczy „nigdy nie zweryfikowano". */
  verifiedOn: string | null;
  note: string | null;
}

// ─── Weryfikacje dostępów (przeglądy macierzy) ───────────────────

/**
 * Zakres wpisu weryfikacji — lustrzane odbicie enumu `VerificationScope`
 * w `apps/api/prisma/schema.prisma`.
 */
export type AccessVerificationScope = 'MATRIX' | 'APPLICATION' | 'GRANT';

/**
 * Wpis w rejestrze przeglądów: „dnia X osoba Y potwierdziła, że zapisane
 * dostępy są aktualne". Nazwisko weryfikującego i osoby z grantu to
 * migawki z czasu wpisu — historia przeżywa odejście obu stron.
 */
export interface AccessVerification {
  id: string;
  scope: AccessVerificationScope;
  verifiedOn: string;
  note: string | null;
  application: { id: string; name: string } | null;
  personId: string | null;
  personName: string | null;
  actorName: string | null;
}

/** Filtr macierzy zbiorczej — nazwy pól odpowiadają query z API. */
export interface AccessMatrixFilters {
  applicationId?: string;
  personId?: string;
  department?: string;
  level?: AccessLevel;
}

/** Filtry katalogu osób. */
export interface PersonFilters {
  search?: string;
  department?: string;
  includeInactive?: boolean;
  sort?: string;
}

/** Mapowanie kolumn importu: pole osoby → nagłówek z pliku. */
export type HeaderMapping = Record<
  'email' | 'firstName' | 'lastName' | 'position' | 'department' | 'isActive',
  string
>;

export type ImportRowStatus = 'NEW' | 'UPDATE' | 'ERROR';

/** Wiersz podglądu importu osób — odrębny od `ImportPreviewRow` z IPAM. */
export interface PersonsImportRow {
  line: number;
  email: string;
  firstName: string;
  lastName: string;
  position: string | null;
  department: string | null;
  isActive: boolean;
  errors: string[];
  status: ImportRowStatus;
  existingPersonId: string | null;
}

export interface PersonsImportPreview {
  rows: PersonsImportRow[];
  mapping: HeaderMapping;
  unmapped: string[];
  summary: { total: number; create: number; update: number; invalid: number };
}

export interface PersonsImportResult {
  result: { created: number; updated: number; skipped: number };
}

// ─── Import macierzy uprawnień (okrężny z eksportem) ────────────
export type MatrixImportRowStatus = 'NEW' | 'NEW_PERSON' | 'UPDATE' | 'UNCHANGED' | 'ERROR';

/** Jedna różnica wiersza `UPDATE` — „od → do" dla pola grantu. */
export interface MatrixImportDiff {
  pole: string;
  od: string;
  do: string;
}

/** Wiersz podglądu importu macierzy — rozszerzenie danych z pliku o status. */
export interface MatrixImportPreviewRow {
  line: number;
  aplikacja: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  department: string | null;
  level: string;
  expiresOn: string | null;
  note: string | null;
  status: MatrixImportRowStatus;
  diff: MatrixImportDiff[];
  errors: string[];
}

export interface MatrixImportPreview {
  rows: MatrixImportPreviewRow[];
  aplikacje: Array<{ id: string; nazwa: string; wiersze: number }>;
  summary: {
    total: number;
    new: number;
    newPerson: number;
    update: number;
    unchanged: number;
    invalid: number;
  };
}

/** Pominięty wiersz zapisu — administrator ma widzieć, co i dlaczego nie weszło. */
export interface MatrixImportSkippedRow {
  email: string;
  aplikacja: string | null;
  errors: string[];
}

export interface MatrixImportResult {
  result: {
    createdGrants: number;
    updatedGrants: number;
    createdPersons: number;
    unchanged: number;
    skipped: number;
    skippedRows: MatrixImportSkippedRow[];
  };
}

