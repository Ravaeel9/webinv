import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Katalog repozytorium.
 *
 * `npm test` uruchamia się z `apps/api`, ale wywołanie skryptu z katalogu
 * nadrzędnego też musi działać — stąd szukanie w górę, zamiast
 * hardkodowanego `../../..`.
 *
 * Szukamy `nginx/default.conf`, bo to plik, którego nie da się przypadkiem
 * przenieść: jest wymagany do wdrożenia i istnieje w każdym checkoutcie.
 *
 * Ścieżka liczona jest z `process.cwd()`, a nie z `import.meta.url` —
 * `apps/api/tsconfig.json` ma `"module": "commonjs"`, w którym
 * `import.meta` jest zabronione (TS1343) i wywala `typecheck:test`.
 */
export const REPO_ROOT = (() => {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, 'nginx', 'default.conf'))) return dir;
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'Nie znaleziono katalogu repozytorium (brak nginx/default.conf)',
  );
})();

/** Zawartość pliku pod ścieżką liczoną od katalogu repozytorium. */
export function read(...path: string[]): string {
  return readFileSync(join(REPO_ROOT, ...path), 'utf8');
}