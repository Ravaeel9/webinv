/**
 * Zbudowany CSS zawiera klasy, które są w `index.css`.
 *
 * Dwie klasy zniknęły z `dist/` podczas gdy `npm test` był zielony, bo
 * `index.css` kompilują dwie różne biblioteki, a druga potrafi zgubić
 * regułę po cichu:
 *
 *  1. **Tailwind 4.3.3 nie przyjmuje `oklch(...)` ze spacjami w
 *     `@apply`.** Parser dzieli listę utility po spacjach bez szacowania
 *     nawiasów, więc `bg-oklch(0.915 0.04 255)` rozpada się na trzy
 *     kawałki i kompilacja rzuca `Cannot apply unknown utility class`.
 *     Poprawna postać to wartość dowolna w nawiasie kwadratowym ze
 *     spacjami jako podkreśleniami: `bg-[oklch(0.915_0.04_255)]`.
 *
 *  2. **LightningCSS gubi reguły, gdy komentarz zawiera w treści
 *     sekwencję dwóch gwiazdek i ukośnika** — czyli zapis, który dla
 *     CSS-owego parsera znaczy "koniec komentarza". Wystarczy wpleść
 *     go w nazwę klasy wplecioną w zdanie i LightningCSS kończy na
 *     nim komentarz, a resztę linii (gwiazdki po zamknięciu)
 *     traktuje jako selector. Błąd jest cichy: brak komunikatu, tylko
 *     brakujące klasy w wynikowym pliku. Klasy po takim miejscu
 *     znikają — `.tone-neutral` i `.nav-item-active` renderowałyby się
 *     bez tła i bez obramowania.
 *
 *     Ten plik sam był przez chwilę ofiarą tej samej pułapki: opisywał
 *     ją dosłownie, w swoim własnym komentarzu, i sam przestał się
 *     parsować. Dlatego poniżej nie ma żadnego dosłownego zapisu.
 *
 * `ui-css-builds.test.ts` pilnuje punktu 1. Ten pilnuje obu, ale
 * sprawdzając **wynik**, nie wejście — bo to wynik jest tym, co widzi
 * użytkownik.
 */
import { strict as assert } from 'node:assert';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { REPO_ROOT, read } from './helpers/repo';

const CSS = read('apps', 'web', 'src', 'index.css');
const DIST = join(REPO_ROOT, 'apps', 'web', 'dist', 'assets');

/**
 * Klasy, które musi zawierać wynikowy CSS.
 *
 * Wszystkie są klasami `@layer components`. Nie ma tu niczego, co nie
 * ma konsumenta w JSX — `tone-neutral` i `nav-item-active` są dokładnie
 * tymi, które zniknęły.
 */
const REQUIRED = [
  'tone-neutral',
  'tone-info',
  'tone-violet',
  'tone-ok',
  'tone-warn',
  'tone-danger',
  'nav-item-active',
  'alert',
  'alert-danger',
  'alert-warn',
  'alert-ok',
];

/** Zbudowany arkusz, albo `null` gdy `dist/` nie istnieje. */
function built(): string | null {
  if (!existsSync(DIST)) return null;
  const files = readdirSync(DIST).filter((f) => f.endsWith('.css'));
  if (files.length === 0) return null;
  return files.map((f) => read('apps', 'web', 'dist', 'assets', f)).join('\n');
}

describe('Komentarze w index.css', () => {
  it('w treści komentarza nie ma sekwencji zamykającej komentarz', () => {
    // Sekwencja dwóch gwiazdek i ukośnika w treści komentarza kończy go
    // dla CSS-owego parsera (LightningCSS), mimo że dla człowieka
    // wygląda na część zdania. Wpleciona w nazwę klasy z
    // przezroczystością, zabija wszystkie reguły za sobą — bez błędu
    // na ekranie.
    //
    // Stan trzeba śledzić **między liniami**: `*/` w linii kontynuacji
    // multiliniowego komentarza nie ma pary `/*` w tej samej linii, więc
    // analiza każdej linii osobno zgłaszałaby każdy zamknięty komentarz
    // jako defekt.
    const OPEN = '/*';
    const CLOSE = '*/';

    const bad: string[] = [];
    let inside = false;

    for (const [index, line] of CSS.split('\n').entries()) {
      let at = 0;

      while (at < line.length) {
        const open = line.indexOf(OPEN, at);
        const close = line.indexOf(CLOSE, at);

        // Normalne zamknięcie komentarza nie jest defektem. Defektem
        // jest zamknięcie, **po którym zostaje tekst na tej samej
        // linii** — to on zostanie przez LightningCSS zinterpretowany
        // jako selector. Sprawdzamy więc, co jest za zamknięciem, a nie
        // samo zamknięcie.
        if (inside && close !== -1 && (open === -1 || close < open)) {
          const rest = line.slice(close + CLOSE.length).trim();
          if (rest !== '') {
            bad.push(
              `${index + 1}: po zamknięciu komentarza zostaje "${rest.slice(0, 30)}" — ` +
                'LightningCSS uzna to za selector',
            );
          }
          inside = false;
          at = close + CLOSE.length;
          continue;
        }

        if (open !== -1) {
          inside = true;
          at = open + OPEN.length;
          continue;
        }

        break;
      }
    }

    assert.deepEqual(
      bad,
      [],
      'w treści komentarza jest sekwencja zamykająca — dla CSS-owego ' +
        'parsera kończy komentarz, a wszystko po niej jest selektorem; ' +
        'zapisz ją bez dwóch gwiazdek i ukośnika',
    );
  });
});

describe('Zbudowany CSS', () => {
  it('dist/ istnieje — albo test mówi wprost, że trzeba zbudować', () => {
    assert.notEqual(
      built(),
      null,
      'brak apps/web/dist/assets — uruchom `npm run build --workspace @webinv/web`',
    );
  });

  it('zawiera każdą klasę warstwy stanów', () => {
    const css = built() as string;
    const missing = REQUIRED.filter((name) => !css.includes(`.${name}`));

    assert.deepEqual(
      missing,
      [],
      'klasy z `index.css`, których nie ma w zbudowanym CSS — ' +
        'renderują się bez tła. Najczęstsza przyczyna: `*/` w komentarzu ' +
        '(LightningCSS gubi reguły po nim) albo `oklch(...)` ze spacjami ' +
        'w `@apply` (Tailwind tego nie parsuje).',
    );
  });

  it('każda klasa z @layer components trafiła do builda', () => {
    // To samo, co wyżej, ale dla **każdej** klasy, nie dla ręcznie
    // wypisanej listy. Lista ręczna zgasła przy pierwszym nowym tonie;
    // skanowanie `index.css` nie.
    const css = built() as string;
    const start = CSS.indexOf('@layer components');
    assert.notEqual(start, -1, 'brak @layer components w index.css');

    // Koniec warstwy: nawias klamrowy wraca do zera.
    let depth = 0;
    let end = -1;
    for (let i = start; i < CSS.length; i++) {
      if (CSS[i] === '{') depth++;
      else if (CSS[i] === '}' && --depth === 0) {
        end = i;
        break;
      }
    }
    assert.notEqual(end, -1, 'niezamknięta @layer components');

    const body = CSS.slice(start, end);
    const declared = [...body.matchAll(/^\s*\.([a-zA-Z][\w-]*)/gm)].map((m) => m[1]);
    const missing = [...new Set(declared)].filter((name) => !css.includes(`.${name}`));

    assert.deepEqual(
      missing,
      [],
      'klasy zadeklarowane w `@layer components`, których nie ma w buildzie',
    );
  });
});