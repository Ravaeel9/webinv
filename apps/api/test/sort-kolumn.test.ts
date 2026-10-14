/**
 * Zgodność kolumn sortowalnych z białą listą w API.
 *
 * Nagłówek kolumny obiecuje sortowanie kliknięciem, a UI wysyła nazwę
 * pola w `?sort=`. Jeśli pola nie ma w `SORTABLE`, API **ignoruje je po
 * cichu** i zwraca listę sortowaną po nazwie — użytkownik klika, strzałek
 * się nie zmienia, a lista wygląda, jakby kliknięcie nie zadziałało.
 *
 * Dziś dropdown po prostu nie oferował takich opcji, więc rozjazdu nie było
 * widać. Przy nagłówkach każda kolumna w tabeli dostaje strzałkę, więc
 * brak wpisu w białej liście staje się cichym, trudnym do zdiagnozowania
 * błędem. Ten test nie pozwala go wprowadzić.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { read } from './helpers/repo';
import { webSources } from './helpers/web-sources';

/** Kolumny, które UI wystawia jako sortowalne, z nazwą pola w API. */
const KOLUMNY: Array<{ pole: string; etykieta: string; tylkoZalogowany: boolean }> = [
  { pole: 'name', etykieta: 'Nazwa', tylkoZalogowany: false },
  { pole: 'deliveryType', etykieta: 'Dostarczanie', tylkoZalogowany: false },
  { pole: 'status', etykieta: 'Status', tylkoZalogowany: false },
  { pole: 'securityClass', etykieta: 'Bezpieczeństwo', tylkoZalogowany: true },
  { pole: 'criticality', etykieta: 'Krytyczność', tylkoZalogowany: true },
  { pole: 'ownerEmail', etykieta: 'Właściciel', tylkoZalogowany: true },
];

/** Klucze obiektu `SORTABLE` z `applications.service.ts`. */
function sortowalnePola(): Set<string> {
  const zrodlo = read('apps', 'api', 'src', 'applications', 'applications.service.ts');
  // Nie `[^}]*` — każdy wpis ma własne `{ name: 'asc' }`, więc taka klasa
  // zatrzymałaby się na pierwszej klamrze i widziała jedno pole.
  // Łapiemy więc do początku linii, która zamyka obiekt (`};` od kolumny 0).
  const blok = zrodlo.match(/const SORTABLE[^=]*=\s*\{([\s\S]*?)^\};/m);
  assert.ok(blok, 'nie znaleziono obiektu SORTABLE w applications.service.ts');

  const pola = new Set<string>();
  for (const wpis of blok[1]!.split('\n')) {
    // `nazwa: { … },` — bierzemy tylko klucze pierwszego poziomu.
    const dopasowanie = wpis.match(/^\s{2}(\w+):/);
    if (dopasowanie) pola.add(dopasowanie[1]!);
  }
  return pola;
}

/** Klucze zbioru `GUEST_SORTABLE`. */
function sortowalneDlaGoscia(): Set<string> {
  const zrodlo = read('apps', 'api', 'src', 'applications', 'applications.service.ts');
  const blok = zrodlo.match(/const GUEST_SORTABLE\s*=\s*new Set\(\[([^\]]*)\]/);
  assert.ok(blok, 'nie znaleziono zbioru GUEST_SORTABLE w applications.service.ts');

  const pola = new Set<string>();
  for (const wpis of blok[1]!.split(',')) {
    const nazwa = wpis.trim().replace(/^'|'$/g, '');
    if (nazwa) pola.add(nazwa);
  }
  return pola;
}

const DOZWOLONE = sortowalnePola();
const DLA_GOSCIA = sortowalneDlaGoscia();

