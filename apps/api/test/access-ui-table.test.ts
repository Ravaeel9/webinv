/**
 * Spójność tabel w module `access` — pilnuje rzeczy, przez które
 * kolumny rozjeżdżają się ze swoimi nagłówkami.
 *
 * Trzy konkretne błędy z poprzedniej wersji:
 *
 *  - **Brak `text-left` na `<table>`.** Przeglądarki domyślnie centrują
 *    `<th>`, a `<td>` zostawiają lewosparte — bez `text-left` nagłówek
 *    stoi na środku kolumny, a jej treść po lewej.
 *  - **`pr-3` zamiast `px-4` w komórkach.** Bez lewego paddingu pierwsza
 *    komórka stoi 12 px na lewo od swojego nagłówka (`.table-head` ma
 *    `px-3`).
 *  - **Brak tła nagłówka i separatorów wierszy.** Zwykłe `border-border`
 *    zamiast `bg-surface-2` + `divide-y divide-line` wygląda jak osobny,
 *    niedokończony ekran.
 *
 * Reguła jest krótka: cztery widoki modułu uprawnień używają wspólnych
 * prymitywów z `components/ui/Table.tsx`, zamiast pisać surowe `<table>`
 * z własnymi klasami. Wtedy piąte miejsce nie ma jak rozjechać się z resztą.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { read } from './helpers/repo';

const PLIKI_ACCESS = [
  ['apps', 'web', 'src', 'pages', 'AccessPage.tsx'],
  ['apps', 'web', 'src', 'pages', 'PersonDetailPage.tsx'],
  ['apps', 'web', 'src', 'components', 'access', 'ApplicationAccessSection.tsx'],
  ['apps', 'web', 'src', 'components', 'access', 'ImportPersonsModal.tsx'],
  ['apps', 'web', 'src', 'components', 'access', 'PersonAccessModal.tsx'],
] as const;

const table = read('apps', 'web', 'src', 'components', 'ui', 'Table.tsx');

describe('Prymitywy tabeli w components/ui/Table.tsx', () => {
  it('Table wymusza wyrównanie do lewej i pasek przewijania', () => {
    assert.ok(table.includes('export function Table('), 'brak prymitywu Table');
    assert.ok(
      table.includes('scroll-thin overflow-x-auto'),
      'Table musi owijać tabelę w scroll-thin overflow-x-auto',
    );
    assert.ok(
      table.includes('text-left'),
      'bez text-left przeglądarka centruje <th>, a <td> zostawia po lewej',
    );
  });

  it('Thead, Tbody i Td niosą kanoniczny wygląd z pozostałych stron', () => {
    assert.ok(table.includes('export function Thead('));
    assert.ok(table.includes('border-b border-line-strong bg-surface-2'));

    assert.ok(table.includes('export function Tbody('));
    assert.ok(table.includes('divide-y divide-line'));

    assert.ok(table.includes('export function Td('));
    assert.ok(
      /px-[34]\s+py-2\.5/.test(table),
      'Td musi mieć symetryczny padding poziomy — sam pr-3 przesuwa treść względem nagłówka',
    );
  });

  it('nagłówek i komórka mają ten sam poziomy padding', () => {
    const css = read('apps', 'web', 'src', 'index.css');
    const thPadding = css.match(/\.table-head\s*\{[\s\S]*?(px-\d+)/)?.[1];
    const tdPadding = table.match(/function Td[\s\S]*?(px-\d+)/)?.[1];
    assert.ok(thPadding, 'nie znaleziono paddingu w .table-head');
    assert.equal(
      tdPadding,
      thPadding,
      `Td (${tdPadding}) i Th (${thPadding}) mają różny poziomy padding — kolumny się rozjadą`,
    );
  });
});

describe('Tabele modułu access używają prymitywów, a nie surowego HTML', () => {
  for (const sciezka of PLIKI_ACCESS) {
    const nazwa = sciezka[sciezka.length - 1]!;
    const zrodlo = read(...sciezka);

    it(`${nazwa} nie pisze własnego <table>, <thead>, <tbody> ani <td>`, () => {
      for (const znacznik of ['<table', '<thead', '<tbody', '<td']) {
        assert.equal(
          zrodlo.includes(znacznik),
          false,
          `${nazwa} używa surowego ${znacznik} zamiast prymitywów z Table.tsx`,
        );
      }
      assert.ok(zrodlo.includes('<Table'), `${nazwa} musi używać <Table>`);
      assert.ok(zrodlo.includes('<Td'), `${nazwa} musi używać <Td>`);
    });
  }
});