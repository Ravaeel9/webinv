/**
 * Weryfikacja dostępów — warstwa frontendu.
 *
 * Rejestr przeglądów bez widoku w interfejsie byłby rejastrem dla audytora,
 * którego nikt nie odpali. Ten plik pilnuje trzech miejsc, w których
 * weryfikacja musi być widoczna:
 *
 *  - **macierz zbiorcza** (AccessPage → zakładka „Macierz uprawnień") —
 *    kolumna „Zweryfikowano" i rejestr przeglądów całej macierzy,
 *  - **karta aplikacji** (ApplicationAccessSection) — ta sama kolumna,
 *    akcja przy wierszu i rejestr tej aplikacji,
 *  - **kontrakt typów** — `verifiedOn` w wierszach macierzy i typ wpisu
 *    muszą odpowiadać odpowiedzi API, inaczej kolumna pokazuje `undefined`.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { read } from './helpers/repo';

const typy = read('apps', 'web', 'src', 'types-access.ts');
const klucze = read('apps', 'web', 'src', 'lib', 'queries-keys.ts');
const hooki = read('apps', 'web', 'src', 'lib', 'queries-access.ts');
const macierz = read('apps', 'web', 'src', 'pages', 'AccessPage.tsx');
const kartaAplikacji = read('apps', 'web', 'src', 'pages', 'ApplicationDetailPage.tsx');
const karta = read(
  'apps', 'web', 'src', 'components', 'access', 'ApplicationAccessSection.tsx',
);

describe('Typy frontendu — weryfikacja dostępów', () => {
  it('wiersze macierzy mają datę weryfikacji jako tekst albo null', () => {
    for (const interfejs of ['ApplicationGrant', 'AccessMatrixRow']) {
      const blok = typy.match(
        new RegExp(`export interface ${interfejs} \\{[\\s\\S]*?\\n\\}`),
      )?.[0] ?? '';
      assert.ok(
        /verifiedOn:\s*string \| null/.test(blok),
        `${interfejs} nie zna pola verifiedOn`,
      );
    }
  });

  it('typ wpisu weryfikacji odpowiada odpowiedzi API', () => {
    const blok = typy.match(/export interface AccessVerification \{[\s\S]*?\n\}/)?.[0] ?? '';
    for (const pole of [
      'id',
      'scope',
      'verifiedOn',
      'note',
      'application',
      'personName',
      'actorName',
    ]) {
      assert.ok(blok.includes(pole), `brak pola ${pole} w AccessVerification`);
    }
    assert.match(typy, /export type AccessVerificationScope =\s*'MATRIX' \| 'APPLICATION' \| 'GRANT'/);
  });
});

describe('Hooki zapytań — weryfikacja dostępów', () => {
  it('qk ma klucz rejestru weryfikacji pod prefiksem access', () => {
    assert.match(klucze, /accessVerifications:/, 'brak klucza accessVerifications w qk');
  });

  it('useVerifications czyta historię, useCreateVerification zapisuje ją', () => {
    assert.match(hoki(), /export function useVerifications\(/);
    assert.match(hoki(), /export function useCreateVerification\(/);
    // Zapis trafia POST-em na tę samą ścieżkę, którą czyta GET —
    // rozjazd ścieżek wyszedłby dopiero na żywym API.
    assert.match(hoki(), /`\/access\/verifications\${buildQuery/);
    assert.match(hoki(), /api\.post<\{ verification: AccessVerification \}>/);
  });

  function hoki() {
    return hooki;
  }
});

describe('Widoki — weryfikacja dostępów', () => {
  it('macierz zbiorcza ma kolumnę „Zweryfikowano" i sekcję rejestru', () => {
    assert.ok(macierz.includes('Zweryfikowano'), 'brak kolumny Zweryfikowano w macierzy');
    assert.ok(
      macierz.includes('<AccessVerificationsSection'),
      'brak sekcji weryfikacji na stronie macierzy',
    );
  });

  it('karta aplikacji ma kolumnę, akcję przy wierszu i sekcję rejestru', () => {
    assert.ok(karta.includes('Zweryfikowano'), 'brak kolumny Zweryfikowano w karcie aplikacji');
    // Rejestr jest rodzeństwem sekcji uprawnień na karcie aplikacji —
    // zagnieżdżenie karty w karcie wyglądałoby jak druga tabelka w sekcji.
    assert.ok(
      kartaAplikacji.includes('<AccessVerificationsSection'),
      'brak sekcji weryfikacji na karcie aplikacji',
    );
    assert.match(karta, /zweryfikujGrant/, 'brak akcji weryfikacji pojedynczego grantu');
  });

  it('sekcja rejestru używa prymitywów tabeli i pilnuje zakresu zapisu', () => {
    const sekcja = read(
      'apps', 'web', 'src', 'components', 'access', 'AccessVerificationsSection.tsx',
    );
    // Wspólne prymitywy — kolumny sekcji nie mogą rozjechać się z macierzą.
    assert.ok(
      sekcja.includes("from '../ui/Table'"),
      'sekcja weryfikacji pisze własny <table> zamiast prymitywów',
    );
    assert.match(
      sekcja,
      /scope: 'MATRIX' \| 'APPLICATION'/,
      'sekcja musi rozstrzygać zakres MATRIX/APPLICATION wg kontekstu',
    );
  });
});
