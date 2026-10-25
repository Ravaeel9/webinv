/**
 * Weryfikacja dostępów — rejestr przeglądów macierzy.
 *
 * Ewidencja uprawnień zapisuje nadania (`grantedOn`), ale nie przeglądy.
 * Do dowodu półrocznego przeglądu potrzebny jest wpis: kto, kiedy i co
 * potwierdził. Testy pilnują trzech rzeczy, bez których rejestr kłamałby:
 *
 *  - **Zakres stampuje granty.** Weryfikacja całą macierzą / aplikacją /
 *    pojedynczym grantem stawia `verifiedOn` wszystkim grantom w zasięgu —
 *    inaczej wiersze macierzy pokazywałyby „—" mimo przeprowadzonego
 *    przeglądu.
 *  - **Zmiana unieważnia potwierdzenie.** Weryfikacja potwierdziła stan;
 *    nowy grant albo zmiana poziomu nie mogą dziedziczyć czyjejś
 *    potwierdzonej daty.
 *  - **Historia przeżywa osobę i konto.** Wpisy trzymają migawki nazwisk,
 *    więc przegląd sprzed roku jest czytelny po odejściu osoby i kasie
 *    konta weryfikującego.
 */
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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

/** Dwie aplikacje z macierzą + jedna ogólnego użytku — do testu odsiewu. */
function baza() {
  const kadry = { id: randomUUID(), name: 'System kadrowy', deletedAt: null };
  const crm = { id: randomUUID(), name: 'CRM', deletedAt: null };
  const spis = { id: randomUUID(), name: 'Katalog firmowy', deletedAt: null, deliveryType: 'GENERAL_USE' };
  const { port, osoby, granty } = fakeDb([kadry, crm, spis]);
  return { port, osoby, granty, kadry, crm, spis };
}

/** Osoba z grantem w danej aplikacji — zwraca też id grantu. */
async function zGrantem(
  serwis: AccessService,
  granty: Array<{ applicationId: string; personId: string }>,
  aplikacja: { id: string },
  email = 'a.x@firma.pl',
) {
  await serwis.grantAccess(aplikacja.id, { email, firstName: 'Anna', lastName: 'X' }, actor);
  const grant = granty.find((g) => g.applicationId === aplikacja.id);
  return grant!.personId;
}

