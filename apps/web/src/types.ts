/**
 * Typy odzwierciedlające odpowiedzi API.
 * Trzymane ręcznie, bo nie mamy generatora z OpenAPI — kontrakt
 * jest wąski i stabilny, a schemat Prisma jest jego źródłem prawdy.
 */

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'VIEWER';

export type SecurityClass =
  | 'PUBLIC'
  | 'INTERNAL'
  | 'CONFIDENTIAL'
  | 'RESTRICTED';

export type AppStatus =
  | 'PROD'
  | 'TEST'
  | 'DEV'
  | 'PLANNED'
  | 'DEPRECATED'
  | 'RETIRED';

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: Role;
  mustChangePassword: boolean;
}

/** Właściciel / administrator — pełny zestaw pól (applications APP_INCLUDE). */
export interface UserSummary {
  id: string;
  username: string;
  fullName: string;
  email: string;
}

/** Autor wpisu — bez e-maila (createdBy w APP_INCLUDE). */
export interface UserRef {
  id: string;
  username: string;
  fullName: string;
}

/** Słownik do formularzy — GET /users/options (tylko konta aktywne). */
export interface UserOption {
  id: string;
  username: string;
  fullName: string;
  role: Role;
}

export interface UserListItem extends AuthUser {
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Tylko z listy — create/update zwracają rekord bez `_count`. */
  _count?: { sessions: number };
}

export interface Environment {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
}

export interface Application {
  id: string;
  name: string;
  version: string;
  category: string | null;
  description: string | null;
  purpose: string | null;
  /**
   * Pola poniżej są **opcjonalne**, bo publiczny (niezalogowany) odczyt
   * ich nie zwraca — API usuwa je z odpowiedzi dla gościa.
   * `undefined` oznacza „nie wolno ci tego widzieć”, a nie `null`
   * oznacające „brak wartości”. UI rozróżnia te dwa przypadki.
   */
  /** Adres e-mail właściciela — nie musi odpowiadać żadnemu kontu. */
  ownerEmail?: string | null;
  admins: UserSummary[];
  introducedOn: string | null;
  sunsetOn: string | null;
  securityClass?: SecurityClass;
  criticality?: number;
  status: AppStatus;
  /** Czy dostęp wymaga formalnego wniosku — widoczne także dla gościa. */
  accessRequestRequired: boolean;
  vendor: string | null;
  license: string | null;
  licenseCount: number | null;
  annualCost: number | null;
  environments: Environment[];
  websiteUrl: string | null;
  docsUrl: string | null;
  repoUrl: string | null;
  runbookUrl: string | null;
  integrations: string | null;
  createdById: string | null;
  createdBy: UserSummary | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ApplicationListResponse {
  items: Application[];
  total: number;
  /** Rozmiar strony (limit). */
  limit: number;
  /** Przesunięcie — ilu rekordów pominęliśmy. */
  offset: number;
  hasMore: boolean;
}

export interface ApplicationFilters {
  q?: string;
  status?: string;
  securityClass?: string;
  /** Adres e-mail właściciela — dokładne dopasowanie. */
  ownerEmail?: string;
  environmentId?: string;
  category?: string;
  criticality?: number;
  includeDeleted?: boolean;
  /** Tylko aplikacje bez właściciela (karta na pulpicie). */
  missingOwner?: boolean;
  /** Rozmiar strony — ile rekordów jednym zapytaniem. */
  limit?: number;
  offset?: number;
  /** Pole z białej listy SORTABLE; prefiks `-` oznacza malejąco. */
  sort?: string;
}

export interface Stats {
  total: number;
  byStatus: Array<{ key: AppStatus; count: number }>;
  bySecurityClass: Array<{ key: SecurityClass; count: number }>;
  byCriticality: Array<{ key: number; count: number }>;
  byEnvironment: Array<{
    id: string;
    name: string;
    color: string;
    count: number;
  }>;
  byCategory: Array<{ key: string; count: number }>;
  incomplete: { missingOwner: number; missingDescription: number };
  eol: { soon: number; passed: number; windowDays: number };
  recent: Application[];
}

/** Pojedyncza zmiana pola: wartość przed i po edycji. */
export interface FieldChange {
  from: unknown;
  to: unknown;
}

/**
 * Mapa zmian z dziennika.
 *
 * Klucz `_truncated` nie jest zmianą, ale ma dwa kształty:
 * `AuditService.diff` dopisuje tam listę nazw pól przyciętych,
 * a `GET /api/audit` — gdy zmiany nie mieszczą się w odpowiedzi —
 * zastępuje cały obiekt wartością `true`.
 *
 * Poprzednia deklaracja `Record<string, FieldChange> & { _truncated?:
 * string[] }` nigdy nie działała: indeks sygnatury wymusza, żeby
 * KAŻDY klucz był `{ from, to }`, więc `_truncated` nie dało się do
 * typu przypisać w ogóle, a zadeklarowana wartość `string[]` była
 * fałszywa. Stąd indeks z sumą wartości i osobna deklaracja
 * `_truncated`; zawężanie do samej zmiany robi `visibleChanges`.
 */
export type AuditChanges = {
  [key: string]: FieldChange | string[] | true | undefined;
  _truncated?: string[] | true;
};

/**
 * Nazwy pól wymienione w `_truncated`, gdy serwer przyciął ich wartości.
 *
 * Pusta lista dla `true`: wtedy przycięto całą zmianę i nie wiadomo
 * których pól dotyczy — komunikat musi to powiedzieć osobno.
 */
export function truncatedFields(changes: AuditChanges): string[] {
  const value = changes._truncated;
  return Array.isArray(value) ? value : [];
}

/** Czy wartość z `changes` jest zmianą pola, a nie kluczem technicznym. */
function isFieldChange(value: unknown): value is FieldChange {
  return (
    typeof value === 'object' &&
    value !== null &&
    'from' in value &&
    'to' in value
  );
}

/**
 * Zmiany do pokazania, bez technicznego klucza `_truncated`.
 *
 * Sprawdzamy kształt wartości, a nie samą nazwę klucza: `changes`
 * przychodzi jako JSON, więc `_truncated` może być listą nazw pól
 * albo `true`. Odfiltrowanie po kształcie chroni też przed tym, by
 * komponent zawołał `.map()` na wartości, która nim nie jest.
 */
export function visibleChanges(
  changes: AuditChanges,
): Array<[string, FieldChange]> {
  return Object.entries(changes).filter(
    (entry): entry is [string, FieldChange] => isFieldChange(entry[1]),
  );
}

export interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  actorId: string | null;
  actorName: string | null;
  /**
   * Różnica pól: `{ pole: { from, to } }`.
   *
   * Gdy wartość tekstowa była za długa, serwer ją przycina i dopisuje
   * klucz `_truncated` z listą pól. Nie jest to zmiana — służy do tego,
   * żeby interfejs nie udawał, że pokazuje pełną różnicę.
   */
  changes: AuditChanges | null;
  ip: string | null;
  createdAt: string;
}

