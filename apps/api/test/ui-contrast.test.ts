/**
 * Kontrast warstwy kolorów w obu motywach — liczony, nie oceniany na oko.
 *
 * Skąd ten test w `apps/api/test/`, skoro dotyczy frontendu? Z tego samego
 * powodu, co `nginx-config.test.ts`: kontrast to **kontrakt**, a kontrakt ma
 * pilnować test. Gdyby był tylko komentarzem w CSS, pierwsza edycja koloru
 * wygrywałaby z nim cicho — dokładnie tak, jak stało się z odznakami ról,
 * które miały wyłącznie klasy `dark:` i dlatego w trybie jasnym były
 * niewidoczne.
 *
 * Kolory w `index.css` są zapisane w `oklch`, więc liczymy w `oklch`:
 * oklab → liniowy sRGB → luminancja względna → współczynnik WCAG. Wartość
 * `oklch(0.21 0.02 254)` idzie dokładnie tą samą drogą, którą widzi
 * przeglądarka. Test weryfikowany był na `--c-fg` na karcie: wychodzi
 * 17.7:1, a komentarz w `index.css` podaje z ręki „17:1”.
 *
 * Próg to 4.5:1, nie 3:1 — odznaki mają 12 px, czyli „normalny" tekst
 * wg WCAG AA.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { read } from './helpers/repo';

/**
 * `apps/web/src/index.css` czytamy przez wspólny helper, nie przez
 * `new URL(..., import.meta.url)` — `apps/api/tsconfig.json` ma
 * `"module": "commonjs"`, a `import.meta` nie jest w nim dozwolone
 * (TS1343), więc `typecheck:test` padałby i blokował cały `npm test`.
 * Ten sam powód, dla którego pozostałe testy nie używają `import.meta`.
 */
const css = read('apps', 'web', 'src', 'index.css');

/** Kanał liniowego sRGB — kolejność r, g, b. */
type Lin = [number, number, number];

type Tone = { light: Lin; lightText: Lin; dark: Lin; darkText: Lin };

