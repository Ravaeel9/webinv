/**
 * Walidacja ładunku przy cofnięciu sesji.
 *
 * `@Body('sessionId')` bez DTO przepuszcza `undefined`, a Prisma ignoruje
 * `undefined` w `where` — przez co `deleteMany({ where: { id: undefined,
 * userId } })` kasował WSZYSTKIE sesje użytkownika i zwracało 200.
 * Pusty payload musi więc być odrzucony walidacją, zanim trafi do bazy.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RevokeSessionDto } from '../src/auth/dto/auth.dto';

// Bez tego bramki test zwracałby fałszywe „przechodzi": `plainToInstance`
// z nieznaną klasą nie rzuca, a `validate` odpowiada komunikatem
// „an unknown value…", który zaspokajałoby `errors.length > 0`.
assert.equal(
  typeof RevokeSessionDto,
  'function',
  'RevokeSessionDto musi istnieć — inaczej te testy nic nie sprawdzają',
);

async function validateBody(body: unknown) {
  const dto = plainToInstance(RevokeSessionDto, body ?? {});
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('RevokeSessionDto', () => {
  it('odrzuca całkowicie pusty payload', async () => {
    // Bez tego `sessionId` było undefined i deleteMany kasował wszystkie sesje.
    const errors = await validateBody({});
    assert.ok(errors.length > 0, 'pusty payload musi dać błąd walidacji');
  });

  it('odrzuca brak sessionId', async () => {
    const errors = await validateBody({ cosInnego: 'x' });
    assert.ok(errors.length > 0);
  });

  it('odrzuca sessionId, które nie jest UUID', async () => {
    const errors = await validateBody({ sessionId: 'nie-uuid' });
    assert.ok(errors.length > 0);
  });

  it('odrzuca sessionId będące pustym stringiem', async () => {
    const errors = await validateBody({ sessionId: '' });
    assert.ok(errors.length > 0);
  });

  it('akceptuje poprawny UUID', async () => {
    // Kanoniczny UUID v4 (jak z `gen_random_uuid()` w Postgresie).
    // Uwaga: walidator sprawdza bity wariantu, nie sam znak wersji —
    // UUID z „4" na pozycji 14 ale złym wariantem jest odrzucany.
    const errors = await validateBody({
      sessionId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    });
    assert.deepEqual(errors, []);
  });
});