describe('kolumny sortowalne a biała lista w API', () => {
  it('lista jest niepusta — test nie może przejść w próżni', () => {
    assert.ok(DOZWOLONE.size > 5, `znaleziono tylko ${DOZWOLONE.size} pól`);
    assert.ok(KOLUMNY.length > 0);
  });

  for (const kolumna of KOLUMNY) {
    it(`${kolumna.etykieta} (${kolumna.pole}) jest w białej liście SORTABLE`, () => {
      assert.ok(
        DOZWOLONE.has(kolumna.pole),
        `kolumna „${kolumna.etykieta}" jest sortowalna w UI, ale ` +
          `„${kolumna.pole}" nie ma w SORTABLE — API zignoruje takie ` +
          'sortowanie po cichu i strzałek nie zadziała.',
      );
    });

    if (kolumna.tylkoZalogowany) {
      it(`${kolumna.etykieta} (${kolumna.pole}) nie jest dostępna dla gościa`, () => {
        // Gość nie widzi tego pola, więc kolejność wierszy zdradziłaby
        // jego wartość. Kolumna ma u niego zniknąć z tabeli razem ze
        // strzałką — inaczej klik obiecuje sortowanie, które API odrzuci.
        assert.ok(
          !DLA_GOSCIA.has(kolumna.pole),
          `„${kolumna.pole}" jest ukryte przed gościem, więc nie może być w GUEST_SORTABLE`,
        );
      });
    }
  }

  it('kolumny widoczne dla gościa są w GUEST_SORTABLE', () => {
    // Odwrotność poprzednich: jeśli kolumna jest pokazana gościowi,
    // sortowanie po niej nie może ujawnić ukrytej wartości, więc API
    // musi ją przepuścić — inaczej strzałek nie będzie, a UI milczy
    // o powodzie.
    for (const kolumna of KOLUMNY.filter((k) => !k.tylkoZalogowany)) {
      assert.ok(
        DLA_GOSCIA.has(kolumna.pole),
        `„${kolumna.pole}" jest widoczne dla gościa, ale nie ma go w GUEST_SORTABLE`,
      );
    }
  });

  it('strzałki pojawiają się tylko przy kolumnach z białej listy', () => {
    // Kolumny „Wniosek o dostęp" i „Akcje" nie mają sortowania. Gdyby ktoś
    // dopisał do UI sortowanie po `accessRequest` albo po kolumnie akcji,
    // test powinien to zauważyć — dziś szukamy tylko deklarowanych
    // sortowalnych kolumn, więc pilnujmy, żeby lista nie rozrosła się
    // o pola spoza `SORTABLE`.
    const zrodlo = read('apps', 'web', 'src', 'pages', 'ApplicationsListPage.tsx');
    const sortowalneWUI = [...zrodlo.matchAll(/sortBy="(\w+)"/g)].map((m) => m[1]!);

    for (const pole of sortowalneWUI) {
      assert.ok(
        DOZWOLONE.has(pole),
        `UI wystawia sortowanie po „${pole}", którego nie ma w SORTABLE`,
      );
    }
  });

  it('plik strony jest jednym z tych, które test czyta', () => {
    // Gdyby strona zmieniła nazwę, test badałby nieistniejący plik i
    // `read` rzuciłoby wyjątek — ale lepiej zobaczyć przyczynę wprost.
    assert.ok(webSources().some((plik) => plik.endsWith('ApplicationsListPage.tsx')));
  });
});

/**
 * Widoczność kolumn, nie sortowania.
 *
 * Osobny blok, bo to osobna klasa błędu: przy wdrożeniu nagłówków
 * sortowalnych warunek `!isGuest` zniknął z `<thead>` i zastąpił go
 * warunek na `sortBy`. Ten wyłączał **sortowanie**, ale `SortableTh`
 * i tak renderuje `<Th>{label}</Th>` — gość dostał trzy puste kolumny
 * w środku tabeli.
 *
 * Testy powyżej tego nie widziały: sprawdzały nazwy pól wobec białej
 * listy, czyli **sortowanie**. Tu chodzi o to, **czy kolumna w ogóle
 * istnieje**.
 */
