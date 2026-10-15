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

/**
 * Sposób dostarczenia aplikacji — zastępuje dawną wolną tekstową
 * kategorię. Różnica jest praktyczna: `GENERAL_USE` to program na
 * stanowisku, a pozostałe trzy to usługi, dla których w formularzu
 * pojawia się blok „dostęp i hosting” oraz „wsparcie”.
 */
export type DeliveryType =
  | 'GENERAL_USE'
  | 'SELF_HOSTED'
  | 'SAAS'
  | 'VENDOR_MANAGED';

/** Kto prowadzi wsparcie: nasz zespół czy dostawca. */
export type SupportOwnerType = 'INTERNAL' | 'VENDOR';

/** Główny kanał zgłoszeń. */
export type SupportChannel =
  | 'EMAIL'
  | 'PHONE'
  | 'PORTAL'
  | 'CHAT'
  | 'ON_SITE';

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
  /** Widoczny także dla gościa — to informacja techniczna, nie osobowa. */
  deliveryType: DeliveryType;
  /** Adres dostępowy do usługi — widoczny także dla gościa. */
  baseUrl: string | null;
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
  /**
   * Opis hostingu i wsparcia.
   *
   * Pola są **opcjonalne**, bo publiczny (niezalogowany) odczyt ich
   * nie zwraca — API usuwa je z odpowiedzi dla gościa. `undefined`
   * oznacza „nie wolno ci tego widzieć”, a nie `null` oznaczające
   * „brak wartości”. UI rozróżnia te dwa przypadki.
   *
   * Dotyczy `GENERAL_USE` tylko teoretycznie: zmiana typu nie czyści
   * tych pól, więc rekord może je mieć wypełnione, a ich nie pokazywać.
   */
  hostingLocation?: string | null;
  adminTeam?: string | null;
  supportOwnerType?: SupportOwnerType | null;
  supportOwnerName?: string | null;
  supportEmail?: string | null;
  supportUrl?: string | null;
  supportChannel?: SupportChannel | null;
  supportNotes?: string | null;
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
  deliveryType?: string;
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

// ─── IPAM ─────────────────────────────────────────────────────
//
// UWAGA: `Subnet` to **podsieć sieciowa** z katalogu IPAM, a `Environment`
// (wyżej) to **środowisko aplikacji** (`prod`/`test`/`dev`). Nazwy brzmią
// podobnie, ale to dwa różne byty z różnych drzew: środowisko opisuje,
// gdzie aplikacja działa, podsieć — jaki blok adresów zajmuje w sieci.
// Katalog podsieci ma własne trasy `/api/ipam` i własne uprawnienia
// (`ipam:read` / `ipam:write`), więc nie miesza się z `/api/applications`.

/** Status pojedynczego adresu — enum `IpStatus` ze schematu Prisma. */
export type IpStatus = 'FREE' | 'IN_USE' | 'DEPRECATED';

