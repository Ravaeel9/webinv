/**
 * Mapowanie danych GLPI na modele web-inv.
 *
 * Zasada ustalona z projektantem integracji: **czego GLPI nie ma,
 * tego nie wymyślamy** — pole zostaje puste do ręcznego uzupełnienia.
 * Mapowanie jest czystą funkcją, więc test nie potrzebuje ani bazy,
 * ani sieci: dowodzi reguły bezpośrednio na przykładowych rekordach.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mapujOsobe, mapujOprogramowanie, grupyDostepu, mapujCzlonkow } from '../src/glpi/glpi-mapper';

describe('mapowanie osób z GLPI', () => {
  it('użytkownik GLPI staje się osobą katalogu (e-mail = tożsamość)', () => {
    const osoba = mapujOsobe({
      id: 7,
      username: 'test.user001',
      realname: 'Kowalska',
      firstname: 'Anna',
      emails: ['anna.kowalska@firma.pl'],
      title: 'Analityk',
      category: 'IT',
      is_active: true,
      is_deleted: false,
    });

    assert.deepEqual(osoba.osoba, {
      firstName: 'Anna',
      lastName: 'Kowalska',
      email: 'anna.kowalska@firma.pl',
      position: 'Analityk',
      department: 'IT',
    });
    assert.equal(osoba.blad, undefined);
  });

  it('brak e-maila jest błędem wiersza, nie cichym pominięciem', () => {
    const wynik = mapujOsobe({
      id: 8,
      username: 'tech',
      realname: null,
      firstname: null,
      emails: [],
      title: null,
      category: null,
      is_active: true,
      is_deleted: false,
    });

    assert.equal(wynik.blad, 'MISSING_EMAIL');
    assert.equal(wynik.osoba, undefined);
  });

  it('e-mail może być obiektem {email}, jak zwraca API GLPI', () => {
    const wynik = mapujOsobe({
      id: 9,
      username: 'x',
      realname: 'Nowak',
      firstname: 'Jan',
      emails: [{ email: 'jan.nowak@firma.pl' }],
      title: null,
      category: null,
      is_active: true,
      is_deleted: false,
    });

    assert.equal(wynik.osoba!.email, 'jan.nowak@firma.pl');
  });

  it('brak nazwiska: nazwiskiem staje się imię, a pustka obu to błąd', () => {
    const tylkoImie = mapujOsobe({
      id: 10, username: 'x', realname: null, firstname: 'Jan',
      emails: ['j@f.pl'], title: null, category: null, is_active: true, is_deleted: false,
    });
    assert.equal(tylkoImie.osoba!.lastName, 'Jan');

    const bezNiczego = mapujOsobe({
      id: 11, username: 'x', realname: null, firstname: null,
      emails: ['j@f.pl'], title: null, category: null, is_active: true, is_deleted: false,
    });
    assert.equal(bezNiczego.blad, 'MISSING_NAME');
  });

  it('limity długości pól są pilnowane (kolumny mają VarChar)', () => {
    const wynik = mapujOsobe({
      id: 12,
      username: 'x',
      realname: 'N'.repeat(300),
      firstname: 'I'.repeat(300),
      emails: [`${'a'.repeat(300)}@f.pl`],
      title: 'T'.repeat(300),
      category: 'D'.repeat(300),
      is_active: true,
      is_deleted: false,
    });

    const osoba = wynik.osoba!;
    assert.ok(osoba.lastName.length <= 100);
    assert.ok(osoba.firstName.length <= 100);
    assert.ok(osoba.email.length <= 200);
    assert.ok(osoba.position === null || osoba.position.length <= 150);
    assert.ok(osoba.department === null || osoba.department.length <= 150);
  });
});

describe('mapowanie oprogramowania z GLPI', () => {
  it('software GLPI staje się szkicem aplikacji: nazwa + najnowsza wersja', () => {
    const aplikacja = mapujOprogramowanie({
      id: 1,
      name: 'LibreOffice',
      versions: [{ id: 1, name: '7.6' }, { id: 2, name: '24.2' }],
    });

    assert.deepEqual(aplikacja, {
      name: 'LibreOffice',
      version: '24.2',
      description: null,
    });
  });

  it('brak wersji zostawia pusty ciąg — kolumna nie przyjmuje NULL', () => {
    const aplikacja = mapujOprogramowanie({ id: 2, name: 'Bastion', versions: [] });
    assert.equal(aplikacja.version, '');
  });

  it('nazwa jest oczyszczona ze zbędnych spacji; pusta nazwa to błąd', () => {
    assert.equal(mapujOprogramowanie({ id: 3, name: '  VPN Suite  ', versions: [] }).name, 'VPN Suite');
    assert.throws(() => mapujOprogramowanie({ id: 4, name: '   ', versions: [] }), /nazw/);
  });
});

describe('grupy dostępu z GLPI', () => {
  const grupy = [
    { id: 1, name: 'Access', completename: 'Access', parent: null },
    { id: 2, name: 'VPN', completename: 'Access > VPN', parent: { id: 1, name: 'Access' } },
    { id: 3, name: 'Mail', completename: 'Access > Mail', parent: { id: 1, name: 'Access' } },
    { id: 4, name: 'Inne', completename: 'Inne', parent: null },
  ];

  it('grupami dostępu są wyłącznie dzieci grupy nadrzędnej', () => {
    const dzieci = grupyDostepu(grupy, 'Access');
    assert.deepEqual(
      dzieci.map((g) => g.name).sort(),
      ['Mail', 'VPN'],
      'grupa nadrzędna i grupy spoza niej nie są aplikacjami',
    );
  });

  it('nieznana grupa nadrzędna daje pustą listę, nie wyjątek', () => {
    assert.deepEqual(grupyDostepu(grupy, 'Nie ma takiej'), []);
  });

  it('członkowie grupy stają się parami osoba×aplikacja', () => {
    const pary = mapujCzlonkow(
      [
        { users_id: 129, groups_id: 2 },
        { users_id: 130, groups_id: 2 },
        { users_id: 129, groups_id: 3 },
      ],
      { 2: 'app-vpn', 3: 'app-mail' },
      { 129: 'person-129', 130: 'person-130' },
      'USER',
    );

    assert.equal(pary.length, 3);
    assert.deepEqual(
      pary.map((p) => [p.applicationId, p.personId, p.level]).sort(),
      [
        ['app-mail', 'person-129', 'USER'],
        ['app-vpn', 'person-129', 'USER'],
        ['app-vpn', 'person-130', 'USER'],
      ],
    );
  });

  it('członek bez osoby w katalogu jest pomijany (licznik), nie wywala importu', () => {
    const pary = mapujCzlonkow(
      [{ users_id: 999, groups_id: 2 }],
      { 2: 'app-vpn' },
      {},
      'USER',
    );
    assert.deepEqual(pary, []);
  });
});
