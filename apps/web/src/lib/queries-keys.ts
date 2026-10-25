/**
 * Klucze zapytań React Query — jedyne miejsce definiowania kluczy,
 * żeby invalidacja po zapisie nigdy nie rozjechała się z odczytem.
 * Każdy moduł `queries-*.ts` importuje `qk` stąd, a `queries.ts`
 * re-eksportuje całość dla komponentów.
 */
import type { ApplicationFilters } from '../types';

/**
 * Klucze zapytań w jednym miejscu — dzięki temu invalidacja
 * po zapisie nie rozjedzie się z faktycznymi kluczami.
 */
export const qk = {
  me: ['me'] as const,
  applications: (filters: ApplicationFilters) =>
    ['applications', filters] as const,
  application: (id: string) => ['application', id] as const,
  stats: ['stats'] as const,
  environments: ['environments'] as const,
  users: ['users'] as const,
  userOptions: ['user-options'] as const,
  ownerOptions: ['owner-options'] as const,
  applicationOptions: ['application-options'] as const,
  audit: (params: Record<string, unknown>) => ['audit', params] as const,
  auditMeta: ['audit-meta'] as const,
  sessions: ['sessions'] as const,
  demoMode: ['settings-demo'] as const,
  // Katalog IPAM ma wspólny prefiks `ipam`, żeby jedno kasowanie podsieci
  // (kaskadowe wobec adresów i przypisań) dało się unieważnić en masse:
  // `invalidateQueries({ queryKey: ['ipam'] })` trafia w każdy klucz poniżej.
  subnets: ['ipam', 'subnets'] as const,
  subnet: (id: string) => ['ipam', 'subnet', id] as const,
  subnetAddresses: (id: string) => ['ipam', 'subnet-addresses', id] as const,
  applicationIpAddresses: (appId: string) =>
    ['ipam', 'application-ip-addresses', appId] as const,
  importPreview: ['ipam', 'import-preview'] as const,
  importApply: ['ipam', 'import-apply'] as const,
  // Macierz uprawnień też ma wspólny prefiks `access`: ta sama osoba pojawia
  // się jednocześnie w macierzy aplikacji, w macierzy zbiorczej i w katalogu
  // osób, więc jedno unieważnienie musi trafić we wszystkie trzy.
  persons: ['access', 'persons'] as const,
  personsCount: ['access', 'persons-count'] as const,
  person: (id: string) => ['access', 'person', id] as const,
  applicationAccess: (appId: string) => ['access', 'application', appId] as const,
  accessMatrix: ['access', 'matrix'] as const,
  // `null` w kluczu dla całej macierzy: rejestr przeglądów i rejestr jednej
  // aplikacji są odrębnymi wpisami cache, ale pod wspólnym prefiksem `access`.
  accessVerifications: (appId?: string) =>
    ['access', 'verifications', appId ?? null] as const,
  personsImportPreview: ['access', 'import-preview'] as const,
  // Integracja GLPI: ustawienia + import (podgląd/zapis).
  glpiSettings: ['glpi', 'settings'] as const,
};

