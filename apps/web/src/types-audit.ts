/**
 * Dziennik zdarzeń — wpisy, filtry listy i metadana słownikowe.
 */
import type { Role } from './types-identity';

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

