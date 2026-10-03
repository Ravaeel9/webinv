/**
 * Budowanie query stringa.
 *
 * Osobny moduł, bo `api.ts` czyta `import.meta.env` (Vite), przez co
 * nie da się go zaimportować w testach `node --test`. `buildQuery` jest
 * czystą funkcją formatującą — nie ma powodu, żeby dzieliła moduł
 * z klientem HTTP.
 */

/**
 * Buduje query string, pomijając puste wartości.
 *
 * `false` **nie jest** pomijane — to wartość, nie brak wartości. Bez
 * tego `includeInactive=false` nigdy nie trafiałoby do URL-a, a API
 * czyta brak parametru jako `true` (`includeInactive !== 'false'`),
 * więc odznaczenie „tylko aktywne konta" po cichu nic by nie robiło.
 * Ten sam błąd złamałby każdy kolejny filtr boolean.
 */
export function buildQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }

  const qs = search.toString();
  return qs ? `?${qs}` : '';
}