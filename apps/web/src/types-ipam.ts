/**
 * IPAM — podsieci, adresy, statystyki katalogu i import z XML.
 */
import type {
  AppStatus,
  Application,
  DeliveryType,
  SecurityClass,
} from './types-application';

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

