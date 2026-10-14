/**
 * Klasa stanu bez wariantu ciemnego — ta sama wada, inny test.
 *
 * `ui-contrast.test.ts` liczy kontrast klas, które już istnieją, i pilnuje
 * ich progu. Ten test pilnuje **kompletności pary**: `bg-amber-500/10`
 * bez `dark:bg-amber-500/15` wygląda poprawnie w kodzie i w jasnym motywie,
 * a w ciemnym zostaje płaska plama bez czytelnego tekstu.
 *
 * Dokładnie tak stało się z odznakami ról `SUPER_ADMIN`/`ADMIN` na stronie
 * użytkowników: `SUPER_ADMIN` miał wyłącznie klasy `dark:`, więc w trybie
 * jasnym renderował się bez tła. Oba warianty tej samej wady są więc
 * sprawdzane: brak jasnego i brak ciemnego.
 *
 * Nie wszystkie kolory są stanami. Gradient logo (`from-brand-600
 * to-accent-600`), plama tła na logowaniu i pasek postępu niosą
 * dekorację, nie znaczenie — wyjątki są nazwane po swoim pliku, bo
 * lista ma się dać przeczytać.
 *
 * Palety `rose` (błędy walidacji) i `brand` (linki, akcenty) są poza
 * zakresem tego testu: `.input-error`, `.error-text` i klasy linków mają
 * kontrast w tokenach, a odmienianie ich wszystkich po paletach
 * nie jest tym, co ten test ma pilnować.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { read } from './helpers/repo';
import { webSources } from './helpers/web-sources';

/**
 * Palety, których odcień sam w sobie niesie znaczenie.
 *
 * `accent` to projektowa paleta sukcesu z `index.css` — jej pominięcie
 * było błędem: `dark:text-emerald-200` sparowane z jasnym tłem (błąd #2
 * w specyfikacji) przeszłoby wtedy bez alarmu, a to właśnie ten
 * przypadek, dla którego ten test powstał.
 *
 * `brand` (granatowy) i `rose` (błędy) są poza zakresem: `brand` niesie
 * markę, a `rose` ma kontrakt w `.input-error` i `.error-text`. Klasa
 * `brand` z jednym wariantem na kolor jest tu jedynym ryzykiem — pilnuje
 * tego osobno `ui-css-output.test.ts` po stronie zbudowanego CSS.
 */
const STATE_PALETTES = [
  'accent',
  'amber',
  'emerald',
  'violet',
  'slate',
  'sky',
  'orange',
];

type Occurrence = { className: string; slot: string; level: string };

/**
 * Klasy stanu w jednym atrybucie `className`, z poziomem wariantu.
 *
 * `className="bg-amber-500/10 text-amber-900 dark:text-amber-200"` daje
 * trzy trafienia i każde z nich wie, czy jest w `dark:`.
 *
 * `slot` to **para właściwość + paleta**, nie pełna nazwa klasy:
 * jasny motyw ma `bg-amber-100`, ciemny `bg-amber-500/15` i to jest
 * poprawna para — inny odcień w innym motywie to nie brak wariantu.
 * Porównywanie pełnych nazw wykrywałoby fałszywe alarmy na każdej
 * klasie, która ma parę, i uczyłoby czytelnika ignorować test.
 */
