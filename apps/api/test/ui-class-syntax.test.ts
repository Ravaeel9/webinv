/**
 * Składnia klas Tailwinda w JSX — wartości, które kompilator odrzuca po cichu.
 *
 * `ui-css-builds.test.ts` pilnuje tego samego problemu w `index.css`, a
 * `ui-css-output.test.ts` sprawdza, że klasy z `@layer components`
 * dotarły do builda. Żaden z nich nie widzy klasy napisanej
 * wprost w JSX — a to najczęstsze miejsce, w którym psuje się składnia.
 *
 * Konkretna szkoda, która uzasadnia ten plik: `hover:bg-oklch(0.83 0.08
 * 20 / 0.4)` w `Feedback.tsx` wygląda poprawnie, przechodzi
 * `typecheck`, przechodzi `vite build` bez ostrzeżenia — i nie robi
 * nic. Tailwind dzieli nazwę utility po spacjach bez szacowania
 * nawiasów, więc wartość z trzema argumentami rozchodzi się na trzy
 * kawałki, z których żaden nie jest znaną klasą. W wynikowym CSS
 * nie ma po niej śladu, a przycisk „Ponów" traci tło pod kursorem.
 *
 * Poprawna postać to wartość dowolna w nawiasie kwadratowym ze
 * spacjami zamienionymi na podkreślenia: `hover:bg-[oklch(0.83_0.08_20_/_0.4)]`.
 *
 * Ten test celowo nie zna gramatyki Tailwinda — szuka jednej rzeczy:
 * utility koloru, po której zamiast `[` stoi nazwa funkcji CSS. Taki
 * zapis nigdy nie jest poprawny, więc wyjątków nie trzeba utrzymywać.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { read } from './helpers/repo';
import { webSources } from './helpers/web-sources';

/** Funkcje koloru CSS, które Tailwind chętnie przyjmuje wewnątrz `[...]`. */
const COLOR_FUNCTIONS = [
  'oklch',
  'oklab',
  'lab',
  'lch',
  'hwb',
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'color-mix',
  'color-contrast',
  'device-cmyk',
  'light-dark',
];

/** Utility, które niosą kolor i muszą więc użyć wartości dowolnej. */
const COLOR_UTILITIES = [
  'bg',
  'text',
  'border',
  'ring',
  'fill',
  'stroke',
  'shadow',
  'from',
  'via',
  'to',
  'outline',
  'decoration',
  'divide',
  'accent',
  'caret',
  'outline-offset',
];

/**
 * Utility z **niekwotowaną** wartością funkcyjną.
 *
 * Lewa strona to granica klasy, a nie dowolny znak — bez tego
 * `hover:bg-` w środku dłuższego słowa też by pasowało. `[\s"'`:]`
 * to separator, na którym klasa naprawdę może się zaczynać.
 *
 * Po nazwie utility musi być **bezpośrednio** nawias, a nie `[` —
 * właśnie dlatego poprawna postać `bg-[oklch(...)]` się nie trafia.
 */
function malformed(source: string): string[] {
  const pattern = new RegExp(
    `(?:^|[\\s"'\`])((?:[\\w-]+:)*` +
      `(?:${COLOR_UTILITIES.join('|')})-` +
      `(?:${COLOR_FUNCTIONS.join('|')})\\()`,
    'g',
  );

  return [...source.matchAll(pattern)].map((m) => m[1]);
}

const FILES = webSources();

describe('Składnia klas kolorowych w JSX', () => {
  it('test w ogóle widzi pliki interfejsu', () => {
    // Pusta lista przeszłaby każdy przypadek poniżej na próżni —
    // zmiana struktury katalogu po cichu wyłączyłaby kontrakt.
    assert.ok(FILES.length > 20, `znaleziono tylko ${FILES.length} plików`);
  });

  for (const file of FILES) {
    it(`${file}: utility koloru ma wartość w nawiasie kwadratowym`, () => {
      assert.deepEqual(
        malformed(read(...file.split('/'))),
        [],
        'utility koloru z wartością funkcyjną bez nawiasu kwadratowego ' +
          '— Tailwind odrzuca taką klasę po cichu, bez błędu kompilacji. ' +
          'Poprawnie: `bg-[oklch(0.83_0.08_20_/_0.4)]`, spacje jako ' +
          'podkreślenia',
      );
    });
  }
});