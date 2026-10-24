/**
 * Endpointy importu macierzy uprawnień — sprawdzane na tekście kontrolera.
 *
 * Kontroler jest cienkim mostem między HTTP a serwisem: jego rola to
 * przekazanie właściwych pól DTO (`csv`, `applicationId`, `rows`) i wymaganie
 * `access:write`. Trasy i uprawnienia pilnuje `access-controller.test.ts`
 * (jedno źródło prawdy w `TRASY`); ten test pilnuje, że dane z requestu
 * faktycznie docierają do serwisu — pomylone pole przeglądarki dostałoby
 * `<undefined>` bez żadnego błędu.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { read } from './helpers/repo';

const zrodlo = read('apps', 'api', 'src', 'access', 'access.controller.ts');

describe('Kontroler access: endpointy importu macierzy', () => {
  it('preview przekazuje csv i applicationId do serwisu', () => {
    const blok = blokTrasy(zrodlo, 'import/matrix/preview');
    assert.ok(blok.includes('this.access.previewMatrixImport(dto.csv, dto.applicationId)'));
  });

  it('apply przekazuje rows, aktora, IP i applicationId do serwisu', () => {
    const blok = blokTrasy(zrodlo, 'import/matrix/apply');
    assert.ok(
      blok.includes(
        'this.access.applyMatrixImport(dto.rows, actor, ip, dto.applicationId)',
      ),
    );
  });

  it('import osób importuje DTO macierzy z dto/import.dto.ts', () => {
    // Sugar, ale pilnuje ścieżki: DTO w osobnym pliku, nie w kontrolerze.
    assert.ok(zrodlo.includes("'./dto/import.dto'"));
  });
});

/** Blok tekstowy konkretnej trasy — od dekoratora do następnego dekoratora trasy. */
function blokTrasy(zrodloKontrolera: string, sciezka: string): string {
  const poczatek = zrodloKontrolera.indexOf(`'${sciezka}'`);
  assert.notEqual(poczatek, -1, `brak trasy ${sciezka}`);
  const nastepna = zrodloKontrolera.slice(poczatek + 1).search(/\n {2}@(Get|Post|Patch|Delete)\(/);
  const koniec = nastepna === -1 ? zrodloKontrolera.length : poczatek + 1 + nastepna;
  return zrodloKontrolera.slice(poczatek, koniec);
}