function stateClasses(value: string): Occurrence[] {
  const found: Occurrence[] = [];

  // Przecinek zostawiam w separatorze: w `[...].join(' ')` klasy bywają
  // zapisane z przecinkiem na końcu, a `text-amber-400',` nie jest klasą.
  for (const className of value.split(/[\s'",]+/).filter(Boolean)) {
    const m = /^(dark:)?(bg|text|border|ring)-([a-z]+)-\d{2,3}/.exec(className);
    if (!m) continue;

    const palette = STATE_PALETTES.includes(m[3]) ? m[3] : null;
    if (!palette) continue;

    found.push({
      className,
      slot: `${m[2]} ${palette}`,
      level: m[1] ? 'dark' : 'light',
    });
  }

  return found;
}

/**
 * Wyjątki: plik → klasy, które są dekoracją, a nie stanem.
 *
 * `bg-accent-500` w `DashboardPage` to pasek postępu pod rozkładem
 * statusów: PROD dostaje zielony, reszta granatowy. Pasek jest
 * celowo jednokolorowy — zmiana odcienia zależałaby od motywu, a nie
 * od danych, więc ten sam wykres wyglądałby inaczej w zależności od
 * tego, kto włączył ciemny motyw. Odcień niesie informację
 * („to jest PROD"), a nie stan interfejsu wymagający pary motywów,
 * dlatego wyjątek.
 *
 * `bg-accent-500/10 text-accent-600` w `StatTile` to tło ikony obok
 * liczby. Liczba niesie stan (`text-amber-600` na wierszu poniżej), a
 * ikona go powtarza — jest `aria-hidden="true"` i sama w sobie nic nie
 * komunikuje. Oba warianty są wypisane jawnie, więc test kompletności
 * pary je i tak widzi.
 *
 * Wyjątek musi **naprawdę istnieć**: `decorativeFor()` porównuje
 * nazwę klasy dokładnie, a `stateClasses()` odrzuca klasy spoza
 * `STATE_PALETTES`. Wyjątek dla klasy, której test nie zgłasza,
 * byłby martwy — dlatego `it('lista wyjątków nie zawiera klas...')`
 * niżej sprawdza, że każda klasa z wyjątku jest realnie w pliku
 * **i** jest widoczna dla `stateClasses()`.
 */
const DECORATIVE = new Map<string, readonly string[]>([
  // Wyjątek dotyczy wyłącznie paska postępu pod rozkładem statusów
  // (PROD dostaje zielony, reszta granatowy — kolor niesie znaczenie
  // danych, nie stan wymagający pary motywów). Ikony w `StatCard`
  // korzystają teraz z `.section-icon` + `.tone-*`.
  ['apps/web/src/pages/DashboardPage.tsx', [
    'bg-accent-500',
  ]],
]);

function decorativeFor(file: string, className: string): boolean {
  return (DECORATIVE.get(file) ?? []).includes(className);
}

/**
 * Wszystkie wartości `className` w pliku.
 *
 * Obsługiwane postacie — i każda z nich była w tym repo, więc każda
 * musi być widziana:
 *
 *   `className="…"`                       literał
 *   `` className={`…`} ``                 szablon
 *   `className={[…].join(' ')}`           tablica join
 *   `className={cond ? '…' : '…'}`        warunek — m.in. aktywna
 *                                         pozycja nawigacji, czyli
 *                                         dokładnie naprawa #7
 *                                         ze specyfikacji
 *   `className={({ isActive }) => …}`     callback (NavLink)
 *
 * Podejście zagnieżdżone: po `className={`` zbieramy treść do
 * pasującego nawiasu klamrowego, a wewnątrz niej wszystkie
 * cudzysłowy i backticki traktujemy jako kandydatów. Dzięki temu
 * nie musimy znać składni JS — każda postać wygląda tak samo.
 */
function classNameValues(source: string): string[] {
  const values: string[] = [];
  const OPEN = 'className={';

  let at = source.indexOf(OPEN);
  while (at !== -1) {
    const start = at + OPEN.length;
    let depth = 1;
    let i = start;

    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      if (depth > 0) i++;
    }

    const body = source.slice(start, i);

    // Literały wewnątrz wyrażenia: każdy cudzysłów i każdy backtick.
    for (const m of body.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      values.push(m[2]);
    }

    at = source.indexOf(OPEN, i);
  }

  // Interpolacja: `className={`… ${iconTone}`}` wstawia do wyglądu
  // wartość zmiennej, nie literał. `iconTone` w `DashboardPage` jest
  // tak właśnie zbudowany — cztery warianty koloru w jednej stałej,
  // wybierane warunkiem. Klasy są wtedy poza `className`, więc sam
  // skan `className` ich nie widzi, a one i tak trafiają do HTML.
  //
  // Nie śledzimy przepływu danych — to już byłby parser JS. Bieremy
  // wszystkie literały w pliku, które wyglądają jak klasa Tailwinda.
  // Nadmiar jest tu bezpieczny: nadmiar oznacza fałszywy alarm, który
  // da się zobaczyć i zignorować, brak oznacza przeoczony defekt,
  // którego nie da się zobaczyć wcale.
  const STRAY = /['"`]((?:dark:)?(?:bg|text|border|ring)-[a-z]+-\d{2,3}[^'"`\\]*)['"`]/g;
  for (const m of source.matchAll(STRAY)) {
    values.push(m[1]);
  }

  return values;
}

/** Wszystkie pliki źródłowe interfejsu, rekurencyjnie. */
const FILES = webSources();

describe('Kolory stanów w JSX — para jasna i ciemna', () => {
  it('test w ogóle widzi pliki interfejsu', () => {
    // Pusta lista plików przepuściłaby każdy przypadek poniżej na
    // próżni — zmiana struktury katalogu po cichu wyłączyłaby kontrakt.
    assert.ok(FILES.length > 20, `znaleziono tylko ${FILES.length} plików`);
  });

  for (const relative of FILES) {
    it(`${relative}: właściwość stanu ma oba warianty`, () => {
      const source = read(...relative.split('/'));

      const light = new Set<string>();
      const dark = new Set<string>();

      for (const value of classNameValues(source)) {
        for (const hit of stateClasses(value)) {
          if (decorativeFor(relative, hit.className)) continue;
          if (hit.level === 'dark') dark.add(hit.slot);
          else light.add(hit.slot);
        }
      }

      const onlyLight = [...light].filter((key) => !dark.has(key));
      const onlyDark = [...dark].filter((key) => !light.has(key));

      assert.deepEqual(
        [...onlyLight, ...onlyDark],
        [],
        'właściwość użyta w jednym motywie bez drugiego — ' +
          'użyj `.tone-*` (odznaka), `.alert-*` (baner) albo klasy ' +
          'semantycznej z parą w `index.css`',
      );
    });
  }

  it('każdy wyjątek jest realnie widziany przez stateClasses()', () => {
    // Wyjątek może umrzeć na dwa sposoby, oba ciche:
    //
    //  1. klasa znika z pliku — `source.includes()` to zauważy,
    //  2. klasa przestaje być trafieniem, bo `STATE_PALETTES` nie zawiera
    //     jej palety albo zmienił się format zapisu — wtedy wyjątek
    //     niczego nie wyłącza, a test udaje, że wyłącza.
    //
    // Ten przypadek był w repo: wyjątki dotyczyły palety `accent`, której
    // w `STATE_PALETTES` nie było, więc nigdy nie zadziałały. Sam test
    // był zielony i potwierdzał kontrakt, którego nie pilnował.
    const dead: string[] = [];

    for (const [file, classes] of DECORATIVE) {
      const source = read(...file.split('/'));
      const seen = classNameValues(source).flatMap((v) =>
        stateClasses(v).map((hit) => hit.className),
      );

      for (const className of classes) {
        if (!seen.includes(className)) dead.push(`${file}: ${className}`);
      }
    }

    assert.deepEqual(
      dead,
      [],
      'wyjątki, na które stateClasses() nie patrzy — są martwe, ' +
        'bo niczego nie wyłączają',
    );
  });
});