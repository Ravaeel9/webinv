/**
 * Dekoder pliku CSV po stronie przeglądarki — wskrzeszony z modalu importu
 * osób do wspólnej biblioteki, bo modal importu macierzy wykonuje dokładnie
 * ten sam odczyt i dwie kopie tej funkcji rozeszłyby się pierwszym razem,
 * gdy ktoś poprawi jedną z nich.
 *
 * Dwa zachowania, na których zależy import:
 *
 *  - **Kodowanie wykrywane, nie deklarowane.** Administrator zapisuje
 *    eksport z Excela i nie wie, że to Windows-1250; plik musi się odczytać
 *    tak samo w obu modalach.
 *  - **BOM nie może prześlizgnąć się do pierwszej kolumny.** UTF-8 z BOM
 *    leci osobną ścieżką, Windows-1250 bez BOM produkuje trzy „znaki BOM"
 *    (`ď»ż`), które trzeba odciąć — inaczej pierwszy nagłówek przestaje
 *    się rozpoznawać.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { odczytajPlik } from '../../web/src/lib/csvPlik';

describe('odczytajPlik — dekodowanie pliku CSV', () => {
  it('UTF-8 z BOM: tryb utf-8, treść bez trzech bajtów BOM', () => {
    const bajty = new Uint8Array([0xef, 0xbb, 0xbf, ...bajtyUtf8('Imię;Jan;Łódź')]);
    const wynik = odczytajPlik(bajty.buffer);
    assert.equal(wynik.tryb, 'utf-8');
    assert.equal(wynik.tresc, 'Imię;Jan;Łódź');
  });

  it('czysty UTF-8 bez BOM dekoduje się normalnie', () => {
    const bajty = new Uint8Array(bajtyUtf8('Osoba;Łódź'));
    const wynik = odczytajPlik(bajty.buffer);
    assert.equal(wynik.tryb, 'utf-8');
    assert.ok(wynik.tresc.includes('Łódź'));
  });

  it('bajty Windows-1250 (0xf3 = ó) dekodują się do polskich liter', () => {
    // „ósmy" w Windows-1250: ó = 0xf3, reszta ASCII.
    const bajty = new Uint8Array([0xf3, 0x73, 0x6d, 0x79]);
    const wynik = odczytajPlik(bajty.buffer);
    assert.equal(wynik.tryb, 'windows-1250');
    assert.equal(wynik.tresc, 'ósmy');
  });

  it('Windows-1250: pełne polskie zdanie dekoduje się bez krzaków', () => {
    // „żółć;Wrocław" — bajty Windows-1250: ż=0xBF ó=0xF3 ł=0xB3 ć=0xE6,
    // reszta ASCII.
    const bajty = [0xbf, 0xf3, 0xb3, 0xe6, 0x3b, 0x57, 0x72, 0x6f, 0x63, 0xb3, 0x61, 0x77];
    const wynik = odczytajPlik(new Uint8Array(bajty).buffer);
    assert.equal(wynik.tryb, 'windows-1250');
    assert.equal(wynik.tresc, 'żółć;Wrocław');
  });

  // Uwaga: prefiksu BOM w pliku Windows-1250 (bajty EF BB BF) nie da się
  // przetestować przez ścieżkę catch — plik z tymi bajtami na początku
  // zawsze trafia w ścieżkę `maBom` (to fizycznie jest BOM UTF-8). Excel
  // zapisując Windows-1250 BOM-u nie wstawia, więc scenariusz nie występuje
  // realnie; obcięcie `ď»ż` w bibliotece to zabezpieczenie historyczne
  // pilnowane użyciem, nie testem.
});

/** UTF-8 → bajty (standardowy encoder, dokładnie to, co da przeglądarka). */
function bajtyUtf8(tekst: string): number[] {
  return Array.from(new TextEncoder().encode(tekst));
}
