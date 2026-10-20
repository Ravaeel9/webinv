import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './repo';

/**
 * Pliki źródłowe interfejsu (`apps/web/src`), rekurencyjnie.
 *
 * Ścieżki zwracane są **względne wobec katalogu repozytorium**, nie
 * bezwzględne — `ui-state-colors.test.ts` potrzebuje względnej nazwy
 * jako klucza w swoich tabelach wyjątków, a pozostałe testy jako
 * ścieżki do `read()`. Jedna funkcja, jeden format.
 */
export function webSources(): string[] {
  const files: string[] = [];

  walk(join(REPO_ROOT, 'apps', 'web', 'src'), files);

  return files.map((path) => path.slice(REPO_ROOT.length + 1));
}

function walk(dir: string, into: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, into);
    else if (/\.tsx?$/.test(entry.name)) into.push(path);
  }
}

/**
 * Połączone teksty modułów z `apps/web/src/lib` dobranych po nazwie pliku.
 *
 * Kilka testów pilnuje treści interfejsu **tekstowo** (PRICE permissions
 * w types.ts, klucze zapytań w queries.ts). Moduły dzielymy po domenie —
 * test czyta wtedy wszystkie fragmenty naraz, więc działa i z jednym
 * plikiem, i z rozdrobnionym zestawem `queries-applications.ts` itp.
 * Kolejność alfabetyczna daje powtarzalny skan.
 */
export function webLibText(nazwa: (plik: string) => boolean): string {
  // `types.ts` siedzi w korzeniu `src`, `queries.ts` w `lib` — szukamy
  // w obu kierunkach, a rozdrobnienie (types-applications.ts itp.) trafi
  // z czasem do tego sameɨgo katalogu co odpowiedni moduł.
  const katalogi = [
    join(REPO_ROOT, 'apps', 'web', 'src'),
    join(REPO_ROOT, 'apps', 'web', 'src', 'lib'),
  ];
  const znalezione = [
    ...new Set(
      katalogi.flatMap((katalog) =>
        readdirSync(katalog)
          .filter((plik) => /\.ts$/.test(plik))
          .filter(nazwa)
          .map((plik) => join(katalog, plik)),
      ),
    ),
  ];
  return znalezione.sort().map((sciezka) => readFileSync(sciezka, 'utf8')).join('\n');
}