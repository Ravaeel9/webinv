/**
 * Trasy modułu `access` — sprawdzane na tekście kontrolera.
 *
 * Guard sprawdza tylko to, co jest zapisane na trasie. `@RequirePermission`
 * zapomniane przy jednym endpoincie oznaczałoby, że jest dostępny dla
 * VIEWER — czyli dla osoby, która nie powinna widzieć listy osób z dostępem
 * do aplikacji. Dlatego każda trasa musi mieć uprawnienie, a nazwy tras
 * trzymamy w jednej stałej, żeby test i kontroler nie rozjeżdżały się.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { read } from './helpers/repo';

const zrodlo = read('apps', 'api', 'src', 'access', 'access.controller.ts');

/** Trasy i wymagane uprawnienie — jedno źródło prawdy dla testu. */
const TRASY: Array<[metoda: string, sciezka: string, uprawnienie: string]> = [
  ['Get', 'applications/:id', 'access:read'],
  ['Post', 'applications/:id', 'access:write'],
  ['Patch', 'applications/:id/:personId', 'access:write'],
  ['Delete', 'applications/:id/:personId', 'access:write'],
  ['Get', 'matrix', 'access:read'],
  ['Get', 'persons', 'access:read'],
  ['Get', 'persons/:id', 'access:read'],
  ['Post', 'persons', 'access:write'],
  ['Patch', 'persons/:id', 'access:write'],
  ['Delete', 'persons/:id', 'access:write'],
];

/**
 * Trasy odczytane z pliku: każda dekorator `@Get/@Post/@Patch/@Delete`
 * wraz z blokiem do następnego dekoratora trasy.
 *
 * Szukamy wszystkich wystąpień ścieżki, bo `GET persons` i `POST persons`
 * to dwie różne trasy o tej samej nazwie — `indexOf` znalazłby tylko
 * pierwszą i druga przeszłaby bez sprawdzenia.
 */
function trasy(): Array<{ metoda: string; sciezka: string; blok: string }> {
  const wzorzec = /\n {2}@(Get|Post|Patch|Delete)\('([^']+)'\)/g;
  const znalezione: Array<{ metoda: string; sciezka: string; blok: string }> = [];
  let dopasowanie: RegExpExecArray | null;
  while ((dopasowanie = wzorzec.exec(zrodlo)) !== null) {
    const nastepna = zrodlo.slice(dopasowanie.index + 1).search(/\n {2}@(Get|Post|Patch|Delete)\(/);
    const koniec = nastepna === -1 ? zrodlo.length : dopasowanie.index + 1 + nastepna;
    znalezione.push({
      metoda: dopasowanie[1]!,
      sciezka: dopasowanie[2]!,
      blok: zrodlo.slice(dopasowanie.index, koniec),
    });
  }
  return znalezione;
}

describe('Kontroler access: trasy i uprawnienia', () => {
  for (const [metoda, sciezka, uprawnienie] of TRASY) {
    it(`${metoda} ${sciezka} wymaga ${uprawnienie}`, () => {
      const pasujace = trasy().filter((t) => t.metoda === metoda && t.sciezka === sciezka);
      assert.equal(pasujace.length, 1, `oczekiwano dokładnie jednej trasy ${metoda} ${sciezka}`);
      assert.ok(
        pasujace[0]!.blok.includes(`@RequirePermission('${uprawnienie}')`),
        `trasa ${metoda} ${sciezka} nie ma @RequirePermission('${uprawnienie}')`,
      );
    });
  }

  it('każda trasa kontrolera ma uprawnienie i jest na liście', () => {
    const znane = new Set(TRASY.map(([m, s]) => `${m} ${s}`));
    for (const t of trasy()) {
      assert.ok(
        t.blok.includes('@RequirePermission('),
        `trasa ${t.metoda} ${t.sciezka} nie ma @RequirePermission`,
      );
      assert.ok(znane.has(`${t.metoda} ${t.sciezka}`), `nieznana trasa ${t.metoda} ${t.sciezka}`);
    }
    assert.equal(trasy().length, TRASY.length);
  });

  it('kontroler nie udostępnia trasy publicznej', () => {
    // Tylko dekorator w kodzie: nazwa `@Public()` pojawia się też
    // w komentarzu kontrolera, wyjaśniającym dlaczego go tam nie ma.
    assert.equal(/^\s*@Public\(\)/m.test(zrodlo), false);
  });
});