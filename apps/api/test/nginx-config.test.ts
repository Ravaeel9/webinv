/**
 * Test spójności konfiguracji nginx.
 *
 * Powód tego testu: CSP było wyłączone w dwóch miejscach naraz —
 * `contentSecurityPolicy: false` w `main.ts` z komentarzem „nagłówki
 * CSP ustawia nginx", a w `nginx/default.conf` takiego nagłówka nie
 * było. Każde z tych miejsc wyglądało na poprawne osobno, więc brak
 * polityki nikt nie zauważył, dopóki nie zrobił tego audyt.
 *
 * Test czyta pliki konfiguracyjne z repo i sprawdza, że:
 *  1. polityka CSP jest zdefiniowana dokładnie raz,
 *  2. każdy `location`, który sam używa `add_header`, ma `include`
 *     nagłówków — bo `add_header` w `location` zeruje odziedziczone,
 *  3. wartości faktycznie pasują do tego, co frontend ładuje
 *     (build Vite bez `eval()`, bez zasobów z innych origin).
 *
 * Uruchamiany z katalogu `apps/api` (`npm test`).
 */
import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Katalog repozytorium.
 *
 * `npm test` uruchamia się z `apps/api`, ale wywołanie skryptu
 * z katalogu nadrzędnego też musi działać — stąd szukanie `nginx/`
 * w górę, zamiast hardkodowanego `../../..`.
 */
const ROOT = (() => {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, 'nginx', 'default.conf'))) return dir;
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Nie znaleziono katalogu repozytorium (brak nginx/default.conf)');
})();

function config(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

/** Wyciąga wartość `add_header <nazwa> "<wartość>";` z pliku. */
function headerValue(source: string, name: string): string | null {
  const match = new RegExp(`add_header\\s+${name}\\s+"([^"]*)"`).exec(source);
  return match?.[1] ?? null;
}

const serverConf = config('nginx/default.conf');
const headers = config('nginx/snippets/security-headers.conf');

describe('nginx — polityka CSP', () => {
  it('jest zdefiniowana', () => {
    const csp = headerValue(headers, 'Content-Security-Policy');
    assert.ok(csp, 'brak nagłówka Content-Security-Policy');
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'self'/);
    assert.match(csp, /frame-ancestors 'self'/);
    assert.match(csp, /form-action 'self'/);
  });

  it('nie dopuszcza unsafe-inline dla skryptów', () => {
    // Cała wartość polityki dla skryptów to `'self'`. Gdyby kiedyś
    // dopisano tu `'unsafe-inline'`, test ma zadziałać zamiast
    // komentarza, który nikt nie czyta.
    const csp = headerValue(headers, 'Content-Security-Policy') ?? '';
    const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1].trim();
    assert.equal(scriptSrc, "'self'");
  });

  it('nie dopuszcza unsafe-inline dla stylów', () => {
    // React ustawia style przez CSSOM (`style.setProperty`), co CSP
    // przepuszcza, a arkusze Tailwanda to zwykły `<link>`. Więc
    // `'unsafe-inline'` nie jest potrzebne — i nie powinno być.
    const csp = headerValue(headers, 'Content-Security-Policy') ?? '';
    const styleSrc = /style-src ([^;]*)/.exec(csp)?.[1].trim();
    assert.equal(styleSrc, "'self'");
  });

  it('nie używa upgrade-insecure-requests przy wdrożeniu HTTP', () => {
    // Dyrektywa przepisywałaby zasoby na https:// i wycięłaby
    // dostęp do wdrożenia, w którym nie ma TLS.
    const csp = headerValue(headers, 'Content-Security-Policy') ?? '';
    assert.equal(csp.includes('upgrade-insecure-requests'), false);
  });

  it('dopuszcza tylko własne origin dla połączeń API', () => {
    const csp = headerValue(headers, 'Content-Security-Policy') ?? '';
    const connectSrc = /connect-src ([^;]*)/.exec(csp)?.[1].trim();
    assert.equal(connectSrc, "'self'");
  });
});

