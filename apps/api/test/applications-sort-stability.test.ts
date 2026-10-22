/**
 * Stabilność sortowania przy remisie wartości.
 *
 * `buildOrderBy` zwraca listę kluczy dla `orderBy`. Przy jednym kluczu
 * wiersze o równej wartości mają kolejność nieokreśloną w SQL, a lista
 * jest stronicowana (`take`/`skip`) — ten sam zestaw wierszy przy drugim
 * kliknięciu „Następna" wypadałby inaczej. Użytkownik widzi wtedy, jak
 * aplikacja znika z listy bez żadnego powodu.
 *
 * Drugi klucz to nazwa: pole, które jest sortowalne dla każdego, kto czyta
 * listę (znajduje się w `GUEST_SORTABLE`), więc gość też dostaje stabilną
 * kolejność.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { buildOrderBy } from '../src/applications/applications.service';

describe('buildOrderBy — stabilne sortowanie przy remisie', () => {
  it('dokłada nazwę jako drugi klucz', () => {
    assert.deepEqual(buildOrderBy('status'), [
      { status: 'asc' },
      { name: 'asc' },
    ]);
  });

  it('drugi klucz zostaje rosnący także przy odwróceniu pierwszego', () => {
    // `-status` odwraca tylko status. Gdyby odwróciło i nazwę, remis
    // rozstrzygałby się malejąco — niespójnie z domyślnym widokiem.
    assert.deepEqual(buildOrderBy('-status'), [
      { status: 'desc' },
      { name: 'asc' },
    ]);
  });

  it('działa też dla sortowań z kierunkiem domyślnym malejącym', () => {
    assert.deepEqual(buildOrderBy('criticality'), [
      { criticality: 'desc' },
      { name: 'asc' },
    ]);
    assert.deepEqual(buildOrderBy('-criticality'), [
      { criticality: 'asc' },
      { name: 'asc' },
    ]);
  });

  it('nie duplikuje nazwy, gdy sortujesz już po nazwie', () => {
    assert.deepEqual(buildOrderBy('name'), [{ name: 'asc' }]);
    assert.deepEqual(buildOrderBy('-name'), [{ name: 'desc' }]);
  });

  it('domyślne sortowanie zostaje pojedynczym kluczem', () => {
    // Nie `[name asc, name asc]` — nadmiarowy klucz tylko zaciemnia
    // zapytanie, a zachowanie jest takie samo.
    assert.deepEqual(buildOrderBy(undefined), [{ name: 'asc' }]);
    assert.deepEqual(buildOrderBy(''), [{ name: 'asc' }]);
    assert.deepEqual(buildOrderBy('-hack'), [{ name: 'asc' }]);
  });

  it('gość też dostaje stabilny remis przy dozwolonym sortowaniu', () => {
    assert.deepEqual(buildOrderBy('status', true), [
      { status: 'asc' },
      { name: 'asc' },
    ]);
    assert.deepEqual(buildOrderBy('deliveryType', true), [
      { deliveryType: 'asc' },
      { name: 'asc' },
    ]);
  });

  it('gość nadal nie sortuje po ukrytych polach i dostaje default', () => {
    // Default to jednoelementowa lista — nazwa sama rozstrzyga remis.
    assert.deepEqual(buildOrderBy('criticality', true), [{ name: 'asc' }]);
    assert.deepEqual(buildOrderBy('securityClass', true), [{ name: 'asc' }]);
    assert.deepEqual(buildOrderBy('ownerEmail', true), [{ name: 'asc' }]);
  });

  it('właściciel sortuje przez relację do osoby, w obu kierunkach', () => {
    // Właściciel to relacja (`owner.email`), nie płaska kolumna — flip
    // kierunku musi wchodzić w głębię fragmentu. Dawniej płaski flip
    // na głębokim fragmencie zostawiałby kierunek bez zmian, więc
    // `-ownerEmail` sortowałoby rosnąco.
    assert.deepEqual(buildOrderBy('ownerEmail', false), [
      { owner: { email: 'asc' } },
      { name: 'asc' },
    ]);
    assert.deepEqual(buildOrderBy('-ownerEmail', false), [
      { owner: { email: 'desc' } },
      { name: 'asc' },
    ]);
  });
});