export interface AuditListResponse {
  items: AuditEntry[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface AuditMeta {
  actions: Array<{ key: string; count: number }>;
  entities: Array<{ key: string; count: number }>;
  roleLabels: Record<Role, string>;
}

export interface SessionInfo {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

/** Uprawnienia — lustrzane odbicie apps/api/src/auth/permissions.ts */
export const PERMISSIONS = {
  VIEWER: ['app:read', 'user:read', 'audit:read'],
  ADMIN: ['app:read', 'app:write', 'user:read', 'audit:read'],
  SUPER_ADMIN: [
    'app:read',
    'app:write',
    'user:read',
    'user:write',
    'audit:read',
  ],
} as const satisfies Record<Role, readonly string[]>;

export type Permission = (typeof PERMISSIONS)[Role][number];

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[role] as readonly string[]).includes(permission);
}

// ─── Etykiety do UI ───────────────────────────────────────────

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super administrator',
  ADMIN: 'Administrator',
  VIEWER: 'Obserwator',
};

export const STATUS_LABELS: Record<AppStatus, string> = {
  PROD: 'Produkcja',
  TEST: 'Test',
  DEV: 'Deweloperskie',
  PLANNED: 'Zaplanowana',
  DEPRECATED: 'Wycofywana',
  RETIRED: 'Wycofana',
};

export const SECURITY_LABELS: Record<SecurityClass, string> = {
  PUBLIC: 'Publiczna',
  INTERNAL: 'Wewnętrzna',
  CONFIDENTIAL: 'Poufna',
  RESTRICTED: 'Zastrzeżona',
};

export const CRITICALITY_LABELS: Record<number, string> = {
  1: 'Niska',
  2: 'Średnia',
  3: 'Wysoka',
  4: 'Krytyczna',
};

/**
 * Klasa Tailwind dla odznaki statusu.
 *
 * Każda odznaka ma dwie postacie. W jasnym motywie jasne tło
 * z ciemnym tekstem, w ciemnym — przezroczyste tło z jasnym tekstem.
 * Jasne tło typu `bg-emerald-100` w trybie ciemnym dawałoby kontrast
 * rzędu 1.2:1, czyli byłoby po prostu niewidoczne.
 *
 * Wartości 100/800/200 dobrane tak, by w trybie jasnym tekst dawał
 * co najmniej 4.5:1 na tle (rozmiar 12 px, czyli próg „normalnego"
 * tekstu wg WCAG AA).
 */
export const STATUS_COLORS: Record<AppStatus, string> = {
  PROD: 'bg-accent-100 text-accent-900 ring-accent-200 dark:bg-accent-500/15 dark:text-accent-300 dark:ring-accent-500/30',
  TEST: 'bg-amber-100 text-amber-900 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  DEV: 'bg-violet-100 text-violet-900 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30',
  PLANNED: 'bg-sky-100 text-sky-900 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30',
  DEPRECATED: 'bg-orange-100 text-orange-900 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-500/30',
  RETIRED: 'bg-slate-200 text-slate-700 ring-slate-300 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-500/30',
};

/** Klasa Tailwind dla odznaki klasyfikacji bezpieczeństwa. */
export const SECURITY_COLORS: Record<SecurityClass, string> = {
  PUBLIC: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-500/30',
  INTERNAL: 'bg-blue-100 text-blue-900 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
  CONFIDENTIAL: 'bg-amber-100 text-amber-900 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  RESTRICTED: 'bg-rose-100 text-rose-900 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30',
};

/** Klasa Tailwind dla krytyczności. */
export const CRITICALITY_COLORS: Record<number, string> = {
  1: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-500/30',
  2: 'bg-blue-100 text-blue-900 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
  3: 'bg-amber-100 text-amber-900 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  4: 'bg-rose-100 text-rose-900 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30',
};

/** Odznaka „wniosek o dostęp": Tak = zielony accent, Nie = neutralna szarość. */
export const ACCESS_REQUEST_YES =
  'bg-accent-100 text-accent-900 ring-accent-200 dark:bg-accent-500/15 dark:text-accent-300 dark:ring-accent-500/30';
export const ACCESS_REQUEST_NO = 'bg-surface-2 text-fg-muted ring-line';

// `ENV_COLORS` (karta nazwy środowiska) nie było nigdzie używane —
// odznaki środowisk mają własne klasy w komponentach. Usunięte jako martwy
// eksport; jeśli wróci potrzeba, odtworzyć razem z call-site'em.
