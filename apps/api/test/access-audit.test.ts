/**
 * Dziennik zdarzeń matierzy — ślad po każdej zmianie.
 *
 * Macierz uprawnień to jednocześnie lista osób z dostępem do aplikacji,
 * czyli dokument, na którym opiera się „kto miał dostęp i kiedy". Bez
 * zapisu w dzienniku odpowiedź na to pytanie zależałaby od tego, kto
 * pamięta.
 *
 * Dwa szczegóły, które robią różnicę przy czytaniu:
 *
 *  - **Imię osoby w zmianie.** Wpisy dotyczą przypisania, więc samo
 *    `entityId` to UUID — czytelnik nie wie, o kogo chodzi. Dlatego przy
 *    nadaniu i odebraniu dostajemy nazwę osoby w `changes`.
 *  - **Jedna osoba, jeden wpis.** Każda operacja ma dokładnie jeden
 *    wpis z własnym `action`; przyciskanie „zapisz" w formularzu nie może
 *    zostawić w dzienniku trzech kopii tej samej zmiany.
 */
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { AccessService } from '../src/access/access.service';
import { fakeAudit, fakeDb } from './helpers/access-fake';
import type { AuthUser } from '../src/auth/decorators';
import { read } from './helpers/repo';

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
  const db = fakeDb([aplikacja]);
  const audit = fakeAudit();
  return { ...db, audit, serwis: new AccessService(db.port, audit as never), aplikacja };
}

describe('Dziennik zdarzeń — katalog osób', () => {
  it('utworzenie osoby zapisuje person.created z danymi', async () => {
    const { serwis, audit } = zAplikacja();

    await serwis.createPerson(
      { firstName: 'Jan', lastName: 'Kowalski', email: 'j.k@firma.pl', department: 'IT' },
      actor,
      '10.0.0.5',
    );

    assert.equal(audit.wpisy.length, 1);
    const wpis = audit.wpisy[0]!;
    assert.equal(wpis.action, 'person.created');
    assert.equal(wpis.entity, 'Person');
    assert.equal(wpis.changes?.email?.to, 'j.k@firma.pl');
    assert.equal(wpis.changes?.fullName?.to, 'Jan Kowalski');
    assert.equal(wpis.changes?.department?.to, 'IT');
  });

  it('edycja osoby zapisuje tylko pola, które faktycznie się zmieniły', async () => {
    const { serwis, audit } = zAplikacja();
    const osoba = await serwis.createPerson(
      { firstName: 'Jan', lastName: 'Kowalski', email: 'j.k@firma.pl', department: 'IT' },
      actor,
    );
    audit.wpisypierwszyReset();

    await serwis.updatePerson(osoba.id, { position: 'Analityk' }, actor);

    assert.equal(audit.wpisy.length, 1);
    assert.equal(audit.wpisy[0]!.action, 'person.updated');
    assert.equal(audit.wpisy[0]!.changes?.position?.to, 'Analityk');
    assert.equal(audit.wpisy[0]!.changes?.firstName, undefined, 'niezmienione pole nie trafia do dziennika');
  });

  it('dezaktywacja zapisuje person.deactivated', async () => {
    const { serwis, audit } = zAplikacja();
    const osoba = await serwis.createPerson(
      { firstName: 'Jan', lastName: 'Kowalski', email: 'j.k@firma.pl' },
      actor,
    );
    audit.wpisypierwszyReset();

    await serwis.deactivatePerson(osoba.id, actor);

    assert.equal(audit.wpisy[0]!.action, 'person.deactivated');
    assert.deepEqual(audit.wpisy[0]!.changes?.isActive, { from: true, to: false });
  });

  it('powtórna dezaktywacja nie dorzuca drugiego wpisu', async () => {
    const { serwis, audit } = zAplikacja();
    const osoba = await serwis.createPerson(
      { firstName: 'Jan', lastName: 'Kowalski', email: 'j.k@firma.pl' },
      actor,
    );
    await serwis.deactivatePerson(osoba.id, actor);
    audit.wpisypierwszyReset();

    await serwis.deactivatePerson(osoba.id, actor);

    assert.equal(audit.wpisy.length, 0);
  });
});

describe('Dziennik zdarzeń — macierz', () => {
  it('nadanie zapisuje poziom i nazwę osoby', async () => {
    const { serwis, audit, aplikacja } = zAplikacja();

    await serwis.grantAccess(
      aplikacja.id,
      { email: 'j.k@firma.pl', firstName: 'Jan', lastName: 'Kowalski', department: 'IT', level: 'ADMIN' },
      actor,
    );

    const nadanie = audit.wpisy.filter((w) => w.action === 'access.granted');
    assert.equal(nadanie.length, 1);
    assert.equal(nadanie[0]!.entity, 'ApplicationAccess');
    assert.equal(nadanie[0]!.changes?.level?.to, 'ADMIN');
    assert.equal(nadanie[0]!.changes?.person?.to, 'Jan Kowalski (IT)');
  });

  it('zmiana poziomu zapisuje różnicę, a nie cały wiersz', async () => {
    const { serwis, audit, aplikacja } = zAplikacja();
    const grant = await serwis.grantAccess(
      aplikacja.id,
      { email: 'j.k@firma.pl', firstName: 'Jan', lastName: 'Kowalski' },
      actor,
    );
    audit.wpisypierwszyReset();

    await serwis.updateGrant(aplikacja.id, grant.personId, { level: 'READ_ONLY' }, actor);

    const zmiana = audit.wpisy.filter((w) => w.action === 'access.updated');
    assert.equal(zmiana.length, 1);
    assert.deepEqual(zmiana[0]!.changes?.level, { from: 'USER', to: 'READ_ONLY' });
  });

  it('odebranie dostępu zapisuje nazwę osoby po stronie „od"', async () => {
    const { serwis, audit, aplikacja } = zAplikacja();
    const grant = await serwis.grantAccess(
      aplikacja.id,
      { email: 'j.k@firma.pl', firstName: 'Jan', lastName: 'Kowalski' },
      actor,
    );
    audit.wpisypierwszyReset();

    await serwis.revokeGrant(aplikacja.id, grant.personId, actor);

    const wplycie = audit.wpisy.filter((w) => w.action === 'access.revoked');
    assert.equal(wplycie.length, 1);
    assert.equal(wplycie[0]!.changes?.person?.from, 'Jan Kowalski');
    assert.equal(wplycie[0]!.changes?.person?.to, null);
  });
});

describe('Etykiety pól macierzy w interfejsie', () => {
  it('nowe pola mają polskie nazwy', () => {
    const etykiety = read('apps', 'web', 'src', 'lib', 'audit-fields.ts');
    for (const [pole, etykieta] of [
      ['level', 'poziom dostępu'],
      ['expiresOn', 'data wygaśnięcia'],
      ['grantedOn', 'data nadania'],
      ['note', 'notatka'],
      ['firstName', 'imię'],
      ['lastName', 'nazwisko'],
      ['position', 'stanowisko'],
      ['department', 'dział'],
    ] as const) {
      assert.ok(
        etykiety.includes(`${pole}: '${etykieta}'`),
        `brak etykiety ${pole}: ${etykieta}`,
      );
    }
  });
});