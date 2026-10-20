/**
 * Rejestr aplikacji — karta, lista i filtry `/applications/*`.
 */
import type { UserSummary } from './types-identity';

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