describe('AccessService — weryfikacja dostępów', () => {
  it('weryfikacja całej matrycy stampuje wszystkie granty, ale pomija GENERAL_USE', async () => {
    const { port, granty, kadry, crm, spis } = baza();
    const serwis = new AccessService(port, fakeAudit() as never);
    await serwis.grantAccess(kadry.id, { email: 'a@firma.pl', firstName: 'A', lastName: 'Kadry' }, actor);
    await serwis.grantAccess(crm.id, { email: 'b@firma.pl', firstName: 'B', lastName: 'Crm' }, actor);
    // Historyczny grant w aplikacji ogólnego użytku: dziś GENERAL_USE nie
    // przyjmuje grantów przez serwis, ale w bazie mogą zostać wiersze
    // sprzed zmiany typu — macierz je odsiewa i weryfikacja też musi.
    granty.push({
      applicationId: spis.id,
      personId: randomUUID(),
      level: 'USER',
      grantedOn: new Date('2026-01-01T00:00:00Z'),
      verifiedOn: null,
      expiresOn: null,
      note: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    const wpis = await serwis.createVerification({ scope: 'MATRIX' }, actor);

    assert.equal(wpis.scope, 'MATRIX');
    const zStampem = granty.filter((g) => g.verifiedOn !== null);
    assert.equal(zStampem.length, 2, 'stamp dostają granty kadry i CRM');
    assert.ok(
      granty.every((g) => (g.applicationId === spis.id ? g.verifiedOn === null : true)),
      'aplikacja ogólnego użytku nie bierze udziału w macierzy',
    );
    assert.equal(wpis.verifiedOn, dzis());
  });

  it('weryfikacja aplikacji stampuje tylko jej granty', async () => {
    const { port, granty, kadry, crm } = baza();
    const serwis = new AccessService(port, fakeAudit() as never);
    await serwis.grantAccess(kadry.id, { email: 'a@firma.pl', firstName: 'A', lastName: 'Kadry' }, actor);
    await serwis.grantAccess(crm.id, { email: 'b@firma.pl', firstName: 'B', lastName: 'Crm' }, actor);

    await serwis.createVerification({ scope: 'APPLICATION', applicationId: kadry.id }, actor);

    assert.ok(granty.find((g) => g.applicationId === kadry.id)!.verifiedOn, 'grant kadry stampowany');
    assert.equal(
      granty.find((g) => g.applicationId === crm.id)!.verifiedOn,
      null,
      'grant CRM nie może dostać cudzej weryfikacji',
    );
  });

  it('weryfikacja pojedynczego grantu stampuje jeden wiersz i trzyma nazwisko osoby', async () => {
    const { port, granty, kadry } = baza();
    const serwis = new AccessService(port, fakeAudit() as never);
    const a = await zGrantem(serwis, granty, kadry, 'a@firma.pl');
    await serwis.grantAccess(kadry.id, { email: 'b@firma.pl', firstName: 'B', lastName: 'Crm' }, actor);

    const wpis = await serwis.createVerification(
      { scope: 'GRANT', applicationId: kadry.id, personId: a, note: 'Potwierdzone z właścicielem' },
      actor,
    );

    const stampowane = granty.filter((g) => g.verifiedOn !== null);
    assert.equal(stampowane.length, 1, 'stamp dostaje tylko wskazany grant');
    assert.equal(stampowane[0]!.personId, a);
    assert.equal(wpis.personName, 'Anna X', 'migawka nazwiska w wpisie');
    assert.equal(wpis.note, 'Potwierdzone z właścicielem');
  });

  it('lista weryfikacji pokazuje historię od najnowszej, z nazwiskiem weryfikującego', async () => {
    const { port, kadry } = baza();
    const audit = fakeAudit();
    const serwis = new AccessService(port, audit as never);
    await serwis.grantAccess(kadry.id, { email: 'a@firma.pl', firstName: 'A', lastName: 'Kadry' }, actor);

    await serwis.createVerification(
      { scope: 'APPLICATION', applicationId: kadry.id, verifiedOn: '2026-01-10' },
      actor,
    );
    await serwis.createVerification({ scope: 'MATRIX', verifiedOn: '2026-06-01' }, actor);

    const { wpisy: historia } = await serwis.listVerifications({ applicationId: kadry.id });
    assert.equal(historia.length, 1, 'filtr aplikacji odsiewa weryfikację całej macierzy');
    assert.equal(historia[0]!.verifiedOn, '2026-01-10');
    assert.equal(historia[0]!.actorName, 'Anna Administrator');
    assert.deepEqual(
      historia[0]!.application,
      { id: kadry.id, name: 'System kadrowy' },
      'wpis aplikacji pokazuje jej nazwę — bez `include` relacja wypadła by z odpowiedzi',
    );

    const cala = await serwis.listVerifications({});
    assert.equal(cala.wpisy.length, 2);
    assert.equal(cala.wpisy[0]!.verifiedOn, '2026-06-01', 'najnowsza weryfikacja pierwsza');
  });

  it('zmiana poziomu grantu unieważnia weryfikację, zmiana notatki nie', async () => {
    const { port, granty, kadry } = baza();
    const serwis = new AccessService(port, fakeAudit() as never);
    const personId = await zGrantem(serwis, granty, kadry, 'a@firma.pl');
    await serwis.createVerification(
      { scope: 'GRANT', applicationId: kadry.id, personId },
      actor,
    );
    assert.ok(granty[0]!.verifiedOn, 'przed zmianą grant jest zweryfikowany');

    await serwis.updateGrant(kadry.id, personId, { note: 'przeniesiona notatka' }, actor);
    assert.ok(granty[0]!.verifiedOn, 'notatka nie unieważnia potwierdzenia');

    await serwis.updateGrant(kadry.id, personId, { level: 'ADMIN' }, actor);
    assert.equal(
      granty[0]!.verifiedOn,
      null,
      'zmiana poziomu = inny stan dostępu niż ten, który zweryfikowano',
    );
  });

  it('nowy grant nie wchodzi zweryfikowany, mimo wcześniejszego przeglądu aplikacji', async () => {
    const { port, granty, kadry } = baza();
    const serwis = new AccessService(port, fakeAudit() as never);
    await serwis.grantAccess(kadry.id, { email: 'a@firma.pl', firstName: 'A', lastName: 'Kadry' }, actor);
    await serwis.createVerification({ scope: 'APPLICATION', applicationId: kadry.id }, actor);

    const nowy = await serwis.grantAccess(
      kadry.id,
      { email: 'nowy@firma.pl', firstName: 'Nowy', lastName: 'PoPrzegladzie' },
      actor,
    );
    assert.equal(nowy.verifiedOn, null);
    assert.equal(
      granty.filter((g) => g.verifiedOn !== null).length,
      1,
      'stamp dostaje tylko grant z czasu przeglądu',
    );
  });

  it('weryfikacja w przyszłości i nieistniejące cele są odrzucane', async () => {
    const { port, kadry } = baza();
    const serwis = new AccessService(port, fakeAudit() as never);
    await serwis.grantAccess(kadry.id, { email: 'a@firma.pl', firstName: 'A', lastName: 'Kadry' }, actor);

    await assert.rejects(
      () => serwis.createVerification({ scope: 'MATRIX', verifiedOn: '2099-01-01' }, actor),
      BadRequestException,
      'data weryfikacji nie może być z przyszłości',
    );
    await assert.rejects(
      () => serwis.createVerification({ scope: 'APPLICATION', applicationId: 'brak' }, actor),
      NotFoundException,
    );
    await assert.rejects(
      () =>
        serwis.createVerification(
          { scope: 'GRANT', applicationId: kadry.id, personId: 'brak' },
          actor,
        ),
      NotFoundException,
    );
    // MATRIX z applicationId to sprzeczność — albo całość, albo zawężenie.
    await assert.rejects(
      () =>
        serwis.createVerification({ scope: 'MATRIX', applicationId: kadry.id }, actor),
      BadRequestException,
    );
  });

  it('macierz i granty zwracają datę weryfikacji jako tekst albo null', async () => {
    const { port, granty, kadry } = baza();
    const serwis = new AccessService(port, fakeAudit() as never);
    await zGrantem(serwis, granty, kadry, 'a@firma.pl');

    const przed = await serwis.listApplicationAccess(kadry.id);
    assert.equal(przed[0]!.verifiedOn, null, 'bez przeglądu — null');

    await serwis.createVerification(
      { scope: 'APPLICATION', applicationId: kadry.id, verifiedOn: '2026-05-01' },
      actor,
    );
    const po = await serwis.listApplicationAccess(kadry.id);
    assert.equal(po[0]!.verifiedOn, '2026-05-01');

    const macierz = await serwis.matrix({ applicationId: kadry.id });
    assert.equal(macierz[0]!.verifiedOn, '2026-05-01');
  });

  it('GENERAL_USE nie przyjmuje weryfikacji', async () => {
    const { port, spis } = baza();
    const serwis = new AccessService(port, fakeAudit() as never);
    await assert.rejects(
      () => serwis.createVerification({ scope: 'APPLICATION', applicationId: spis.id }, actor),
      BadRequestException,
    );
  });
});

function dzis(): string {
  return new Date().toISOString().slice(0, 10);
}
