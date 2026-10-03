/**
 * Wersja aplikacji — formatowanie.
 *
 * Osobny plik, bo `version.ts` (z `buildVersion()`) czyta
 * `import.meta.env`, które istnieje tylko w bundlu Vite'a. Testy
 * `node --test` działają w CommonJS, więc `import.meta` wywala
 * kompilację — dokładnie ten sam powód, dla którego `buildQuery`
 * mieszka w `query.ts`, a nie w `api.ts`.
 *
 * Dzięki temu `appVersion()` da się przetestować, a wersję i tak
 * wplatamy do obrazu, więc sprawdzamy ją też przez działający
 * kontener, nie tylko jednostkowo.
 */

/** Prefiks, który pokazujemy obok numeru wersji. */
const PREFIX = 'v';

/**
 * Zwraca wersję do wyświetlenia albo `null`, gdy jej nie ma.
 *
 * `null` to stan normalny dla `vite dev` — tam nie ma budowania
 * obrazu, więc nie ma i ARG-a. Plakietka nic wtedy nie renderuje,
 * zamiast pokazywać „vundefined".
 */
export function appVersion(raw?: string | null): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  // Nie podwajamy prefiksu: ktoś może przepuścić `v1.2.3` ręcznie
  // (np. przez APP_VERSION w .env) i dostałby „vv1.2.3".
  return trimmed.startsWith(PREFIX) ? trimmed : `${PREFIX}${trimmed}`;
}