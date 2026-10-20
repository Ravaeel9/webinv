/**
 * Test na martwe hooki w `queries.ts`.
 *
 * Każdy eksportowany hook jest publiczną umową między komponentem a
 * API — jeśli nikt go nie używa, to nie ma warstwy, która dochodzi do
 * endpointu, a funkcja po stronie serwera umiera po cichu.
 *
 * Dokładnie tak było z `useUpdateAddress`: endpoint
 * `PATCH /ipam/addresses/:id` działał, był udokumentowany w
 * `docs/API.md`, serwis miał pełne pokrycie testami — a w interfejsie
 * nie było ani jednego przycisku, który by go wywołał. Plan wdrożenia
 * wymienił propsy tabeli bez `onEdit`, implementacja poszła za listą,
 * a testy serwisu (na atrapie portu) nie mogły tego zauważyć.
 *
 * Kierunek jest odwrotny niż w mapie endpointów: tu nie szukamy
 * „endpointu bez hooka" (konwencja nazw, krucha tabela do utrzymania),
 * tylko „hooka bez użytkownika" — to jedno źródło prawdy, które samo
 * się aktualizuje przy dodaniu nowego hooka.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { read } from './helpers/repo';
import { webLibText, webSources } from './helpers/web-sources';

const PLIKI = webSources();

/** Nazwy eksportów typu `export function useXxx` albo `export const useXxx`. */
function eksportowaneHooki(zrodlo: string): string[] {
  const nazwy: string[] = [];
  const wzorzec = /^export\s+(?:function|const)\s+(use[A-Z]\w*)/gm;
  let dopasowanie: RegExpExecArray | null;
  while ((dopasowanie = wzorzec.exec(zrodlo)) !== null) {
    nazwy.push(dopasowanie[1]!);
  }
  return nazwy;
}

// Teksty wszystkich modułów `queries*.ts` — podział po domenie
// nie może uciec przed tym testem na martwe hooki.
const QUERIES = webLibText((plik) => /^queries(-.*)?\.ts$/.test(plik));
const HOOKI = eksportowaneHooki(QUERIES);

describe('hooki w queries.ts', () => {
  it('jest ich do sprawdzenia — test nie może przejść w próżni', () => {
    // Gdyby wyrażenie przestało łapać eksporty, lista byłaby pusta i
    // pozostałe testy przechodziłyby bez sprawdzania czegokolwiek.
    assert.ok(
      HOOKI.length > 20,
      `znaleziono tylko ${HOOKI.length} hooki — wzorzec wyrażenia nie pasuje do queries.ts`,
    );
  });

  for (const hook of HOOKI) {
    it(`${hook} jest użyty gdzieś poza queries.ts`, () => {
      const uzycia = PLIKI.filter((sciezka) => {
        // Sam plik definicji nie liczy się jako użycie.
        if (sciezka.endsWith('web/src/lib/queries.ts')) return false;
        // Sama nazwa wystarczy — import albo wywołanie. Gdyby hook był
        // użyty wyłącznie w komentarzu, to i tak jest to sygnał do
        // poprawy, a nie powód, żeby test milczał.
        return new RegExp(`\\b${hook}\\b`).test(read(...sciezka.split('/')));
      });

      assert.ok(
        uzycia.length > 0,
        `${hook} jest eksportowane w queries.ts, ale nikt go nie używa — ` +
          'funkcja po stronie serwera umiera po cichu. ' +
          'Podepnij ją w komponencie albo usuń eksport.',
      );
    });
  }
});