describe('wiersz nagłówka tabeli aplikacji', () => {
  /** Źródło strony listy aplikacji. */
  function strona(): string {
    return read('apps', 'web', 'src', 'pages', 'ApplicationsListPage.tsx');
  }

  it('gość nie dostaje kolumn oznaczonych guestHidden', () => {
    const zrodlo = strona();
    // `.filter(` przed mapowaniem `SORT_COLUMNS` w `<thead>`. Samo
    // `guestHidden` w danych nie wystarczy — bez filtra kolumna i tak
    // się renderuje, tylko bez strzałki.
    const mapowanie = zrodlo.match(/SORT_COLUMNS\s*\.\s*map\(/);
    assert.equal(
      mapowanie,
      null,
      'kolumny renderują się przez samo SORT_COLUMNS.map — brak filtra ' +
        'widoczności, więc gość zobaczy puste kolumny ukrytych pól',
    );
    assert.ok(
      /SORT_COLUMNS\s*\.\s*filter\(/.test(zrodlo),
      'mapowanie nagłówka nie ma filtra — kolumny guestHidden trafiają do gościa',
    );
  });

  it('filtr powołuje się na isGuest, nie na coś innego', () => {
    // Filtr, który sprawdza tylko `guestHidden` w danych, przepuściłby
    // wszystkie kolumny — a chodzi o to, żeby gość nie dostał tych
    // ukrytych przed nim.
    //
    // Czytamy do końca wyrażenia (`[\s\S]*?`), a nie `[^)]*` — to drugie
    // zatrzymuje się na nawiasie funkcji `filter((k) => …)` i uchwyciłoby
    // tylko `(k`, przez co test sprawdzałby nie to, o co chodzi.
    const filtr = strona().match(/SORT_COLUMNS\s*\.\s*filter\(([\s\S]*?)\)\.map\(/);
    assert.ok(filtr, 'nie znaleziono filtra kolumn przed .map()');
    assert.ok(
      filtr[1]!.includes('isGuest'),
      `filtr kolumn nie odwołuje się do isGuest: ${filtr[1]}`,
    );
  });

  it('kolumny gościa nie są sortowalne przez przypadek', () => {
    // `sortBy={undefined}` wyłącza sortowanie, ale nie usuwa kolumny.
    // Dlatego `guestHidden` nie może pojawiać się już w wyrażeniu
    // przekazywanym do `sortBy` — tam miałoby tylko zniekształcać
    // czytelność kodu, sugerując ochronę, której nie ma.
    const wiersz = strona().slice(strona().indexOf('<thead'));
    assert.ok(
      !/sortBy=\{[^}]*guestHidden/.test(wiersz),
      'guestHidden nadal steruje sortBy w <thead> — usuwa tylko strzałkę, ' +
        'a kolumna zostaje pusta u gościa',
    );
  });

  it('wiersze tabeli nadal warunkują ukryte pola', () => {
    // Nagłówek i wiersze muszą być zgodne w obie strony: sam nagłówek
    // bez warunku to puste kolumny, sam wiersz bez warunku to wyciek
    // danych do odpowiedzi publicznej.
    const zrodlo = strona();
    const wystapienia = [...zrodlo.matchAll(/showRestricted\s*&&/g)].length;
    assert.ok(
      wystapienia >= 3,
      `znaleziono ${wystapienia} warunków showRestricted — oczekiwano co najmniej 3 ` +
        '(bezpieczeństwo, krytyczność, właściciel)',
    );
  });

  /**
   * Kolejność kolumn w nagłówku i w wierszu.
   *
   * Osobna klasa błędu niż widoczność: nagłówek renderuje jedna lista
   * `SORT_COLUMNS`, a komórki `ApplicationRow` pisze ręcznie jedna po
   * drugiej. Nic w kodzie nie powiązuje tych dwóch miejsc, więc wpisanie
   * „Wniosek o dostęp" w złym miejscu liście nie przeszkadza — nic się
   * nie kompiluje, nic nie pada. Tabela po prostu pokazuje „Właściciel"
   * nad cudzymi danymi.
   *
   * Objaw widać tylko po zalogowaniu: trzy kolumny ukrytych pól renderuje
   * `ApplicationRow` warunkowo na `showRestricted`, więc u gościa nagłówek
   * i wiersz zgadzają się przypadkiem, a rozjazd wychodzi dopiero tam, gdzie
   * kolumny są. Dlatego sam test widoczności u góry tego pliku tego nie
   * wychwycił.
   */
  it('nagłówek i wiersz mają tę samą kolejność kolumn', () => {
    const zrodlo = strona();

    // Etykiety w kolejności deklaracji w `SORT_COLUMNS`. „Akcje" doklejamy
    // z ręki: to nagłówek bez danych, renderowany poza tą listą.
    const blok = zrodlo.match(/const SORT_COLUMNS[^=]*=\s*\[([\s\S]*?)^\];/m);
    assert.ok(blok, 'nie znaleziono listy SORT_COLUMNS w ApplicationsListPage.tsx');

    const naglowek: string[] = [];
    for (const wpis of blok[1]!.split('\n')) {
      const etykieta = wpis.match(/label:\s*'([^']+)'/);
      if (etykieta) naglowek.push(etykieta[1]!);
    }
    assert.ok(naglowek.length > 0, 'lista SORT_COLUMNS nie zawiera żadnej etykiety');
    naglowek.push('Akcje');

    // Kolejność kolumn w wierszu, odczytana z `ApplicationRow`. Każdy
    // znacznik wskazuje inną komórkę — `Nazwa` renderuje się pierwsza i jest
    // jedyną bez własnego, bo jako jedyna nie potrzebuje warunku.
    const wiersz = zrodlo.slice(zrodlo.indexOf('function ApplicationRow'));
    const komorki: Array<{ nazwa: string; znacznik: RegExp }> = [
      { nazwa: 'Nazwa', znacznik: /<td/ },
      { nazwa: 'Dostarczanie', znacznik: /DELIVERY_TYPE_TONES\[app\.deliveryType\]/ },
      { nazwa: 'Status', znacznik: /STATUS_TONES\[app\.status\]/ },
      { nazwa: 'Wniosek o dostęp', znacznik: /app\.accessRequestRequired/ },
      { nazwa: 'Bezpieczeństwo', znacznik: /app\.securityClass/ },
      { nazwa: 'Krytyczność', znacznik: /app\.criticality/ },
      { nazwa: 'Właściciel', znacznik: /app\.ownerEmail/ },
      { nazwa: 'Akcje', znacznik: /<RowActions/ },
    ];

    for (const komorka of komorki) {
      assert.ok(
        wiersz.search(komorka.znacznik) >= 0,
        `nie znaleziono komórki „${komorka.nazwa}" w ApplicationRow — test nie ` +
          'potrafi odczytać kolejności kolumn, więc porównanie byłoby pozorne',
      );
    }

    assert.deepEqual(
      naglowek,
      komorki.map((k) => k.nazwa),
      'kolejność kolumn w nagłówku nie zgadza się z kolejnością komórek ' +
        `w wierszu — nagłówek pokazuje inną etykietę niż dane pod nim. ` +
        `Nagłówek: ${naglowek.join(', ')}. ` +
        `Wiersz: ${komorki.map((k) => k.nazwa).join(', ')}.`,
    );
  });

  it('dane ukrytych pól nie wracają z publicznej odpowiedzi', () => {
    // Ostatnia linia obrony: nawet gdyby kolumna wyciekła, wartości
    // nie ma w odpowiedzi dla gościa, więc nic poufnego nie pokaże.
    assert.ok(
      DLA_GOSCIA.size > 0 && DOZWOLONE.size > 0,
      'białe listy nie wczytane — porównanie byłoby pozorne',
    );
    for (const pole of ['securityClass', 'criticality', 'ownerEmail']) {
      assert.ok(
        !DLA_GOSCIA.has(pole),
        `„${pole}" nie może być sortowalne dla gościa — kolejność zdradziłaby wartość`,
      );
    }
  });
});