/** oklab → liniowy sRGB (wzory Björna Ottossona). */
function oklabToLinear([L, a, b]: [number, number, number]): Lin {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/**
 * `oklch(L C H)` → liniowy sRGB.
 *
 * W `@apply` wartości są pisane jako wartość dowolna w nawiasie
 * kwadratowym, a spacje wewnątrz niej są podkreśleniami — Tailwind
 * przepisuje je z powrotem na spacje w wynikowym CSS. Ta funkcja
 * przyjmuje oba zapisy, bo tokeny `--c-*` w `:root` są pisane
 * zwykłymi wartościami `oklch(0.21 0.02 254)`, a klasy tonów jako
 * `oklch(0.21_0.02_254)`. Rozdzielenie tych dwóch zapisów w jednej
 * funkcji jest tu celowe — inaczej trzeba by pamiętać, który format
 * dotyczy którego miejsca, a to jest dokładnie ten rodzaj wiedzy,
 * który rozjeżdża się z kodem.
 */
function oklch(source: string): Lin {
  const m = /oklch\(\s*([\d.]+)[\s_]([\d.]+)[\s_]([\d.]+)\s*\)/.exec(source);
  assert.ok(m, `nie rozpoznano wartości oklch: ${source}`);
  const [L, C, H] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const h = (H * Math.PI) / 180;
  return oklabToLinear([L, C * Math.cos(h), C * Math.sin(h)]);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Luminancja względna wg WCAG — na liniowym sRGB, nie na gamma. */
function luminance([r, g, b]: Lin): number {
  return 0.2126 * clamp01(r) + 0.7152 * clamp01(g) + 0.0722 * clamp01(b);
}

/** Współczynnik kontrastu, 1–21. */
function contrast(a: Lin, b: Lin): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Treść deklaracji klasy `.xyz { … }` albo `null`, gdy klasy nie ma. */
function classBody(selector: string): string | null {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return null;
  return css.slice(start, css.indexOf('}', start));
}

/**
 * Lista utility z `@apply`, podzielona po spacjach, **ale z szacowaniem
 * nawiasów**.
 *
 * Bez nawiasów `dark:bg-oklch(0.31 0.075 255)` rozpadłoby się na trzy
 * kawałki i wartość koloru zniknęłaby — a wtedy „tło" w teście byłoby
 * naprawdę kolorem tekstu, a test przechodziłby na przypadek.
 */
function utilities(body: string): string[] {
  const apply = body.indexOf('@apply');
  assert.notEqual(apply, -1, 'brak @apply');

  const list: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of body.slice(apply + '@apply'.length)) {
    if (char === '(') depth++;
    if (char === ')') depth--;

    if (depth === 0 && /\s/.test(char)) {
      if (current) list.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) list.push(current);

  return list;
}

/**
 * Wartości kolorów klasy, rozdzielone na parę właściwość → `oklch`.
 *
 * Klucz to **właściwość**, nie pozycja na liście. Wczytanie „pierwsza
 * wartość to tło, druga to tekst" działa dopóki nikt nie przestawi
 * `ring-*` przed `bg-*` — a wtedy test policzy kontrast obramowania
 * z tekstem i **nadal przejdzie**, mimo że kontrast tekstu na tle nie
 * był sprawdzony wcale. Kluczowanie po właściwości nie ma takiej
 * możliwości: `ring` i `bg` to różne właściwości.
 */
function colorValues(
  list: string[],
): Map<string, string> {
  const found = new Map<string, string>();

  for (const utility of list) {
    // `ring-[oklch(...)]` wnosi dwie właściwości: kolor obramowania i
    // sam `ring`. Dla kontrastu istotna jest ta pierwsza, więc kolor
    // przypisujemy do `ring`, a `--tw-ring-color` do `ring-color`.
    const match = /^(?:dark:)?(bg|text|border|ring)-/.exec(utility);
    if (!match) continue;

    const color = /oklch\([^)]+\)/.exec(utility);
    if (!color) continue;

    found.set(match[1], color[0]);
  }

  return found;
}

/**
 * Czytana klasa stanu: wypełnienie i tekst w obu motywach.
 *
 * Ton brakuje własnych `oklch` (`neutral` idzie po tokenach powierzchni),
 * więc ta funkcja zwraca `null` i niczego nie zgłasza — kontrast neutrala
 * liczą osobne przypadki, które czytają tokeny.
 */
function readTone(selector: string): Tone | null {
  const body = classBody(selector);
  if (!body) return null;

  const list = utilities(body);
  const light = colorValues(list.filter((u) => !u.startsWith('dark:')));
  const dark = colorValues(list.filter((u) => u.startsWith('dark:')));

  const pick = (from: Map<string, string>, property: string, what: string) => {
    const value = from.get(property);
    assert.ok(value, `${selector}: brakuje ${what} (${property})`);
    return oklch(value);
  };

  if (light.size === 0 || dark.size === 0) return null;

  return {
    light: pick(light, 'bg', 'jasnego tła'),
    lightText: pick(light, 'text', 'jasnego tekstu'),
    dark: pick(dark, 'bg', 'ciemnego tła'),
    darkText: pick(dark, 'text', 'ciemnego tekstu'),
  };
}

/** Token `--c-*` z bloku `:root` albo `.dark`. */
function token(name: string, dark: boolean): Lin {
  const block = dark
    ? /\.dark\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    : /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  const line = block
    .split('\n')
    .find((l) => l.trim().startsWith(`--${name}:`));
  assert.ok(
    line,
    `nie znaleziono tokenu --${name} w bloku ${dark ? '.dark' : ':root'}`,
  );
  const [, raw] = line.split('oklch');
  assert.ok(raw, `token --${name} nie ma wartości oklch`);
  return oklch(`oklch${raw}`);
}

/** Powierzchnia, na której leżą odznaki — kolor karty w obu motywach. */
const CARD = { light: token('c-surface', false), dark: token('c-surface', true) };

/**
 * Tony z własnym odcieniem.
 *
 * `neutral` jest tu celowo nieobecny: niczego nie barwi, tylko odsuwa się od
 * tła, więc opisany jest tokenami powierzchni. Jego kontrast to dosłownie
 * kontrast `--c-fg` na `--c-surface-2` — pilnują tego dwa przypadki niżej.
 * Nie chcemy drugiego źródła prawdy, które potrafiłoby się rozjechać
 * z tokenem.
 */
const CHROMATIC = ['info', 'violet', 'ok', 'warn', 'danger'] as const;
const ALERTS = ['danger', 'warn', 'ok'] as const;
const ALL_TONES = [...CHROMATIC, 'neutral'] as const;

describe('Tony stanów — kontrast', () => {
  for (const tone of CHROMATIC) {
    it(`.tone-${tone} czytelny w obu motywach`, () => {
      const t = readTone(`.tone-${tone}`);
      assert.ok(t, `brak klasy .tone-${tone} w index.css`);

      const light = contrast(t.lightText, t.light);
      const dark = contrast(t.darkText, t.dark);

      assert.ok(
        light >= 4.5,
        `.tone-${tone} w trybie jasnym: ${light.toFixed(2)}:1 — potrzeba 4.5:1`,
      );
      assert.ok(
        dark >= 4.5,
        `.tone-${tone} w trybie ciemnym: ${dark.toFixed(2)}:1 — potrzeba 4.5:1`,
      );
    });
  }

  for (const tone of CHROMATIC) {
    it(`.tone-${tone} odcina się od karty`, () => {
      // Odznaka, która wygląda jak tło pod spodem, nie jest odznaką.
      // `neutral` jest tu celowo pominięte: z natury ma się cofać, a
      // granicę niesie obramowanie — ma własny blok przypadków niżej,
      // liczony z tokenów powierzchni. Wpisanie go tutaj z `return`
      // dawałoby przypadek testowy, który niczego nie robił, a
      // raportował się jako spełniony.
      const t = readTone(`.tone-${tone}`) as Tone;
      for (const [mode, fill, card] of [
        ['jasnym', t.light, CARD.light],
        ['ciemnym', t.dark, CARD.dark],
      ] as const) {
        const delta = contrast(fill, card);
        assert.ok(
          delta >= 1.2,
          `.tone-${tone} w trybie ${mode} zlewa się z kartą (${delta.toFixed(2)}:1)`,
        );
      }
    });
  }

  for (const tone of ALL_TONES) {
    it(`.tone-${tone}: ma oba warianty tej samej właściwości`, () => {
      // Test zastępuje wcześniejsze sprawdzanie kolejności `dark:` przed
      // resztą, które **nigdy nie mogło paść**: wariant `dark:` kompiluje
      // się do osobnego selektora `.x:where(.dark, .dark *)`, stojącego
      // w arkuszu za właściwością bez prefiksu niezależnie od kolejności
      // w `@apply`. Sprawdzone na obu kolejnościach — CSS identyczny.
      //
      // To, co **ma** znaczenie, to kompletność pary: `dark:bg-*` bez
      // `bg-*` znaczy „w trybie jasnym brak tła”, czyli dokładnie ten
      // błąd, który miały odznaki ról `SUPER_ADMIN`/`ADMIN`.
      const body = classBody(`.tone-${tone}`) ?? '';
      assert.notEqual(body, '', `brak klasy .tone-${tone}`);

      const list = utilities(body);
      const light = colorValues(list.filter((u) => !u.startsWith('dark:')));
      const dark = colorValues(list.filter((u) => u.startsWith('dark:')));

      const props = new Set([...light.keys(), ...dark.keys()]);
      const onlyLight = [...props].filter((p) => !dark.has(p));
      const onlyDark = [...props].filter((p) => !light.has(p));

      assert.deepEqual(
        [...onlyLight, ...onlyDark],
        [],
        'właściwość ustawiona tylko w jednym motywie — ' +
          'w drugim odznaka albo baner renderuje się bez niej',
      );
    });
  }
});

describe('Neutral — kontrast policzony z tokenów', () => {
  it('ton neutral idzie po tokenach powierzchni, nie po własnych oklch', () => {
    // Własne oklch przestałoby reagować na zmianę `--c-surface-2`
    // i rozjechałoby się z resztą interfejsu.
    const body = classBody('.tone-neutral') ?? '';
    assert.ok(body !== '', 'brak klasy .tone-neutral');
    assert.equal(
      /oklch\(/.test(body),
      false,
      '.tone-neutral musi używać tokenów powierzchni, nie własnych oklch',
    );
    assert.match(body, /bg-surface-2/, 'brak jasnego tła na --c-surface-2');
    assert.match(body, /dark:bg-surface-3/, 'brak ciemnego tła na --c-surface-3');
  });

  it('jasny: fg na surface-2', () => {
    const ratio = contrast(token('c-fg', false), token('c-surface-2', false));
    assert.ok(ratio >= 4.5, `fg na surface-2: ${ratio.toFixed(2)}:1`);
  });

  it('ciemny: fg-muted na surface-3', () => {
    const ratio = contrast(
      token('c-fg-muted', true),
      token('c-surface-3', true),
    );
    assert.ok(ratio >= 4.5, `fg-muted na surface-3: ${ratio.toFixed(2)}:1`);
  });

  it('ton neutral odcina się od karty', () => {
    // Tu sprawdzamy samą różnicę tła: neutral ma się cofać, ale nie znikać.
    const light = contrast(token('c-surface-2', false), CARD.light);
    const dark = contrast(token('c-surface-3', true), CARD.dark);
    assert.ok(light >= 1.09, `surface-2 vs karta: ${light.toFixed(3)}:1`);
    assert.ok(dark >= 1.18, `surface-3 vs karta: ${dark.toFixed(2)}:1`);
  });

  it('tło strony (--c-page) wyraźnie odcina się od karty (--c-surface)', () => {
    const light = contrast(token('c-page', false), CARD.light);
    const dark = contrast(token('c-page', true), CARD.dark);
    assert.ok(light >= 1.07, `page vs karta (jasny): ${light.toFixed(3)}:1`);
    assert.ok(dark >= 1.15, `page vs karta (ciemny): ${dark.toFixed(2)}:1`);
  });
});

describe('Banery komunikatów — kontrast', () => {
  for (const tone of ALERTS) {
    it(`.alert-${tone} czytelny w obu motywach`, () => {
      const t = readTone(`.alert-${tone}`);
      assert.ok(t, `brak klasy .alert-${tone} w index.css`);
      const light = contrast(t.lightText, t.light);
      const dark = contrast(t.darkText, t.dark);
      assert.ok(light >= 4.5, `.alert-${tone} jasny: ${light.toFixed(2)}:1`);
      assert.ok(dark >= 4.5, `.alert-${tone} ciemny: ${dark.toFixed(2)}:1`);
    });
  }
});

describe('Nawigacja — pozycja aktywna', () => {
  // Długość gradientu w nagłówku była powodem, dla którego `.nav-item-active`
  // w ogóle nie istniało: jasny motyw dostawał `from-brand-50 to-accent-50`,
  // a ciemny `dark:from-brand-500/15 dark:to-accent-500/15` — dwa różne
  // mechanizmy w jednym miejscu, czyli żadnego kontraktu, który da się policzyć.
  // Teraz aktywna pozycja jest klasą z jedną parą kolorów na motyw.
  it('.nav-item-active ma jawną parę kolorów na oba motywy', () => {
    const t = readTone('.nav-item-active');
    assert.ok(t, 'brak klasy .nav-item-active w index.css');

    for (const [mode, ratio] of [
      ['jasnym', contrast(t.lightText, t.light)],
      ['ciemnym', contrast(t.darkText, t.dark)],
    ] as const) {
      assert.ok(
        ratio >= 4.5,
        `.nav-item-active w trybie ${mode}: ${ratio.toFixed(2)}:1 — potrzeba 4.5:1`,
      );
    }
  });

  it('.nav-item-active odcina się od tła, na którym leży', () => {
    // Nagłówek nawigacji ma `bg-surface`, więc to jest realne tło pod
    // pozycją. Aktywna pozycja, która zlewa się z paskiem, nie jest aktywna.
    const t = readTone('.nav-item-active') as Tone;
    for (const [mode, fill, surface] of [
      ['jasnym', t.light, token('c-surface', false)],
      ['ciemnym', t.dark, token('c-surface', true)],
    ] as const) {
      const delta = contrast(fill, surface);
      assert.ok(
        delta >= 1.15,
        `.nav-item-active w trybie ${mode} zlewa się z paskiem (${delta.toFixed(2)}:1)`,
      );
    }
  });

  it('.nav-item-active: ma oba warianty tła i tekstu', () => {
    // Zamiast kolejności w `@apply` (która w kaskadzie nic nie robi —
    // patrz komentarz wyżej) pilnujemy tego, co ma znaczenie: żadna
    // właściwość nie występuje tylko w jednym motywie.
    const body = classBody('.nav-item-active') ?? '';
    assert.notEqual(body, '', 'brak klasy .nav-item-active');

    const list = utilities(body);
    const light = colorValues(list.filter((u) => !u.startsWith('dark:')));
    const dark = colorValues(list.filter((u) => u.startsWith('dark:')));

    assert.ok(light.has('bg') && light.has('text'), 'brak jasnego tła albo tekstu');
    assert.ok(dark.has('bg') && dark.has('text'), 'brak ciemnego tła albo tekstu');
  });
});

describe('Zakładki — pozycja aktywna', () => {
  /**
   * Klasa `.tab-active` — stan wybranej zakładki na stronie „Uprawnienia".
   *
   * Osobny przypadek obok nawigacji, nie część `describe` o `.nav-item-active`:
   * pozycja w pasku leży na `bg-surface`, a zakładka na `bg-page`, więc ten sam
   * próg „odcina się od podłoża" dawałby tu inny wynik niż tam.
   */
  function tab(): Tone {
    const t = readTone('.tab-active');
    assert.ok(t, 'brak klasy .tab-active w index.css');
    return t;
  }

  it('.tab-active ma jawną parę kolorów na oba motywy', () => {
    const t = tab();
    for (const [mode, ratio] of [
      ['jasnym', contrast(t.lightText, t.light)],
      ['ciemnym', contrast(t.darkText, t.dark)],
    ] as const) {
      assert.ok(
        ratio >= 4.5,
        `.tab-active w trybie ${mode}: ${ratio.toFixed(2)}:1 — potrzeba 4.5:1`,
      );
    }
  });

  it('.tab-active: ma oba warianty tła, tekstu i obramowania', () => {
    const body = classBody('.tab-active') ?? '';
    assert.notEqual(body, '', 'brak klasy .tab-active');

    const list = utilities(body);
    const light = colorValues(list.filter((u) => !u.startsWith('dark:')));
    const dark = colorValues(list.filter((u) => u.startsWith('dark:')));

    for (const property of ['bg', 'text', 'ring']) {
      assert.ok(light.has(property), `brak jasnego ${property}`);
      assert.ok(dark.has(property), `brak ciemnego ${property}`);
    }
  });

  it('.tab-active ma krawędź czytelną na tle strony', () => {
    // W trybie jasnym wypełnienie od `--c-page` odróżnia się słabo
    // (1.02:1) i to świadome: granicę niesie `ring`, a akcentem jest tekst.
    // Bez tego przypadku granica zniknęłaby razem z obramowaniem i nikt
    // nie zauważyłby, że zakładka przestała się odcinać od strony.
    const list = utilities(classBody('.tab-active') ?? '');
    for (const [mode, dark] of [
      ['jasnym', false],
      ['ciemnym', true],
    ] as const) {
      const found = colorValues(list.filter((u) => u.startsWith('dark:') === dark));
      const ring = found.get('ring');
      assert.ok(ring, `brak obramowania w trybie ${mode}`);

      const ratio = contrast(oklch(ring), token('c-page', dark));
      assert.ok(
        ratio >= 1.3,
        `.tab-active: krawędź vs --c-page w trybie ${mode}: ` +
          `${ratio.toFixed(2)}:1 — zakładka zlewa się ze stroną`,
      );
    }
  });

  it('.tab-active różni się od nieaktywnego kafelka', () => {
    // Nieaktywna zakładka to `bg-surface` (`--c-surface`). Aktywna ma swój
    // odcień, bo inaczej stan wybrania zniknąłby — a wrócenie do `bg-surface`
    // przeszłoby po cichu.
    // W trybie jasnym granicę niesie `ring`, a akcentem jest tekst, więc
    // wypełnienie jestblade — ale nie na tyle, żeby zakładka przestała się
    // różnić od nieaktywnej.
    const t = tab();
    for (const [mode, fill, inactive] of [
      ['jasnym', t.light, token('c-surface', false)],
      ['ciemnym', t.dark, token('c-surface', true)],
    ] as const) {
      const delta = contrast(fill, inactive);
      assert.ok(
        delta >= 1.15,
        `.tab-active vs nieaktywna zakładka w trybie ${mode}: ` +
          `${delta.toFixed(2)}:1 — zakładki wyglądają identycznie`,
      );
    }
  });
});

describe('Tokeny tekstu — kontrast na karcie', () => {
  for (const name of ['c-fg', 'c-fg-muted', 'c-fg-subtle']) {
    it(`--${name} czytelny na karcie w obu motywach`, () => {
      const light = contrast(token(name, false), CARD.light);
      const dark = contrast(token(name, true), CARD.dark);
      assert.ok(light >= 4.5, `--${name} jasny: ${light.toFixed(2)}:1`);
      assert.ok(dark >= 4.5, `--${name} ciemny: ${dark.toFixed(2)}:1`);
    });
  }
});

describe('Gradient tła strony — kontrast', () => {
  /**
   * Surowa wartość tokenu, bez parsowania na `oklch`.
   *
   * Osobna funkcja, bo `token()` czyta pojedynczą linię, a gradient
   * jest wielolinijkowy — to druga linia `--c-page-gradient` nigdy by
   * nie trafiła do wyniku.
   */
  function raw(name: string, dark: boolean): string {
    const block = dark
      ? /\.dark\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
      : /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    const start = block.indexOf(`--${name}:`);
    assert.notEqual(
      start,
      -1,
      `nie znaleziono tokenu --${name} w bloku ${dark ? '.dark' : ':root'}`,
    );
    return block.slice(start + name.length + 3, block.indexOf(';', start));
  }

  /**
   * Kolory, przez które przechodzi gradient tła strony.
   *
   * Tylko jaśniejsze w obu motywach: w jasnym plama jest ciemniejsza od
   * `--c-page`, w ciemnym jaśniejsza. Kontrast jest monotoniczny względem
   * jasności, więc najgorszy przypadek to zawsze plama, a nie bazowe
   * tło — wystarczy policzyć plamy.
   *
   * `var(--c-page)` na końcu gradientu nie jest łapane i nie musi być:
   * to dosłownie kolor bazowy, liczony osobno niżej.
   */
  function glows(dark: boolean): string[] {
    const stops = [...raw('c-page-gradient', dark).matchAll(/oklch\([^)]*\)/g)];
    assert.ok(
      stops.length > 0,
      `--c-page-gradient (${dark ? 'ciemny' : 'jasny'}) nie zawiera żadnej ` +
        'wartości oklch — gradient nie ma czym malować tła',
    );
    return stops.map((m) => m[0]);
  }

  for (const [label, dark] of [
    ['jasnym', false],
    ['ciemnym', true],
  ] as const) {
    it(`tło strony w trybie ${label} trzyma tekst czytelny`, () => {
      // Najgorszy przypadek to plama, nie bazowe `--c-page`: w trybie
      // jasnym plama jest ciemniejsza, w ciemnym jaśniejsza, a kontrast
      // jest monotoniczny względem jasności. Bazowe tło dochodzi do
      // gradientu jako ostatni stopień, więc liczymy je dla porządku.
      const fills = [
        ...glows(dark).map((value) => ({ label: `plama ${value}`, lin: oklch(value) })),
        { label: 'bazowe --c-page', lin: token('c-page', dark) },
      ];

      for (const fg of ['c-fg', 'c-fg-muted']) {
        const text = token(fg, dark);
        for (const fill of fills) {
          const ratio = contrast(text, fill.lin);

          assert.ok(
            ratio >= 4.5,
            `--${fg} na ${fill.label} w trybie ${label}: ` +
              `${ratio.toFixed(2)}:1 — plama nie może zejść poniżej progu ` +
              'dla tekstu 12–14 px',
          );
        }
      }
    });

    it(`gradient tła w trybie ${label} ma 3 widoczne plamy (przezroczyste wygaszanie warstw)`, () => {
      const value = raw('c-page-gradient', dark);
      const stops = glows(dark);
      assert.equal(
        stops.length,
        3,
        `oczekiwano 3 plam w --c-page-gradient (${label}), znaleziono ${stops.length}`,
      );
      assert.equal(
        value.includes('var(--c-page)'),
        false,
        `--c-page-gradient (${label}) nie może kończyć warstw nieprzezroczystym var(--c-page), bo górna warstwa przykrywa pozostałe plamy`,
      );
    });
  }
});

describe('Kolory palet Tailwinda używane jako tekst', () => {
  /**
   * Odcienie palet używane jako tekst w miejscach o rozmiarze „normalnym"
   * (12–14 px), gdzie obowiązuje próg 4.5:1.
   *
   * `text-amber-600` na białej karcie daje 3.19:1 — poniżej progu. Ten
   * odcień **jest** w interfejsie, ale tylko na liczbie 24 px w
   * `StatTile`, gdzie obowiązuje próg 3:1 dla dużego tekstu. Dla 12 px
   * wybrano `text-amber-800` (7.13:1) i `dark:text-amber-300` (12.11:1).
   *
   * Nie ma sensu przenosić całej palety do `index.css` — to kolory
   * marki, nie stany. Sens ma zliczenie tego, co faktycznie służy do
   * małego tekstu.
   */
  const SMALL_TEXT_ON_CARD = [
    {
      name: 'text-amber-800 / dark:text-amber-300',
      light: 'oklch(0.473 0.137 46.201)',
      dark: 'oklch(0.879 0.169 91.605)',
    },
  ];

  for (const { name, light: l, dark: d } of SMALL_TEXT_ON_CARD) {
    it(`${name} czytelny na karcie w obu motywach`, () => {
      const light = contrast(oklch(l), CARD.light);
      const dark = contrast(oklch(d), CARD.dark);

      assert.ok(
        light >= 4.5,
        `${name} w trybie jasnym: ${light.toFixed(2)}:1 na karcie — ` +
          'potrzeba 4.5:1 (tekst 12–14 px to "normalny" tekst wg WCAG AA)',
      );
      assert.ok(
        dark >= 4.5,
        `${name} w trybie ciemnym: ${dark.toFixed(2)}:1 na karcie — potrzeba 4.5:1`,
      );
    });
  }

  it('amber-600 jest dopuszczalny tylko jako duży tekst', () => {
    // Liczba w `StatTile` ma 24 px, więc 3:1 wystarcza. Ten przypadek
    // istnieje po to, żeby zmiana rozmiaru z 24 px na mniejszy nie
    // przeszła po cichu — i żeby ktoś nie „poprawił" `StatTile` na
    // `text-amber-800` bez powodu, skoro 3.1:1 tam wystarcza.
    const ratio = contrast(oklch('oklch(0.666 0.179 58.318)'), CARD.light);

    assert.ok(
      ratio >= 3 && ratio < 4.5,
      `amber-600 na karcie: ${ratio.toFixed(2)}:1 — zmienił się próg ` +
        'albo odcień; dla dużego tekstu 3:1 wystarcza, dla małego ' +
        'trzeba ciemniejszego',
    );
  });
});
