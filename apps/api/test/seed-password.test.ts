/**
 * Walidacja hasła startowego administratora.
 *
 * Przypadek, który ten test zabezpiecza: `.env.example` zawierał
 * `SEED_ADMIN_PASSWORD=zmien-to-haslo`. Ta wartość przechodziła
 * jedyną walidację, jaką stosował `hashPassword()` — minimalną długość.
 * Konto dostawało rolę SUPER_ADMIN z hasłem bez wielkiej litery
 * i bez cyfry, znanym każdemu, kto pobrał repozytorium.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { assertSeedPasswordIsStrong } from '../src/seed/seed.service';

const ROOT = (() => {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, 'nginx', 'default.conf'))) return dir;
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Nie znaleziono katalogu repozytorium');
})();

describe('assertSeedPasswordIsStrong', () => {
  it('przepuszcza hasło spełniające pełną politykę', () => {
    assert.doesNotThrow(() => assertSeedPasswordIsStrong('Bezpieczne!2026'));
  });

  it('odrzuca wartość domyślną z .env.example', () => {
    // Dokładnie ta wartość, która dała SUPER_ADMIN słabym hasłem.
    assert.throws(
      () => assertSeedPasswordIsStrong('zmien-to-haslo'),
      /nie spełnia polityki haseł/,
    );
  });

  it('wymienia w komunikacie, czego brakuje', () => {
    // Operator musi wiedzieć, co poprawić — samo „hasło za słabe"
    // przy starcie kontenera nie wystarczy.
    assert.throws(() => assertSeedPasswordIsStrong('aaa'), /Wymaga wielkiej litery/);
    assert.throws(
      () => assertSeedPasswordIsStrong('Zmienione!'),
      /Wymaga cyfry/,
    );
  });

  it('odrzuca puste hasło', () => {
    assert.throws(() => assertSeedPasswordIsStrong(''), /polityki haseł/);
  });

  it('odrzuca popularne hasło poprawnej długości', () => {
    assert.throws(
      () => assertSeedPasswordIsStrong('password123'),
      /zbyt popularne/,
    );
  });

  it('wymienia nazwę zmiennej środowiskowej', () => {
    assert.throws(
      () => assertSeedPasswordIsStrong('za_slabe'),
      /SEED_ADMIN_PASSWORD/,
    );
  });
});

describe('.env.example — hasło startowe', () => {
  it('nie zawiera hasła spełniającego politykę', () => {
    // Gdyby ktoś „naprawił" przykład, wpisując tu działające hasło,
    // znowu stałoby się domyślnym hasłem każdej instalacji.
    const example = readFileSync(join(ROOT, '.env.example'), 'utf8');
    const line = /^SEED_ADMIN_PASSWORD=(.*)$/m.exec(example)?.[1] ?? '';
    if (line.length === 0) return; // puste = zatrzymanie startu, dobrze
    assert.throws(
      () => assertSeedPasswordIsStrong(line),
      /polityki haseł/,
      `wartość SEED_ADMIN_PASSWORD w .env.example przechodzi walidację: ${line}`,
    );
  });
});
