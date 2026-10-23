/**
 * Twarde usuwanie osoby — przycisk, do którego dotąd nie było wejścia.
 *
 * DELETE /access/persons/:id robił dotąd dezaktywację, a dezaktywacja
 * zatrzymuje e-mail w katalogu: adres jest unikalny, więc błędnie
 * wydaną osobę nie dało się usunąć i utworzyć ponownie. Schema zresztą
 * przewiduje twarde kasowanie (kaskada grantów przy osobie, komentarz
 * „przy naprawdę błędnym wpisie"), brakowało tylko endpointu i UI.
 *
 * Reguły rozgraniczenia, które tu pilnujemy:
 *
 *  - **DELETE kasuje**, kaskadowo z przypisaniami — tak jak każe baza
 *    (`onDelete: Cascade` przy `ApplicationAccess.person`).
 *  - **Dezaktywacja idzie PATCH-em** (`isActive: false`) — to wciąż
 *    domyślna droga dla osoby, która odchodzi z organizacji: ona ma
 *    zostawić przypisania czytelne.
 *  - **Dziennik ma migawkę kasowanej osoby** — po usunięciu nie ma już
 *    wiersza w katalogu, więc tylko wpis `person.deleted` mówi, kogo
 *    usunięto i ile przypisań z nim zniknęło.
 */
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { NotFoundException } from '@nestjs/common';
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

const JAN = { firstName: 'Jan', lastName: 'Kowalski', email: 'jan.kowalski@firma.pl' };

function świadek() {
  const aplikacja = { id: randomUUID(), name: 'System kadrowy', deletedAt: null };
  const db = fakeDb([aplikacja]);
  const audit = fakeAudit();
  return {
    ...db,
    audit,
    serwis: new AccessService(db.port, audit as never),
    aplikacja,
  };
}

describe('Usuwanie osoby — DELETE /access/persons/:id', () => {
  it('usuwa osobę z katalogu, nie tylko ją wyłącza', async () => {
    const { port, serwis } = świadek();
    const osoba = await serwis.createPerson(JAN, actor);

    await serwis.deletePerson(osoba.id, actor);

    assert.deepEqual(await serwis.listPersons({}), []);
    assert.equal(await port.person.findUnique({ where: { id: osoba.id } }), null);
  });

  it('po usunięciu e-mail jest wolny — można utworzyć osobę ponownie', async () => {
    const { port, serwis } = świadek();
    const osoba = await serwis.createPerson(JAN, actor);
    await serwis.deletePerson(osoba.id, actor);

    const ponowna = await serwis.createPerson(JAN, actor);

    assert.notEqual(ponowna.id, osoba.id);
    assert.equal(await port.person.count({}), 1);
  });

  it('kaskadowo czyści przypisania osoby', async () => {
    const { serwis, audit, granty, aplikacja } = świadek();
    const grant = await serwis.grantAccess(
      aplikacja.id,
      { ...JAN },
      actor,
    );
    assert.equal(granty.length, 1);
    audit.wpisypierwszyReset();

    await serwis.deletePerson(grant.personId, actor);

    assert.equal(granty.length, 0, 'przypisania kasują się razem z osobą');
  });

  it('zapisuje person.deleted z migawką osoby i liczbą przypisań', async () => {
    const { serwis, audit, aplikacja } = świadek();
    const osoba = await serwis.createPerson(JAN, actor);
    await serwis.grantAccess(aplikacja.id, { ...JAN }, actor);
    audit.wpisypierwszyReset();

    await serwis.deletePerson(osoba.id, actor);

    assert.equal(audit.wpisy.length, 1);
    const wpis = audit.wpisy[0]!;
    assert.equal(wpis.action, 'person.deleted');
    assert.equal(wpis.entity, 'Person');
    assert.equal(wpis.entityId, osoba.id);
    assert.equal(wpis.changes?.fullName?.from, 'Jan Kowalski');
    assert.equal(wpis.changes?.fullName?.to, null, 'osoby nie ma już w katalogu');
    assert.equal(wpis.changes?.email?.from, 'jan.kowalski@firma.pl');
    assert.equal(wpis.changes?.accessCount?.to, 1, 'wiazana liczba przypisań');
  });

  it('nieistniejąca osoba to 404 i bez wpisu w dzienniku', async () => {
    const { serwis, audit } = świadek();

    await assert.rejects(() => serwis.deletePerson(randomUUID(), actor), NotFoundException);
    assert.equal(audit.wpisy.length, 0);
  });

  it('kontroler woła twarde usuwanie, nie dezaktywację', () => {
    const zrodlo = read('apps', 'api', 'src', 'access', 'access.controller.ts');
    const trasa = zrodlo.match(/@Delete\('persons\/:id'\)[\s\S]*?\n\}/);
    assert.ok(trasa, 'brak trasy DELETE persons/:id');
    assert.ok(
      trasa[0].includes('deletePerson'),
      'DELETE persons/:id ma wołać deletePerson (twarde usuwanie)',
    );
    assert.ok(!trasa[0].includes('deactivatePerson'), 'stara dezaktywacja nie może zostać na DELETE');
  });
});

