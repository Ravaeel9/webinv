/**
 * Test skryptu aktualizacji (scripts/update.sh).
 *
 * Powód tego testu: skrypt podnosi produkcyjną instancję do najnowszego
 * taga wydania i wykonuje przy tym operacje, których pomyłka kosztuje
 * dane (backup, checkout, przebudowa). Najtrudniejsza do zrobienia na
 * oko część to wybór wersji — porównanie musi być semantyczne
 * (v1.10.0 > v1.9.0), a nie leksykograficzne, bo sortowanie po tekście
 * cicho wybrałoby starsze wydanie.
 *
 * Skrypt jest pisany tak, żeby dało się go zaisować bez uruchamiania
 * (guard na `main`), więc testy sprawdzają funkcje pomocnicze i tryb
 * `--dry` na tymczasowym repo gita — bez Dockera i bez sieci.
 *
 * Uruchamiany z katalogu `apps/api` (`npm test`).
 */
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { REPO_ROOT } from './helpers/repo';

const SCRIPT = join(REPO_ROOT, 'scripts', 'update.sh');

/** Uruchamia kod bash z full-wyjściem, zakodowanym jako UTF-8. */
function bash(code: string, cwd?: string) {
  return spawnSync('bash', ['-c', code], { encoding: 'utf8', cwd });
}

/**
 * Buduje w /tmp sztuczne repozytorium z układem jak na serwerze:
 * scripts/update.sh, .env i historia tagów vX.Y.Z. Zwraca katalog.
 */
function fakeRepo(
  tags: string[],
  options: { env?: boolean; head?: string } = {},
): string {
  const dir = mkdtempSync(join(tmpdir(), 'webinv-update-'));
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(SCRIPT, join(dir, 'scripts', 'update.sh'));

  const git = (args: string) =>
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args.split(' ')], {
      cwd: dir,
      encoding: 'utf8',
    });
  assert.equal(git('init -q -b main').status, 0);
  writeFileSync(join(dir, 'README.md'), '# webinv\n');
  assert.equal(git('add README.md').status, 0);
  assert.equal(git('commit -q -m start').status, 0);
  for (const tag of tags) {
    assert.equal(git('commit -q --allow-empty -m ' + tag).status, 0);
    assert.equal(git('tag ' + tag).status, 0);
  }
  // HEAD tam, gdzie stoi serwer: na tagu, na którym instancja
  // ostatnio stanęła — niekoniecznie na ostatnim commicie gałęzi.
  assert.equal(git('checkout -q ' + (options.head ?? tags[0])).status, 0);
  if (options.env !== false) {
    writeFileSync(join(dir, '.env'), 'APP_PORT=8080\n');
  }
  return dir;
}

/** Uruchamia skrypt w trybie dry na sztucznym repo. */
function dry(dir: string) {
  return spawnSync('bash', [join(dir, 'scripts', 'update.sh'), '--dry'], {
    cwd: dir,
    encoding: 'utf8',
  });
}

describe('update.sh — funkcje porównywania wersji', () => {
  it('da się zaisować bez uruchamiania głównego przebiegu', () => {
    const r = bash(`source '${SCRIPT}' && type tag_gt >/dev/null`);
    assert.equal(r.status, 0, `sourcing padł: ${r.stderr}`);
  });

  it('tag_gt porównuje semantycznie, nie leksykograficznie', () => {
    // Klasyka błędu sortowania tekstem: "1.10.0" < "1.9.0" alfabetycznie.
    const cases: Array<[string, string, boolean]> = [
      ['v1.10.0', 'v1.9.0', true],
      ['v1.9.0', 'v1.10.0', false],
      ['v1.5.12', 'v1.5.9', true],
      ['v1.5.9', 'v1.5.12', false],
      ['v2.0.0', 'v1.99.99', true],
      ['v1.2.3', 'v1.2.3', false], // równe nie są „nowsze”
      ['v1.2.3', 'v1.2.4', false],
      ['v1.2.4', 'v1.2.3', true],
    ];
    for (const [a, b, expected] of cases) {
      const r = bash(`source '${SCRIPT}' && tag_gt '${a}' '${b}'`);
      assert.equal(
        r.status === 0,
        expected,
        `tag_gt '${a}' '${b}' — oczekiwano ${expected ? '>' : '<='}, status ${r.status}`,
      );
    }
  });

  it('newest_of wybiera najwyższą wersję z listy', () => {
    const r = bash(
      `source '${SCRIPT}' && newest_of v1.2.0 v1.10.0 v1.9.0 v0.3.0`,
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'v1.10.0');
  });

  it('newest_of odrzuca tagi bez prefiksu wersji', () => {
    const r = bash(
      `source '${SCRIPT}' && newest_of v1.2.0 stary-znakomity v1.1.0`,
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'v1.2.0');
  });

  it('newest_of czyta tagi także ze standardowego wejścia', () => {
    // Główny przebieg pipe'uje wyjście `git tag` prosto do tej funkcji —
    // jeśli czyta tylko argumenty, potok po cichu dałby pusty wynik
    // i skrypt uznałby, że nie ma żadnych wydań.
    const r = bash(`source '${SCRIPT}' && printf 'v1.2.0\\nv1.1.0\\n' | newest_of`);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'v1.2.0');
  });
});

describe('update.sh — tryb --dry', () => {
  it('pokazuje plan aktualizacji i niczego nie zmienia', () => {
    const dir = fakeRepo(['v1.0.0', 'v1.1.0']);
    const r = dry(dir);
    assert.equal(r.status, 0, `wyjście: ${r.stdout}\nbłędy: ${r.stderr}`);
    assert.match(r.stdout, /v1\.0\.0/);
    assert.match(r.stdout, /v1\.1\.0/);

    // Dry nie wolno przełączać HEAD ani zruszać drzewa roboczego.
    const at = spawnSync('git', ['tag', '--points-at', 'HEAD'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(at.stdout.trim(), 'v1.0.0', 'dry przełączył HEAD na nowy tag');
  });

  it('na najnowszym wydaniu kończy się sukcesem i komunikatem', () => {
    const dir = fakeRepo(['v1.0.0', 'v1.1.0'], { head: 'v1.1.0' });
    // HEAD oznaczony najnowszym tagiem = serwer już jest aktualny.
    const at = spawnSync('git', ['tag', '--points-at', 'HEAD'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(at.stdout.trim(), 'v1.1.0');
    const r = dry(dir);
    assert.equal(r.status, 0, `wyjście: ${r.stdout}\nbłędy: ${r.stderr}`);
    assert.match(r.stdout, /najnowsz/);
  });

  it('odmawia pracy na drzewie ze zmienionym plikiem śledzonym', () => {
    const dir = fakeRepo(['v1.0.0', 'v1.1.0']);
    writeFileSync(join(dir, 'README.md'), '# zmienione\n');
    const r = dry(dir);
    assert.notEqual(r.status, 0, 'skrypt poszedł dalej mimo brudnego drzewa');
    assert.match(r.stderr + r.stdout, /[Dd]rzew|brudn|zmian/);
  });

  it('odmawia pracy bez pliku .env', () => {
    const dir = fakeRepo(['v1.0.0'], { env: false });
    const r = dry(dir);
    assert.notEqual(r.status, 0, 'skrypt poszedł dalej mimo braku .env');
    assert.match(r.stderr + r.stdout, /\.env/);
  });
});
