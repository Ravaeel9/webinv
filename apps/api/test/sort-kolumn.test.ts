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