describe('Dezaktywacja — PATCH isActive:false', () => {
  it('updatePerson z isActive:false zapisuje person.deactivated', async () => {
    const { serwis, audit } = świadek();
    const osoba = await serwis.createPerson(JAN, actor);
    audit.wpisypierwszyReset();

    const po = await serwis.updatePerson(osoba.id, { isActive: false }, actor);

    assert.equal(po.isActive, false);
    assert.equal(audit.wpisy.length, 1);
    assert.equal(audit.wpisy[0]!.action, 'person.deactivated');
    assert.deepEqual(audit.wpisy[0]!.changes?.isActive, { from: true, to: false });
  });

  it('ponowne isActive:false nie zapisuje niczego', async () => {
    const { serwis, audit } = świadek();
    const osoba = await serwis.createPerson(JAN, actor);
    await serwis.updatePerson(osoba.id, { isActive: false }, actor);
    audit.wpisypierwszyReset();

    await serwis.updatePerson(osoba.id, { isActive: false }, actor);

    assert.equal(audit.wpisy.length, 0, 'bez zmiany nie ma wpisu');
  });

  it('reaktywacja zapisuje person.activated', async () => {
    const { serwis, audit } = świadek();
    const osoba = await serwis.createPerson(JAN, actor);
    await serwis.updatePerson(osoba.id, { isActive: false }, actor);
    audit.wpisypierwszyReset();

    const po = await serwis.updatePerson(osoba.id, { isActive: true }, actor);

    assert.equal(po.isActive, true);
    assert.equal(audit.wpisy[0]!.action, 'person.activated');
    assert.deepEqual(audit.wpisy[0]!.changes?.isActive, { from: false, to: true });
  });
});

describe('Warstwa interfejsu — usuwanie osoby', () => {
  const strona = read('apps', 'web', 'src', 'pages', 'PersonDetailPage.tsx');
  const hooks = read('apps', 'web', 'src', 'lib', 'queries-access.ts');
  const format = read('apps', 'web', 'src', 'lib', 'format.ts');

  it('strona osoby ma przycisk „Usuń" wołany przez useDeletePerson', () => {
    assert.ok(
      strona.includes('useDeletePerson'),
      'PersonDetailPage musi wołać useDeletePerson — inaczej hook umiera po cichu',
    );
    assert.ok(
      /variant="danger"/.test(strona),
      'przycisk usuwania osoby ma wygląd destrukcyjny (variant danger)',
    );
    assert.ok(
      />\s*Usuń\s*</.test(strona),
      'przycisk ma polską etykietę Usuń (destrukcyjny wygląd i modal dodatkowo potwierdzają)',
    );
  });

  it('usuwanie idzie przez modal potwierdzenia i wraca do katalogu', () => {
    assert.ok(
      strona.includes("navigate('/uprawnienia'"),
      'po usunięciu strona osoby prowadzi z powrotem do katalogu osób',
    );
    // Twarde kasowanie zabiera przypisania razem z osobą — modal musi
    // to mówić wprost, to destrukcja większa niż dezaktywacja.
    assert.ok(
      strona.includes('przypisania'),
      'modal potwierdzenia ostrzega o tym, że usunięcie kasuje przypisania',
    );
  });

  it('dezaktywacja z UI idzie przez PATCH, nie przez DELETE osób', () => {
    const hook = hooks.match(/export function useDeactivatePerson\(\)\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    assert.ok(hook, 'hook useDeactivatePerson zniknął z queries-access.ts');
    assert.ok(
      hook.includes('api.patch'),
      'useDeactivatePerson ma wołać PATCH — DELETE osób to już twarde usunięcie',
    );
    assert.ok(
      !/api\.delete/.test(hook),
      'useDeactivatePerson nie może wołać DELETE osób',
    );
  });

  it('dziennik ma etykiety person.deleted i person.activated', () => {
    assert.ok(
      /'person\.deleted':\s*'Usunięto osobę/.test(format),
      'brak etykiety person.deleted w format.ts',
    );
    assert.ok(
      /'person\.activated':\s*'Aktywowano osobę/.test(format),
      'brak etykiety person.activated w format.ts',
    );
  });
});
