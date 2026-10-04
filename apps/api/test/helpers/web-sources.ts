import { readdirSync } from 'node:fs';
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