/**
 * Licznik katalogu osób — pasek podsumowania na /uprawnienia.
 *
 * Lista osób jest filtrowana (szukaj/dział/nieaktywne), więc nie da się
 * z niej odczytać globalnego stanu bazy. Pasek pod katalogiem ma
 * odpowiadać na pytanie „ile osób w ogóle mamy" — dlatego licznik
 * przychodzi osobnym endpointem (SQL COUNT), niezależnym od filtrów:
 * baza liczy, a nie serwis.
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

describe('Licznik katalogu osób', () => {
  it('raportuje total, active i inactive niezależnie od filtrów listy', async () => {
    const { port } = fakeDb();
    const serwis = new AccessService(port, fakeAudit() as never);

    await serwis.createPerson(
      { firstName: 'Jan', lastName: 'Kowalski', email: 'j.k@firma.pl' },
      actor,
    );
    await serwis.createPerson(
      { firstName: 'Ewa', lastName: 'Nowak', email: 'e.n@firma.pl' },
      actor,
    );
    const nieaktywna = await serwis.createPerson(
      { firstName: 'Piotr', lastName: 'Zolz', email: 'p.z@firma.pl' },
      actor,
    );
    await serwis.updatePerson(nieaktywna.id, { isActive: false }, actor);

    const licznik = await serwis.licznikOsob();

    assert.equal(licznik.total, 3);
    assert.equal(licznik.active, 2);
    assert.equal(licznik.inactive, 1);
  });

  it('pusty katalog to zera, nie undefined', async () => {
    const { port } = fakeDb();
    const serwis = new AccessService(port, fakeAudit() as never);

    const licznik = await serwis.licznikOsob();

    assert.deepEqual(licznik, { total: 0, active: 0, inactive: 0 });
  });

  it('kontroler: trasa persons/count jest przed persons/:id i wymaga access:read', () => {
    const zrodlo = read('apps', 'api', 'src', 'access', 'access.controller.ts');
    const pozycjaLicz = zrodlo.indexOf("@Get('persons/count')");
    const pozycjaId = zrodlo.indexOf("@Get('persons/:id')");

    assert.ok(pozycjaLicz !== -1, 'brak trasy persons/count');
    assert.ok(
      pozycjaLicz < pozycjaId,
      'persons/count musi być zarejestrowane przed persons/:id — inaczej :id zjada słowo count i ParseUUIDPipe odpowiada 400',
    );
    const blok = zrodlo.slice(pozycjaLicz, pozycjaId);
    assert.ok(
      blok.includes("@RequirePermission('access:read')"),
      'licznik jest odczytem katalogu — access:read',
    );
  });
});