export interface Subnet {
  id: string;
  name: string;
  /** Zakres w zapisie CIDR, np. `10.20.0.0/16`. */
  cidr: string;
  description: string | null;
  /** Nazwa tonu w stylu `slate` — kolor kafelka, nie znacznik. */
  color: string;
  vlan: number | null;
  location: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Podsieć z podsumowaniem — wariant listy katalogu (`GET /subnets`). */
export interface SubnetWithCounts extends Subnet {
  addressCount: number;
  applicationCount: number;
  freeCount: number;
}

/** Podsieć z pełną listą adresów — wariant detalu (`GET /subnets/:id`). */
export interface SubnetDetail extends Subnet {
  addresses: IpAddress[];
}

/** Pojedynczy adres IPv4 w podsieci — bez maski, wraz z podsieć. */
export interface IpAddress {
  id: string;
  subnetId: string;
  address: string;
  status: IpStatus;
  description: string | null;
  /** Ostatnie potwierdzenie skanem; `null` dla adresu wpisanego ręcznie. */
  lastSeenAt: string | null;
  /**
   * Żywe przypisania aplikacji — lista adresów i karta podsieci niosą je
   * w każdym wierszu (`include` w tym samym zapytaniu, bez N+1).
   * Usunięta miękko aplikacja nigdy tu nie wraca: cały feature istnieje
   * po to, żeby kasowane aplikacje nie trzymały adresów.
   */
  applications: { id: string; name: string }[];
}

/**
 * Adres widziany z perspektywy aplikacji (`GET
 * /applications/:appId/ip-addresses`).
 *
 * Druga strona jest obiektem, a nie identyfikatorem: na karcie aplikacji
 * administrator przypisuje VIP-a „do bramy w danej podsieci”, więc musi
 * widzieć jej nazwę i zakres. Odwrotna strona (`GET
 * /addresses/:id/applications`) zwraca aplikacje, nie adresy — to osobny
 * katalog, którego zadanie 10 nie potrzebuje.
 */
export interface ApplicationIpAddressRef {
  id: string;
  address: string;
  status: IpStatus;
  description: string | null;
  subnet: { id: string; name: string; cidr: string };
}

export interface ImportPreviewRow {
  address: string;
  hostname: string | null;
  existingDescription: string | null;
}

export interface ImportPreview {
  new: Array<
    ImportPreviewRow & { subnetId: string; subnetName: string; cidr: string }
  >;
  existing: Array<
    ImportPreviewRow & {
      id: string;
      status: IpStatus;
      subnetId: string;
      subnetName: string;
    }
  >;
  unmatched: ImportPreviewRow[];
  skipped: number;
}

export interface ImportSelection {
  address: string;
  subnetId: string;
  description?: string;
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
  byDeliveryType: Array<{ key: DeliveryType; count: number }>;
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

/**
 * Stan trybu demonstracyjnego.
 *
 * `source` mówi, skąd wzięła się odpowiedź: `db` — z wpisu w panelu,
 * `env` — z `SEED_DEMO_APPS`, bo nikt jeszcze w panelu nie decydował.
 * Pokazujemy to w interfejsie, żeby administrator wiedział, że przełącznik
 * podczas restartu kontenera zostanie zignorowany.
 */
export type DemoModeState = {
  enabled: boolean;
  source: 'db' | 'env';
  recordCount: number;
};

/** Uprawnienia — lustrzane odbicie apps/api/src/auth/permissions.ts */
export const PERMISSIONS = {
  VIEWER: ['app:read', 'user:read', 'audit:read', 'ipam:read'],
  ADMIN: [
    'app:read',
    'app:write',
    'user:read',
    'audit:read',
    'ipam:read',
    'ipam:write',
    // Macierz uprawnień do aplikacji — dane osobowe osób spoza panelu.
    // Lustrzane odbicie `apps/api/src/auth/permissions.ts`.
    'access:read',
    'access:write',
  ],
  SUPER_ADMIN: [
    'app:read',
    'app:write',
    'user:read',
    'user:write',
    'audit:read',
    // Tylko super admin: `settings:write` pozwala wyłączyć tryb demo
    // i skasować 30 przykładowych rekordów naraz. Lustrzane odbicie
    // `apps/api/src/auth/permissions.ts`.
    'settings:write',
    // IPAM ma własne uprawnienia, a nie idzie pod `settings:write`:
    // adresy i podsieci to dane operacyjne, nie konfiguracja systemu.
    'ipam:read',
    'ipam:write',
    // Macierz uprawnień do aplikacji — dane osobowe osób spoza panelu.
    // Lustrzane odbicie `apps/api/src/auth/permissions.ts`.
    'access:read',
    'access:write',
  ],
} as const satisfies Record<Role, readonly string[]>;

export type Permission = (typeof PERMISSIONS)[Role][number];

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[role] as readonly string[]).includes(permission);
}

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

