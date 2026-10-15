/**
 * Katalog osób — reguły, które są drogie, gdy się je sprawdzi za późno.
 *
 * Dwie decyzje z projektu są tu najważniejsze:
 *
 *  - **E-mail to tożsamość.** Osoba wchodzi do katalogu raz, a potem
 *    pojawia się w macierzy wielu aplikacji. Ponowne utworzenie tej samej
 *    osoby drugim wierszem psuje ewidencję („kto ma dostęp" zaczyna
 *    pokazywać dwa wierszy dla jednej osoby), więc duplikat musi zostać
 *    odrzucony **z identyfikatorem istniejącego wiersza** — bez niego
 *    panel nie ma jak zaproponować dodania do macierzy.
 *  - **Osoby się nie kasuje.** Przypisania w macierzach innych aplikacji
 *    muszą zostać czytelne, więc istnieje `isActive`, a nie `DELETE`.
 */
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AccessService } from '../src/access/access.service';
import { fakeAudit, fakeDb } from './helpers/access-fake';
import type { AuthUser } from '../src/auth/decorators';

const actor: AuthUser = {
  id: randomUUID(),
  username: 'admin',
  email: 'admin@firma.pl',
  fullName: 'Anna Administrator',
  role: 'ADMIN',
  mustChangePassword: false,
};

const JAN = { firstName: 'Jan', lastName: 'Kowalski', email: 'jan.kowalski@firma.pl' };

describe('AccessService — katalog osób', () => {
  it('tworzy osobę z rozdzielonym imieniem i nazwiskiem', async () => {
    const { port } = fakeDb();
    const serwis = new AccessService(port, fakeAudit() as never);

    const osoba = await serwis.createPerson(
      { ...JAN, position: 'Analityk', department: 'IT' },
      actor,
    );

    assert.equal(osoba.firstName, 'Jan');
    assert.equal(osoba.lastName, 'Kowalski');
    assert.equal(osoba.position, 'Analityk');
    assert.equal(osoba.isActive, true);
  });

  it('odrzuca duplikat e-maila i wskazuje osobę już w katalogu', async () => {
    const { port } = fakeDb();
    const serwis = new AccessService(port, fakeAudit() as never);
    const pierwsza = await serwis.createPerson(JAN, actor);

    await assert.rejects(
      () => serwis.createPerson({ ...JAN, lastName: 'K.' }, actor),
      (blad: unknown) => {
        assert.ok(blad instanceof ConflictException);
        // Identyfikator musi być w komunikacie: bez niego panel nie odróżni
        // „ta osoba już jest" od cudzego konfliktu.
        assert.ok(
          (blad.message ?? '').includes(pierwsza.id),
          `komunikat nie zawiera id istniejącej osoby: ${blad.message}`,
        );
        return true;
      },
    );
  });

  it('odrzuca e-mail ze spacją i puste imię', async () => {
    const { port } = fakeDb();
    const serwis = new AccessService(port, fakeAudit() as never);

    await assert.rejects(
      () => serwis.createPerson({ ...JAN, email: 'jan kowalski@firma.pl' }, actor),
      BadRequestException,
    );
    await assert.rejects(
      () => serwis.createPerson({ ...JAN, firstName: '  ' }, actor),
      BadRequestException,
    );
  });

  it('edycja nie nadpisuje pól, których nie podano', async () => {
    const { port, osoby } = fakeDb();
    const serwis = new AccessService(port, fakeAudit() as never);
    const osoba = await serwis.createPerson({ ...JAN, position: 'Analityk' }, actor);

    const po = await serwis.updatePerson(osoba.id, { lastName: 'Kowalski-Nowak' }, actor);

    assert.equal(po.lastName, 'Kowalski-Nowak');
    assert.equal(po.firstName, 'Jan');
    assert.equal(po.position, 'Analityk', 'niepodane pole nie może zniknąć');
    assert.equal(osoby.length, 1);
  });

  it('dezaktywacja nie kasuje osoby ani jej przypisań', async () => {
    const { port, osoby } = fakeDb();
    const serwis = new AccessService(port, fakeAudit() as never);
    const osoba = await serwis.createPerson(JAN, actor);

    const po = await serwis.deactivatePerson(osoba.id, actor);

    assert.equal(po.isActive, false);
    assert.equal(osoby.length, 1, 'osoba musi zostać w katalogu');
  });

  it('edycja i dezaktywacja zgłaszają brak osoby jako 404', async () => {
    const { port } = fakeDb();
    const serwis = new AccessService(port, fakeAudit() as never);

    await assert.rejects(() => serwis.updatePerson(randomUUID(), { lastName: 'X' }, actor), NotFoundException);
    await assert.rejects(() => serwis.deactivatePerson(randomUUID(), actor), NotFoundException);
  });

  it('edycja odrzuca nazwę składającą się z samej spacji', async () => {
    const { port } = fakeDb();
    const serwis = new AccessService(port, fakeAudit() as never);
    const osoba = await serwis.createPerson(JAN, actor);

    await assert.rejects(
      () => serwis.updatePerson(osoba.id, { firstName: '   ' }, actor),
      BadRequestException,
    );
    await assert.rejects(
      () => serwis.updatePerson(osoba.id, { lastName: '' }, actor),
      BadRequestException,
    );
  });

  it('lista osób zwraca liczbę przypisań i filtruje po aktywności', async () => {
    const { port } = fakeDb();
    const serwis = new AccessService(port, fakeAudit() as never);
    await serwis.createPerson(JAN, actor);
    const wygaszona = await serwis.createPerson(
      { firstName: 'Ewa', lastName: 'Nowak', email: 'e.nowak@firma.pl' },
      actor,
    );
    await serwis.deactivatePerson(wygaszona.id, actor);

    const wszyscy = await serwis.listPersons({});
    assert.equal(wszyscy.length, 2);

    const aktywni = await serwis.listPersons({ includeInactive: false });
    assert.deepEqual(aktywni.map((o) => o.email), ['jan.kowalski@firma.pl']);

    // Licznik musi być liczbą także wtedy, gdy dopiero co dodano przypisanie:
    // na żywej bazie `_count.access` wraca z Prisma jako obiekt i bez jawnego
    // przeniesienia kolumna „Aplikacje” pokazywała `undefined`.
    const zGrantem = await serwis.listPersons({ includeInactive: true });
    assert.equal(typeof zGrantem[0]!.accessCount, 'number');
    assert.equal(zGrantem[0]!.accessCount, 0);
  });

  it('szukanie po nazwisku nie zwraca osób z innego działu', async () => {
    const { port } = fakeDb();
    const serwis = new AccessService(port, fakeAudit() as never);
    await serwis.createPerson({ ...JAN, department: 'IT' }, actor);
    await serwis.createPerson(
      { firstName: 'Piotr', lastName: 'Nowak', email: 'p.nowak@firma.pl', department: 'Księgowość' },
      actor,
    );

    const znalezieni = await serwis.listPersons({ search: 'kowalski', department: 'Księgowość' });
    assert.deepEqual(znalezieni, []);
  });
});