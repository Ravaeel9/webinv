/**
 * Weryfikacja wersji w bundlu (scripts/verify-version.sh).
 *
 * Powód istnienia: krok 5 `release.sh` sprawdzał wersję greppem po całym
 * katalogu assets — a numer wydania bywa też częścią numeru wersji
 * jakiejś zależności w vendorze. Wydanie 1.7.0 przeszło wtedy kontrolę
 * na **starym** bundlu: zbieżny napis w vendor-*.js zamaskował plakietkę,
 * która nadal pokazywała 1.6.1.
 *
 * Reguła naprawy: wersję szukamy w chunku aplikacji (`index-*.js`) —
 * dokładnie tam, gdzie żyje plakietka — a nie w całym katalogu.
 * Skrypt przyjmuje opcjonalny katalog, żeby test mógł podstawić sztuczne
 * assets bez Dockera i bez kontenera.
 */
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { REPO_ROOT } from './helpers/repo';

const SCRIPT = join(REPO_ROOT, 'scripts', 'verify-version.sh');

function assets(pliki: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'webinv-verify-'));
  mkdirSync(join(dir, 'assets'));
  for (const [nazwa, tresc] of Object.entries(pliki)) {
    writeFileSync(join(dir, 'assets', nazwa), tresc);
  }
  return dir;
}

describe('verify-version.sh — szuka wersji w chunku aplikacji, nie w vendorze', () => {
  it('przechodzi, gdy index-*.js zawiera wersję wydania', () => {
    const dir = assets({
      'index-DkOYRo7w.js': 'const v="1.7.0";',
      'vendor-BXvKn4.js': 'dep "11.7.0";',
    });
    const wynik = spawnSync('bash', [SCRIPT, '1.7.0', dir], { encoding: 'utf8' });
    assert.equal(wynik.status, 0, `stderr: ${wynik.stderr}`);
  });

  it('odrzuca bundl, w którym wersję ma tylko vendor (zbieżny numer zależności)', () => {
    // Dokładnie przypadek wydania 1.7.0: stara plakietka (1.6.1), a w
    // vendorze żyje zbieżny napis z numerem zależności.
    const dir = assets({
      'index-TC2APNxo.js': 'const v="1.6.1";',
      'vendor-BXvKn4.js': 'dep "x1.7.0y";',
    });
    const wynik = spawnSync('bash', [SCRIPT, '1.7.0', dir], { encoding: 'utf8' });
    assert.notEqual(wynik.status, 0, 'vendor nie może zastąpić plakietki w kontroli');
  });

  it('odrzuca brak chunku aplikacji (błąd, nie ciche przejście)', () => {
    const dir = assets({ 'vendor-BXvKn4.js': 'dep "1.7.0";' });
    const wynik = spawnSync('bash', [SCRIPT, '1.7.0', dir], { encoding: 'utf8' });
    assert.notEqual(wynik.status, 0, 'brak index-*.js musi wyglądać jak porażka');
  });

  it('odrzuca pusty katalog assets', () => {
    const wynik = spawnSync('bash', [SCRIPT, '1.7.0', mkdtempSync(join(tmpdir(), 'webinv-empty-'))], {
      encoding: 'utf8',
    });
    assert.notEqual(wynik.status, 0);
  });

  it('release.sh woła weryfikację tym skryptem (okablowanie nie zniknie)', () => {
    const zrodlo = readFileSync(join(REPO_ROOT, 'scripts', 'release.sh'), 'utf8');
    assert.match(zrodlo, /verify-version\.sh/, 'release.sh ma wywoływać scripts/verify-version.sh');
  });
});
