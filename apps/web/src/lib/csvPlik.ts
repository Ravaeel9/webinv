/**
 * Odczyt pliku CSV z kodowaniem, którego administrator nie deklaruje.
 *
 * Wspólne dla importu katalogu osób i importu macierzy uprawnień: oba
 * przyjmują plik z tego samego świata — eksport z systemu albo poprawki
 * właściciela aplikacji w Excelu — i oba muszą go odczytać identycznie.
 * Dwukrotna kopia tej funkcji rozeszłaby się pierwszym razem, gdy ktoś
 * poprawi jedną z nich.
 *
 * Kolejność wykrywania: BOM w UTF-8 → próba UTF-8 (`fatal: true`, bo
 * ciche zepsute dekodowanie daje tekst z krzakami) → Windows-1250,
 * typowe dla polskiego eksportu z Excela.
 *
 * Ostatni krok usuwa BOM zdekodowany jako znaki: `TextDecoder('windows-1250')`
 * nie zna BOM (to instrukcja dla UTF-8), więc bajty `EF BB BF` stają się
 * trzema literami `ď»ż` i pierwsza kolumna pliku przestaje się rozpoznawać.
 */

/** Trzy bajty BOM w UTF-8. */
const BOM_UTF8 = [0xef, 0xbb, 0xbf];

export function odczytajPlik(bajty: ArrayBuffer): { tresc: string; tryb: 'utf-8' | 'windows-1250' } {
  const surowe = new Uint8Array(bajty);
  const maBom = BOM_UTF8.every((b, i) => surowe[i] === b);

  if (maBom) {
    return {
      tresc: new TextDecoder('utf-8').decode(surowe.subarray(BOM_UTF8.length)),
      tryb: 'utf-8',
    };
  }

  try {
    return { tresc: new TextDecoder('utf-8', { fatal: true }).decode(surowe), tryb: 'utf-8' };
  } catch {
    const zBom = new TextDecoder('windows-1250').decode(surowe);
    return {
      tresc: zBom.startsWith('\u010f\u00bb\u017e') ? zBom.slice(3) : zBom,
      tryb: 'windows-1250',
    };
  }
}
