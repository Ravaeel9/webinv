/**
 * Etykiety, opisy i tony kafli do UI — mapy `*_LABELS`/`*_TONES`.
 * Importują typy od domen; same wyczerpują się w wartości.
 */
import type {
  AppStatus,
  DeliveryType,
  SecurityClass,
  SupportChannel,
  SupportOwnerType,
} from './types-application';
import type { Role } from './types-identity';
import type { AccessLevel } from './types-access';
import type { IpStatus } from './types-ipam';
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

