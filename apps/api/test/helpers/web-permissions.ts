/**
 * Uprawnienia interfejsu, przeczytane z pliku źródłowego.
 *
 * `apps/web/src/types.ts` nie da się zaimportować stąd — bundlacz Vite'a
 * jest po drugiej stronie, a `import.meta.env` istnieje tylko w bundlu.
 * Test musi więc czytać plik jako tekst i wyciągać z niego tablicę.
 *
 * Wyciąganie regexem jest tu celowe i **nie jest duplikatem prawdy**:
 * nie opisujemy w tym pliku, jakie uprawnienia istnieją, tylko jak je
 * odczytać z cudzego źródła. Jedyne źródło pozostaje `types.ts`.
 */

/** Jedna rola wraz z listą uprawnień, jak zapisano ją w `types.ts`. */
export type WebRolePermissions = Record<string, string[]>;

/**
 * Wyciąga `PERMISSIONS` z treści `types.ts`.
 *
 * Zwraca `null`, gdy stałej nie da się znaleźć lub nie da się jej
 * rozpoznać — lepiej brak odpowiedzi niż lista, która wygląda
 * jak poprawna, a jest pusta.
 */
export function webPermissions(zrodlo: string): WebRolePermissions | null {
  const start = zrodlo.indexOf('export const PERMISSIONS');
  if (start === -1) return null;

  const po = zrodlo.slice(start);
  const koniec = po.indexOf('\n};');
  if (koniec === -1) return null;

  const blok = po.slice(0, koniec);
  const role: WebRolePermissions = {};

  for (const dopasowanie of blok.matchAll(
    /([A-Z_]+):\s*\[([^\]]*)\]/g,
  )) {
    const [, rola, lista] = dopasowanie;
    role[rola] = [...lista.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  }

  return Object.keys(role).length > 0 ? role : null;
}