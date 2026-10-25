/**
 * Schemat macierzy uprawnień — pilnowany na tekście `schema.prisma`.
 *
 * Ten test nie podnosi bazy (żadna nie jest potrzebna do migracji), ale
 * pilnuje rzeczy, których nie widać w kodzie serwisu: unikalności e-maila,
 * klucza złożonego przypisania i kaskad. `prisma migrate` wymagałby bazy,
 * a schema ma być możliwa do sprawdzenia w każdym checkoutcie.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { read } from './helpers/repo';

const schemat = read('apps', 'api', 'prisma', 'schema.prisma');

function model(nazwa: string): string {
  return schemat.match(new RegExp(`model ${nazwa} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? '';
}

describe('Schemat: persons i application_access', () => {
  it('Person ma wymagane dane, wolne stanowisko i dział oraz unikalny e-mail', () => {
    const person = model('Person');
    assert.match(person, /firstName\s+String\s+@map\("first_name"\)/);
    assert.match(person, /lastName\s+String\s+@map\("last_name"\)/);
    // `@db.Citext` nie jest tu ozdobą: unikalność ma działać dla
    // `Jan.Kowalski@firma.pl` i `jan.kowalski@firma.pl` jednacznie.
    assert.match(person, /email\s+String\s+@unique @db\.Citext/);
    assert.match(person, /position\s+String\?/);
    assert.match(person, /department\s+String\?/);
    assert.match(person, /isActive\s+Boolean\s+@default\(true\)/);
  });

  it('ApplicationAccess jest kluczem złożonym z poziomem, datami i uwagą', () => {
    const grant = model('ApplicationAccess');
    assert.match(grant, /level\s+AccessLevel\s+@default\(USER\)/);
    assert.match(grant, /grantedOn\s+DateTime\s+@default\(now\(\)\)/);
    assert.match(grant, /expiresOn\s+DateTime\?/);
    assert.match(grant, /note\s+String\?/);
    assert.match(grant, /@@id\(\[applicationId, personId\]\)/);
    assert.match(grant, /@@index\(\[personId\]\)/);
    assert.match(grant, /@@index\(\[expiresOn\]\)/);
  });

  it('oba wiersze kasują się razem z rodzicem', () => {
    const grant = model('ApplicationAccess');
    // Tylko linie relacji: w komentarzu pojawia się nazwa `onDelete`,
    // więc liczenie wystąpień w całym modelu policzyłoby ją podwójnie.
    const relacje = grant
      .split('\n')
      .filter((linia) => /@relation\(/.test(linia));
    assert.equal(relacje.length, 2, 'oczekiwano relacji do aplikacji i do osoby');
    for (const linia of relacje) {
      assert.match(linia, /onDelete: Cascade/);
    }
  });

  it('ApplicationAccess ma opcjonalny znacznik weryfikacji', () => {
    const grant = model('ApplicationAccess');
    // `verifiedOn` to data ostatniego przeglądu — null znaczy „nigdy
    // nie zweryfikowano". Nowy grant nie może wchodzić zweryfikowany.
    assert.match(grant, /verifiedOn\s+DateTime\?/);
  });

  it('AccessVerification rejestruje zakres, datę, aktora i migawkę nazwiska', () => {
    const weryfikacja = model('AccessVerification');
    assert.match(weryfikacja, /scope\s+VerificationScope/);
    assert.match(weryfikacja, /verifiedOn\s+DateTime\s+@map\("verified_on"\)/);
    assert.match(weryfikacja, /note\s+String\?/);
    // Aktor jak w AuditLog: relacja SetNull + migawka nazwiska —
    // historia przeglądów przeżywa konto weryfikującego i osobę.
    assert.match(weryfikacja, /actorName\s+String\?/);
    assert.match(weryfikacja, /personName\s+String\?/);
    assert.match(weryfikacja, /applicationId\s+String\?/);
    assert.match(weryfikacja, /personId\s+String\?/);
    assert.match(schemat, /enum VerificationScope \{[\s\S]*?MATRIX[\s\S]*?APPLICATION[\s\S]*?GRANT[\s\S]*?\n\}/);
  });

  it('enum AccessLevel ma dokładnie cztery poziomy', () => {
    const e = schemat.match(/enum AccessLevel \{[\s\S]*?\n\}/)?.[0] ?? '';
    for (const poziom of ['OWNER', 'ADMIN', 'USER', 'READ_ONLY']) {
      assert.match(e, new RegExp(`\\b${poziom}\\b`));
    }
    assert.equal((e.match(/^\s+[A-Z_]+/gm) ?? []).length, 4);
  });

  it('Application deklaruje relację do przypisań', () => {
    assert.match(
      model('Application'),
      /accessGrants\s+ApplicationAccess\[\] @relation\("AppAccess"\)/,
    );
  });
});