describe('nginx — nagłówki nie giną w location', () => {
  it('server dołącza nagłówki bezpieczeństwa', () => {
    assert.match(
      serverConf,
      /include \/etc\/nginx\/snippets\/security-headers\.conf;/,
    );
  });

  it('każdy location z add_header ma include nagłówków', () => {
    // `add_header` w bloku `location` zastępuje CAŁY zestaw
    // odziedziczony, a nie go rozszerza. Bez `include` w danym
    // `location` nagłówki znikają właśnie tam, gdzie były ustawione.
    const locations = serverConf.match(/location [^{]+\{[\s\S]*?\n    \}/g) ?? [];
    assert.ok(locations.length >= 4, `znaleziono ${locations.length} location`);

    for (const block of locations) {
      if (!/add_header/.test(block)) continue;
      assert.match(
        block,
        /include \/etc\/nginx\/snippets\/security-headers\.conf;/,
        `location bez include: ${block.split('{')[0].trim()}`,
      );
    }
  });

  it('nie ustawia wycofanego X-XSS-Protection', () => {
    // Dyrektywa wycofana; `1; mode=block` w starszych wersjach
    // potrafił sam uszkodzić stronę. Ochronę daje CSP.
    // Szukamy `add_header`, nie nazwy — nazwa pojawia się w komentarzu
    // wyjaśniającym, dlaczego go nie ma.
    assert.equal(/add_header\s+X-XSS-Protection/.test(serverConf), false);
    assert.equal(/add_header\s+X-XSS-Protection/.test(headers), false);
  });
});

describe('CSP a build frontendu', () => {
  /**
   * `style-src 'self'` bez `'unsafe-inline'` przepuszcza arkusze z
   * `<link rel="stylesheet">`, ale NIE `<style>` wstrzyknięty skryptem.
   *
   * Vite ma do tego gotowy kod: polyfill `modulepreload` tworzy
   * `<style>` i wkleja w niego treść CSS dla każdego kodu ładowanego
   * przez `import()`. Przy dzisiejszym buildzie żaden chunk nie
   * importuje CSS (`index.html` ma zwykły `<link>`), więc ta ścieżka
   * nigdy się nie wykonuje — ale pierwsze `lazy(() => import('./X'))`
   * przy pliku `.css` włączy ją cicho i strona dostanie CSP violation.
   *
   * Test czytuje build, jeśli istnieje. Bez `dist/` (czysty checkout,
   * testy przed buildem) sprawdzenie jest pomijane, nie fałszowane.
   */
  it('żaden chunk nie ładuje CSS przez import()', () => {
    const assetsDir = join(ROOT, 'apps', 'web', 'dist', 'assets');
    if (!existsSync(assetsDir)) return;

    const files = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
    assert.ok(files.length > 0, 'brak plików JS w dist/assets');

    for (const file of files) {
      const source = readFileSync(join(assetsDir, file), 'utf8');
      // Referencja do pliku `.css`, np. `import("./X.css")` — Vite
      // zamienia ją na wstrzyknięcie `<style>`.
      //
      // Wzorzec wymaga co najmniej jednego znaku przed `.css`, żeby nie
      // łapać samego literału `` `.css` `` wewnątrz kodu polyfillu
      // `modulepreload` (`t.endsWith('.css')`) — to jest ogólna obsługa
      // Vite, nie faktycznie ładowany arkusz.
      assert.equal(
        /["'`][^"'`]+\.css["'`]/.test(source),
        false,
        `${file} ładuje CSS przez import() — Vite wstrzyknie <style>, ` +
          'który CSP z style-src \'self\' zablokuje. Wycofaj import CSS ' +
          'z tego modułu albo przenieś styl do index.css.',
      );
    }
  });

  it('index.html nie ma inline script ani inline style', () => {
    const html = join(ROOT, 'apps', 'web', 'dist', 'index.html');
    if (!existsSync(html)) return;

    const source = readFileSync(html, 'utf8');
    // Skrypty inline wymagałyby 'unsafe-inline' w script-src.
    assert.equal(
      /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/.test(source),
      false,
      'inline <script> w index.html — zablokowany przez script-src \'self\'',
    );
    // Style inline (atrybut style=) też są blokowane przez style-src-attr.
    assert.equal(/\sstyle="/.test(source), false, 'atrybut style= w index.html');
  });

  it('build nie używa eval ani new Function', () => {
    // Bez `unsafe-eval` w script-src każde takie wywołanie jest
    // zablokowane — a nie wyjątkiem, tylko brakiem działającego kodu.
    const assetsDir = join(ROOT, 'apps', 'web', 'dist', 'assets');
    if (!existsSync(assetsDir)) return;

    for (const file of readdirSync(assetsDir).filter((f) => f.endsWith('.js'))) {
      const source = readFileSync(join(assetsDir, file), 'utf8');
      assert.equal(
        /\beval\s*\(/.test(source),
        false,
        `${file} używa eval() — potrzebne byłoby 'unsafe-eval' w CSP`,
      );
      assert.equal(
        /new\s+Function\s*\(/.test(source),
        false,
        `${file} używa new Function() — potrzebne byłoby 'unsafe-eval' w CSP`,
      );
    }
  });
});

describe('API — spójność z nginx', () => {
  it('nie włącza CSP sam, skoro nie serwuje dokumentów', () => {
    const main = config('apps/api/src/main.ts');
    assert.match(main, /contentSecurityPolicy: false/);
  });

  it('wyłączenie w API nie kłamie — komentarz wskazuje plik z CSP', () => {
    // Dokładnie ten regresja, której ten test pilnuje: komentarz
    // obiecywał nagłówki w nginx, a nginx ich nie miał.
    const main = config('apps/api/src/main.ts');
    assert.match(main, /snippets\/security-headers\.conf/);
  });
});
