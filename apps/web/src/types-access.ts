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
  note: string | null;
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