/** Osoba wraz z listą przypisań — szczegóły osoby. */
export interface PersonDetailResponse {
  person: Omit<Person, 'accessCount'>;
  grants: AccessMatrixRow[];
}

/** Przypisanie w macierzy aplikacji — osoba wraz z poziomem i datami. */
export interface ApplicationGrant {
  applicationId: string;
  personId: string;
  level: AccessLevel;
  grantedOn: string;
  expiresOn: string | null;
  note: string | null;
  person: Person;
}

/** Wiersz macierzy zbiorczej: osoba, aplikacja i poziom. */
export interface AccessMatrixRow {
  application: { id: string; name: string };
  person: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    position: string | null;
    department: string | null;
    isActive: boolean;
  };
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

// ─── Etykiety do UI ───────────────────────────────────────────

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super administrator',
  ADMIN: 'Administrator',
  VIEWER: 'Obserwator',
};

export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
  OWNER: 'Właściciel',
  ADMIN: 'Administrator',
  USER: 'Użytkownik',
  READ_ONLY: 'Tylko odczyt',
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

export const DELIVERY_TYPE_LABELS: Record<DeliveryType, string> = {
  GENERAL_USE: 'Aplikacja ogólnego użytku',
  SELF_HOSTED: 'Hostowane u nas',
  SAAS: 'Usługa SaaS',
  VENDOR_MANAGED: 'Zarządzane przez dostawcę',
};

/**
 * Krótkie wyjaśnienia pod opcjami typu dostarczenia.
 *
 * Sam label nie wystarcza — „Hostowane u nas" i „Zarządzane przez
 * dostawcę" brzmią podobnie, a to zupełnie różne sytuacje.
 */
export const DELIVERY_TYPE_DESCS: Record<DeliveryType, string> = {
  GENERAL_USE: 'Program instalowany na stanowisku — 7-Zip, czytnik PDF.',
  SELF_HOSTED: 'Uruchamiamy sami na naszej infrastrukturze.',
  SAAS: 'Usługa u zewnętrznego dostawcy, dostępna przez przeglądarkę.',
  VENDOR_MANAGED: 'Zainstalowana lokalnie, ale zarządza nią dostawca.',
};

export const SUPPORT_OWNER_LABELS: Record<SupportOwnerType, string> = {
  INTERNAL: 'Nasz zespół',
  VENDOR: 'Dostawca',
};

export const SUPPORT_CHANNEL_LABELS: Record<SupportChannel, string> = {
  EMAIL: 'E-mail',
  PHONE: 'Telefon',
  PORTAL: 'Portal zgłoszeń',
  CHAT: 'Czat',
  ON_SITE: 'Zgłoszenie osobiście',
};

/**
 * Tony odznak stanów.
 *
 * Wartości to nazwy klas z `index.css` (`.tone-*`), a nie zestawy klas
 * Tailwinda. Różnica jest praktyczna: dawniej każda wartość składała się
 * z sześciu ręcznie dobranych klas, gdzie pominięcie `dark:` dawało
 * po cichu niewidoczną w jednym motywie odznakę — tak właśnie stało się
 * z rolami na stronie użytkowników. Teraz kontrast obu motywów jest
 * policzony w jednym miejscu i pilnany przez `apps/api/test/ui-contrast.test.ts`.
 *
 * Ton powtarza się świadomie: TEST i DEPRECATED to oba „zwróć uwagę",
 * a PLANNED i RETIRED to oba „nieaktywne". Kolor niesie znaczenie,
 * zamiast tylko odróżniać wartości.
 */
export type Tone = 'neutral' | 'info' | 'violet' | 'ok' | 'warn' | 'danger';

/** Typ dostarczenia — cztery wartości, cztery różne tony. */
export const DELIVERY_TYPE_TONES: Record<DeliveryType, Tone> = {
  GENERAL_USE: 'neutral',
  SELF_HOSTED: 'info',
  SAAS: 'violet',
  VENDOR_MANAGED: 'warn',
};

