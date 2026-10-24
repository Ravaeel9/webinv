/**
 * Import macierzy uprawnień — okablowanie w interfejsie.
 *
 * Modal importu macierzy jest bliźniakiem `ImportPersonsModal` (plik →
 * podgląd → zapis), ale jego sprawdzenie przy pomocy wirtualnego DOM-u
 * kosztowałoby więcej niż pełnia widoku między kilkoma dokładnymi
 * asercjami na źródłach. Test pilnuje okablowania: który modal otwierają
 * punkty wejścia, jakich bibliotek używa, jakich kodów błędów tłumaczy —
 * a logika zapisu jest przetestowana po stronie API
 * (`access-matrix-import.test.ts`).
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
const modal = read('apps', 'web', 'src', 'components', 'access', 'ImportMatrixModal.tsx');
const queriesAccess = read('apps', 'web', 'src', 'lib', 'queries-access.ts');
const typesAccess = read('apps', 'web', 'src', 'types-access.ts');

describe('Import macierzy — punkty wejścia', () => {
  it('ekran macierzy otwiera ImportMatrixModal przy zezwoleniu access:write', () => {
    assert.ok(accessPage.includes('ImportMatrixModal'));
    assert.ok(accessPage.includes('setImportMacierzy'), 'brakuje stanu otwarcia modala');
  });

  it('karta aplikacji importuje do niej samej — przekazuje applicationId', () => {
    assert.ok(sekcjaAplikacji.includes('ImportMatrixModal'));
    assert.ok(
      sekcjaAplikacji.includes('applicationId') && sekcjaAplikacji.includes('nazwaAplikacji'),
      'modal musi dostać kontekst aplikacji, żeby nie importować do cudzej',
    );
  });
});

describe('Import macierzy — modal', () => {
  it('odczytuje plik wspólnej biblioteką, nie własną kopią dekodera', () => {
    assert.ok(modal.includes("from '../../lib/csvPlik'"));
    // Dwukrotna kopia dekodera to droga do rozjazdu — modal nie może jej mieć.
    assert.ok(!modal.includes('new TextDecoder('));
  });

  it('używa hooków macierzowych, nie hooków importu osób', () => {
    assert.ok(modal.includes('useMatrixImportPreview('));
    assert.ok(modal.includes('useMatrixImportApply('));
    assert.ok(!modal.includes('usePreviewPersonsImport'));
  });

  it('tłumaczy kody błędów wiersza słownikiem POWODY', () => {
    for (const kod of [
      'UNKNOWN_APP',
      'GENERAL_USE_APP',
      'APP_MISMATCH',
      'DUPLICATE_IN_FILE',
      'PERSON_INACTIVE',
      'MISSING_NAME',
      'INVALID_EMAIL',
      'EXPIRY_IN_PAST',
      'INVALID_LEVEL',
      'INVALID_DATE',
      'MISSING_EMAIL',
      'NOTE_TOO_LONG',
    ]) {
      assert.ok(modal.includes(`${kod}:`), `POWODY nie ma kodu ${kod}`);
    }
  });

  it('pokazuje wynik zapisu z listą pominiętych wierszy', () => {
    assert.ok(modal.includes('skippedRows'));
    assert.ok(modal.includes('createdGrants') && modal.includes('updatedGrants'));
  });

  it('wysyła rows z podglądu bez pól raportu (status/errors)', () => {
    // Zapis mapuje zaznaczone wiersze na pola danych; statusy i kody błędów
    // zostają w podglądzie — serwis i tak waliduje od nowa.
    assert.ok(
      /rows: (zaznaczone|doZapisy|wybraneWiersze)\.map/.test(modal),
      'zapis mapuje zaznaczone wiersze na pola danych',
    );
    assert.ok(!/status:\s*wier/.test(modal));
    assert.ok(!/errors:\s*wier/.test(modal));
  });
});

describe('Import macierzy — hooki i typy', () => {
  it('hooki POSTują do endpointów macierzy', () => {
    assert.ok(queriesAccess.includes("'/access/import/matrix/preview'"));
    assert.ok(queriesAccess.includes("'/access/import/matrix/apply'"));
  });

  it('zapis unieważnia dane macierzy po sukcesie', () => {
    const hook = hookApply(queriesAccess);
    assert.ok(hook.includes('invalidate()'), 'useMatrixImportApply nie odświeża macierzy');
  });

  it('typy podglądu i wyniku istnieją i eksportują się z types-access', () => {
    for (const typ of [
      'MatrixImportRowStatus',
      'MatrixImportPreviewRow',
      'MatrixImportDiff',
      'MatrixImportPreview',
      'MatrixImportSkippedRow',
      'MatrixImportResult',
    ]) {
      assert.ok(
        typesAccess.includes(`export type ${typ}`) || typesAccess.includes(`export interface ${typ}`),
        `brak typu ${typ}`,
      );
    }
  });
});

/** Cały blok `useMatrixImportApply` — do sprawdzenia invalidate. */
function hookApply(zrodlo: string): string {
  const poczatek = zrodlo.indexOf('export function useMatrixImportApply');
  assert.notEqual(poczatek, -1, 'brak useMatrixImportApply');
  const koniec = zrodlo.indexOf('\n}', poczatek);
  return zrodlo.slice(poczatek, koniec + 2);
}
