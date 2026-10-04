/**
 * `index.css` musi się dać skompilować.
 *
 * `npm test` i `npm run typecheck` nie dotykają CSS-a, więc gałąź
 * mogła przejść obie komendy w zieleni i nie dać się wdrożyć. Ten test
 * uruchamia ten sam kompilator, którego używa `vite build`, i sprawdza
 * dokładnie to, co zostanie wydane do `dist/`.
 *
 * Pierwsza wersja tego pliku nie istniała i cena była wysoka: wszystkie
 * tony, banery i aktywna pozycja nawigacji były pisane jako
 * `@apply bg-oklch(0.915 0.04 255)`, a Tailwind 4.3.3 dzieli listę
 * utility po spacjach **bez szacowania nawiasów**. `oklch(0.915 0.04
 * 255)` rozchodziło się na trzy kawałki i kompilator rzucał
 * `Cannot apply unknown utility class`. Interfejs nie był możliwy do
 * zbudowania — a same testy kontrastu były zielone, bo czytają plik
 * jako tekst i nigdy go nie kompilują.
 *
 * Poprawna postać to wartość dowolna w nawiasie kwadratowym ze
 * spacjami zamienionymi na podkreślenia: `bg-[oklch(0.915_0.04_255)]`.
 * Podkreślenie jest dla Tailwina znakiem spacji wewnątrz wartości —
 * przepisuje je na spację w wynikowym CSS.
 *
 * Ten test nie zastępuje `npm run build` — sprawdza tylko, że sam CSS
 * jest poprawny, bez bundlowania całej aplikacji.
 */
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { REPO_ROOT } from './helpers/repo';

const require = createRequire(join(REPO_ROOT, 'apps', 'api', 'package.json'));

/** Katalog, w którym kompilujemy — musi widzieć `node_modules` repo. */
const BASE = join(REPO_ROOT, 'apps', 'web', 'src');

/**
 * `loadStylesheet` dla `@import "tailwindcss"`.
 *
 * Kompilujemy z `BASE`, więc import musi zresolve'ować się względem
 * katalogu aplikacji — czyli do `node_modules` w korzeniu repo.
 */
async function loadStylesheet(
  _id: string,
  _base: string,
): Promise<{ path: string; base: string; content: string }> {
  const entry = join(REPO_ROOT, 'node_modules', 'tailwindcss', 'index.css');
  const css = require('node:fs').readFileSync(entry, 'utf8') as string;
  return { path: entry, base: dirname(entry), content: css };
}

/** Kompiluje `index.css` tym samym kompilatorem, co `vite build`. */
async function compileIndex(): Promise<{ error: string | null }> {
  const { readFileSync } = await import('node:fs');

  // `require.resolve` wskazuje na plik CJS (`dist/lib.js`), a `compile`
  // jest eksportem ESM. `?module` wymusza wariant `.mjs` — inaczej
  // dostajemy `compile is not a function` zamiast kompilacji.
  const specifier = require
    .resolve('tailwindcss', { paths: [BASE] })
    .replace(/lib\.js$/, 'lib.mjs');
  const { compile } = (await import(specifier)) as {
    compile: (
      css: string,
      opts: {
        base: string;
        loadStylesheet: typeof loadStylesheet;
      },
    ) => Promise<unknown>;
  };

  try {
    await compile(readFileSync(join(BASE, 'index.css'), 'utf8'), {
      base: BASE,
      loadStylesheet,
    });
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

describe('index.css — kompilowalność', () => {
  it('Tailwind kompiluje index.css bez błędu', async () => {
    const { error } = await compileIndex();
    assert.equal(
      error,
      null,
      `index.css nie kompiluje się:\n${error ?? ''}\n` +
        'Jeśli widzisz "Cannot apply unknown utility class", ' +
        'wartość koloru musi być wartością dowolną w nawiasie ' +
        'kwadratowym ze spacjami jako podkreśleniami: ' +
        '`bg-[oklch(0.915_0.04_255)]`, nie `bg-oklch(0.915 0.04 255)`.',
    );
  });
});