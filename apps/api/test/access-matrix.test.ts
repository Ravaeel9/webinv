/**
 * Macierz uprawnień — reguły, które decydują, czy macierz w ogóle
 * odzwierciedla rzeczywistość.
 *
 * Cztery przypadki, w których ewidencja kłamie, jeśli serwis ich nie pilnuje:
 *
 *  - **Dodanie nieaktywnej osoby.** Matryza pokazuje „dostęp" dla osoby,
 *    której dostęp cofnięto; nikt nie zauważy, bo wiersz wygląda normalnie.
 *  - **Ta sama osoba dwa razy.** Klucz złożony to łapie, ale komunikat
 *    musi mówić wprost, że to ta sama osoba w tej samej aplikacji.
 *  - **Wygasłe przypisania znikają z macierzy.** Skoro `expiresOn` to data
 *    wygasania, a nie usunięcie, wiersz musi zostać — z informacją,
 *    że dostęp już wygasł. Inaczej historia nadania znika.
 *  - **Macierz zbiorcza gubi dane.** Tu schodzą trzy różne tabele
 *    (osoby, przypisania, aplikacje), więc łatwo przefiltrować za mocno
 *    i pokazać pustą listę bez słowa wyjaśnienia.
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

function zAplikacja() {
  const aplikacja = { id: randomUUID(), name: 'System kadrowy', deletedAt: null };
  const { port, osoby, granty } = fakeDb([aplikacja]);
  return { port, osoby, granty, aplikacja };
}

describe('AccessService — macierz uprawnień', () => {
  it('odrzucone nadanie nie zostawia w katalogu osoby ani nie zmienia danych istniejącej', async () => {
    const { port, osoby, aplikacja } = zAplikacja();
    const serwis = new AccessService(port, fakeAudit() as never);
    await serwis.createPerson(
      { firstName: 'Anna', lastName: 'X', email: 'a.x@firma.pl', department: 'Księgowość' },
      actor,
    );
    const przed = { ...osoby[0]! };

    await assert.rejects(
      () =>
        serwis.grantAccess(
          aplikacja.id,
          {
            email: 'a.x@firma.pl',
            firstName: 'Anna',
            lastName: 'X',
            department: 'IT',
            expiresOn: '2020-01-01',
          },
          actor,
        ),
      BadRequestException,
    );
    assert.deepEqual(osoby[0], przed, 'odrzucone nadanie nie może zmienić danych osoby');

    await assert.rejects(
      () =>
        serwis.grantAccess(
          aplikacja.id,
          { email: 'nowa@firma.pl', firstName: 'Nowa', lastName: 'Osoba', expiresOn: '2020-01-01' },
          actor,
        ),
      BadRequestException,
    );
    assert.equal(
      osoby.filter((p) => p.email === 'nowa@firma.pl').length,
      0,
      'osoba utworzona przy odrzuconym nadaniu zostaje w katalogu na zawsze',
    );
  });

  it('dostęp wygasa dzisiaj, nie dopiero jutro', async () => {
    const { port, aplikacja } = zAplikacja();
    const serwis = new AccessService(port, fakeAudit() as never);

    const grant = await serwis.grantAccess(
      aplikacja.id,
      { email: 'a.x@firma.pl', firstName: 'Anna', lastName: 'X', expiresOn: dzis() },
      actor,
    );

    assert.equal(grant.expiresOn, dzis());
  });

  it('nadaje dostęp osobie spoza panelu i tworzy ją przy okazji', async () => {
    const { port, osoby, granty, aplikacja } = zAplikacja();
    const serwis = new AccessService(port, fakeAudit() as never);

    const grant = await serwis.grantAccess(
      aplikacja.id,
      {
        email: 'jan.kowalski@firma.pl',
        firstName: 'Jan',
        lastName: 'Kowalski',
        department: 'IT',
        level: 'ADMIN',
        expiresOn: '2026-12-31',
      },
      actor,
    );

    assert.equal(grant.level, 'ADMIN');
    assert.equal(grant.personId, osoby[0]!.id);
    // Osoba z ewidencji nie jest kontem panelu — to osobna tabela.
    assert.equal(granty.length, 1);
  });

  it('odrzuca drugie nadanie tej samej osobie w tej samej aplikacji', async () => {
    const { port, aplikacja } = zAplikacja();
    const serwis = new AccessService(port, fakeAudit() as never);
    await serwis.grantAccess(
      aplikacja.id,
      { email: 'jan.kowalski@firma.pl', firstName: 'Jan', lastName: 'Kowalski' },
      actor,
    );

    await assert.rejects(
      () =>
        serwis.grantAccess(
          aplikacja.id,
          { email: 'jan.kowalski@firma.pl', firstName: 'Jan', lastName: 'Kowalski', level: 'ADMIN' },
          actor,
        ),
      ConflictException,
    );
  });

  it('nie dodaje osoby nieaktywnej, ale zostawia jej dotychczasowe przypisania', async () => {
    const { port, granty, aplikacja } = zAplikacja();
    const serwis = new AccessService(port, fakeAudit() as never);
    const pierwsza = await serwis.grantAccess(
      aplikacja.id,
      { email: 'e.nowak@firma.pl', firstName: 'Ewa', lastName: 'Nowak' },
      actor,
    );
    await serwis.deactivatePerson(pierwsza.personId, actor);

    await assert.rejects(
      () =>
        serwis.grantAccess(
          aplikacja.id,
          { email: 'e.nowak@firma.pl', firstName: 'Ewa', lastName: 'Nowak', level: 'OWNER' },
          actor,
        ),
      BadRequestException,
    );

    assert.equal(granty.length, 1, 'dezaktywacja nie kasuje istniejącego przypisania');
  });

  it('data wygaśnięcia w przeszłości jest odrzucana przy nadaniu, ale przyjmowana przy edycji', async () => {
    const { port, aplikacja } = zAplikacja();
    const serwis = new AccessService(port, fakeAudit() as never);

    await assert.rejects(
      () =>
        serwis.grantAccess(
          aplikacja.id,
          { email: 'a.x@firma.pl', firstName: 'Anna', lastName: 'X', expiresOn: '2020-01-01' },
          actor,
        ),
      BadRequestException,
    );

    const grant = await serwis.grantAccess(
      aplikacja.id,
      { email: 'a.x@firma.pl', firstName: 'Anna', lastName: 'X' },
      actor,
    );
    const po = await serwis.updateGrant(
      aplikacja.id,
      grant.personId,
      { expiresOn: '2020-01-01', note: 'dostęp zakończony' },
      actor,
    );

    assert.equal(po.expiresOn, '2020-01-01');
  });

  it('odrzuca nadanie dla aplikacji, która nie istnieje', async () => {
    const { port } = zAplikacja();
    const serwis = new AccessService(port, fakeAudit() as never);

    await assert.rejects(
      () =>
        serwis.grantAccess(
          randomUUID(),
          { email: 'a.x@firma.pl', firstName: 'Anna', lastName: 'X' },
          actor,
        ),
      NotFoundException,
    );
  });

  it('odrzuca nadanie dostępu dla aplikacji ogólnego użytku (GENERAL_USE)', async () => {
    const aplikacja = {
      id: randomUUID(),
      name: '7-Zip',
      deletedAt: null,
      deliveryType: 'GENERAL_USE' as const,
    };
    const { port, osoby, granty } = fakeDb([aplikacja]);
    const serwis = new AccessService(port, fakeAudit() as never);

    await assert.rejects(
      () =>
        serwis.grantAccess(
          aplikacja.id,
          { email: 'a.x@firma.pl', firstName: 'Anna', lastName: 'X' },
          actor,
        ),
      BadRequestException,
    );
    assert.equal(osoby.length, 0, 'nie wolno utworzyć osoby przy odrzuconym nadaniu');
    assert.equal(granty.length, 0);
  });

  it('zmiana poziomu i notatki nie rusza daty nadania', async () => {
    const { port, aplikacja } = zAplikacja();
    const serwis = new AccessService(port, fakeAudit() as never);
    const grant = await serwis.grantAccess(
      aplikacja.id,
      { email: 'a.x@firma.pl', firstName: 'Anna', lastName: 'X' },
      actor,
    );

    const po = await serwis.updateGrant(
      aplikacja.id,
      grant.personId,
      { level: 'READ_ONLY', note: 'tylko raporty' },
      actor,
    );

    assert.equal(po.level, 'READ_ONLY');
    assert.equal(po.note, 'tylko raporty');
    assert.equal(po.grantedOn, grant.grantedOn);
  });

  it('odebranie dostępu usuwa przypisanie, ale zostawia osobę w katalogu', async () => {
    const { port, osoby, granty, aplikacja } = zAplikacja();
    const serwis = new AccessService(port, fakeAudit() as never);
    const grant = await serwis.grantAccess(
      aplikacja.id,
      { email: 'a.x@firma.pl', firstName: 'Anna', lastName: 'X' },
      actor,
    );

    await serwis.revokeGrant(aplikacja.id, grant.personId, actor);

    assert.equal(granty.length, 0);
    assert.equal(osoby.length, 1, 'osoba zostaje — katalog to nie macierz');
  });

  it('macierz aplikacji pokazuje poziom i osobę, z odpowiedzi na osobę', async () => {
    const { port, aplikacja } = zAplikacja();
    const serwis = new AccessService(port, fakeAudit() as never);
    await serwis.grantAccess(
      aplikacja.id,
      { email: 'a.x@firma.pl', firstName: 'Anna', lastName: 'X', department: 'IT', level: 'OWNER' },
      actor,
    );

    const granty = await serwis.listApplicationAccess(aplikacja.id);

    assert.equal(granty.length, 1);
    assert.equal(granty[0]!.level, 'OWNER');
    assert.equal(granty[0]!.person.lastName, 'X');
    assert.equal(granty[0]!.person.department, 'IT');
  });

  it('macierz zbiorcza łączy osobę z aplikacją i filtruje po dziale oraz poziomie', async () => {
    const { aplikacja } = zAplikacja();
    const druga = { id: randomUUID(), name: 'Portal klienta', deletedAt: null };
    const db = fakeDb([aplikacja, druga]);
    const serwis = new AccessService(db.port, fakeAudit() as never);

    await serwis.grantAccess(
      aplikacja.id,
      { email: 'a.x@firma.pl', firstName: 'Anna', lastName: 'X', department: 'IT', level: 'OWNER' },
      actor,
    );
    await serwis.grantAccess(
      druga.id,
      { email: 'b.y@firma.pl', firstName: 'Bolek', lastName: 'Y', department: 'Księgowość' },
      actor,
    );

    const wszystko = await serwis.matrix({});
    assert.equal(wszystko.length, 2);
    assert.equal(wszystko[0]!.application.name, aplikacja.name);
    assert.equal(wszystko[0]!.person.department, 'IT');

    const dlaIT = await serwis.matrix({ department: 'IT' });
    assert.equal(dlaIT.length, 1);
    assert.equal(dlaIT[0]!.person.email, 'a.x@firma.pl');

    const wlasciciele = await serwis.matrix({ level: 'OWNER' });
    assert.equal(wlasciciele.length, 1);

    const jedna = await serwis.matrix({ applicationId: druga.id });
    assert.equal(jedna[0]!.application.name, druga.name);
  });

  it('macierz zbiorcza nie gubi wygasłych przypisań', async () => {
    const { port, aplikacja } = zAplikacja();
    const serwis = new AccessService(port, fakeAudit() as never);
    const grant = await serwis.grantAccess(
      aplikacja.id,
      { email: 'a.x@firma.pl', firstName: 'Anna', lastName: 'X' },
      actor,
    );
    await serwis.updateGrant(
      aplikacja.id,
      grant.personId,
      { expiresOn: '2020-01-01' },
      actor,
    );

    const wiersze = await serwis.matrix({});

    assert.equal(wiersze.length, 1, 'wygasłe przypisanie to historia, nie śmieć');
    assert.equal(wiersze[0]!.expiresOn, '2020-01-01');
  });
});
/** Dzisiejsza data w formacie `RRRR-MM-DD`. */
function dzis(): string {
  return new Date().toISOString().slice(0, 10);
}
