/**
 * Przyciski raportu macierzy uprawnień w panelu.
 *
 * Raport jest dowodem przeglądu, więc przyciski muszą prowadzić do
 * **serwerowego** eksportu (pełne metadane aplikacji, wiersze „(brak
 * pozycji)", data wygenerowania w pliku) — a nie do lokalnego składania
 * CSV z wierszy już wczytanych na ekranie. Ten test pilnuje dwóch miejsc:
 * ekranu macierzy („Eksport całkowity") i karty aplikacji („Raport
 * aplikacji"), oraz tego, że stary eksport przeglądarki zniknął.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { read } from './helpers/repo';

const accessPage = read('apps', 'web', 'src', 'pages', 'AccessPage.tsx');
const sekcjaAplikacji = read(
  'apps',
  'web',
  'src',
  'components',
  'access',
  'ApplicationAccessSection.tsx',
);
const queriesAccess = read('apps', 'web', 'src', 'lib', 'queries-access.ts');

describe('Raport macierzy — przyciski w panelu', () => {
  it('ekran macierzy ma „Eksport całkowity" korzystający z serwerowego eksportu', () => {
    assert.ok(
      accessPage.includes('Eksport całkowity'),
      'przycisk raportu całościowego zniknął z ekranu macierzy',
    );
    assert.ok(
      accessPage.includes('downloadAccessExport('),
      'pobieranie musi iść przez serwerowy eksport, nie lokalny blob',
    );
    assert.ok(
      !accessPage.includes('accessMatrixCsv'),
      'eksport składany w przeglądarce zastąpiony serwerowym raportem',
    );
  });

  it('karta aplikacji ma „Raport aplikacji" z nazwą pliku z nazwy aplikacji', () => {
    assert.ok(
      sekcjaAplikacji.includes('Raport aplikacji'),
      'brak przycisku raportu przy macierzy aplikacji',
    );
    assert.ok(
      sekcjaAplikacji.includes('downloadAccessExport('),
      'raport aplikacji musi iść przez serwerowy eksport',
    );
    assert.ok(
      sekcjaAplikacji.includes('nazwaPlikuRaportu('),
      'nazwa pliku ma wynikać z nazwy aplikacji (slug), nie być sztywna',
    );
  });

  it('queries-access nie eksportuje już accessMatrixCsv, ale ma helpery raportu', () => {
    assert.ok(
      !/export (async )?function accessMatrixCsv/.test(queriesAccess),
      'serwerowy eksport zastępuje lokalny builder CSV',
    );
    assert.ok(
      queriesAccess.includes('export async function downloadAccessExport'),
      'brak helpera pobierania raportu',
    );
    assert.ok(
      queriesAccess.includes('export function nazwaPlikuRaportu'),
      'brak helpera nazwy pliku raportu',
    );
  });
});