export const STATUS_TONES: Record<AppStatus, Tone> = {
  PROD: 'ok',
  TEST: 'warn',
  DEV: 'info',
  PLANNED: 'neutral',
  DEPRECATED: 'warn',
  RETIRED: 'neutral',
};

export const SECURITY_TONES: Record<SecurityClass, Tone> = {
  PUBLIC: 'neutral',
  INTERNAL: 'info',
  CONFIDENTIAL: 'warn',
  RESTRICTED: 'danger',
};

export const CRITICALITY_TONES: Record<number, Tone> = {
  1: 'neutral',
  2: 'info',
  3: 'warn',
  4: 'danger',
};

/** Odznaka „wniosek o dostęp": Tak = potwierdzone, Nie = bez znaczenia. */
export const ACCESS_REQUEST_YES: Tone = 'ok';
export const ACCESS_REQUEST_NO: Tone = 'neutral';

// ─── IPAM: etykiety i kolory do UI ────────────────────────────
//
// Tak jak pozostałe `*_LABELS` / `*_TONES` wyżej: nazwy klas z
// `index.css` i polskie napisy, a nie surowe enuma z API.

/**
 * Statusy w kolejności prezentacji — do wypełniania listy wyboru.
 *
 * Osobne od `IpStatus`, bo typ jest unia i nie da się z niej wyczytać
 * kolejności. Trzymamy tu same trzy wartości, żeby dodanie czwartego
 * wymuszało świadome decyzje o nazwie i kolejności, a nie ciche
 * pominięcie w jednym z miejsc.
 */
export const IP_STATUSES: readonly IpStatus[] = ['FREE', 'IN_USE', 'DEPRECATED'];

export const IP_STATUS_LABELS: Record<IpStatus, string> = {
  FREE: 'Wolny',
  IN_USE: 'Zajęty',
  DEPRECATED: 'Wycofany',
};

/**
 * Ton dobierany tak samo jak przy statusach aplikacji: `FREE` się odsuwa,
 * `IN_USE` niesie „to jest zajęty", `DEPRECATED` prosi o uwagi.
 *
 * `IN_USE` ma ton `danger`, nie `ok` (zieleń): adres wskazany przez skan
 * nmap jest zajęty, a zielona odznaka mówiłaby „wolny i wszystko gra".
 * Odwrócenie znaczenia dotyczy też drugiego źródła `IN_USE` — importu
 * z nmap, gdzie status oznacza „host odpowiada", a nie „wolne miejsce
 * czeka do przydziału”.
 */
export const IP_STATUS_TONES: Record<IpStatus, Tone> = {
  FREE: 'neutral',
  IN_USE: 'danger',
  DEPRECATED: 'warn',
};

/**
 * Paleta kolorów podsieci.
 *
 * API waliduje `color` tylko jako małe litery (`/^[a-z]+$/`) — to kolor
 * kafelka, a nie znacznik, więc dobór z listy jest zamierzony: bez niej
 * pole przyjęłoby „cokolwiek”, a tak wartość zawsze ma odpowiednik
 * w interfejsie. Sworzek rysujemy inline (`style`), nie klasą Tailwinda
 * złożoną z danych — budowanie nazwy klasy z danych nie trafia do
 * wynikowego CSS, a `ui-state-colors.test.ts` pilnuje pary motywów
 * tylko dla klas pisanych wprost.
 */
export const SUBNET_COLORS: Record<string, string> = {
  slate: '#64748b',
  sky: '#0284c7',
  violet: '#7c3aed',
  emerald: '#059669',
  amber: '#d97706',
  rose: '#e11d48',
};

export const SUBNET_COLOR_NAMES = Object.keys(SUBNET_COLORS);

// `ENV_COLORS` (karta nazwy środowiska) nie było nigdzie używane —
// odznaki środowisk mają własne klasy w komponentach. Usunięte jako martwy
// eksport; jeśli wróci potrzeba, odtworzyć razem z call-site'em.
