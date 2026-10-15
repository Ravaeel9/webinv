/**
 * DTO macierzy — walidacja wejścia, zanim cokolwiek trafi do logiki.
 *
 * Dwa przypadki, których sama logika nie wyłapie:
 *
 *  - **Poziom spoza enumu.** `OWNER`/`ADMIN`/`USER`/`READ_ONLY` to wartości
 *    z bazy; cokolwiek innego musi zostać odrzucone, zanim zapisze się
 *    wiersz, którego interfejs nie umie wyświetlić.
 *  - **Data w złym formacie.** `31-12-2026` przeszedłoby `new Date()` z
 *    wynikiem `Invalid Date` dopiero w serwisie — a serwis ma rzucać
 *    czytelny komunikat, nie `NaN`.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { read } from './helpers/repo';
import {
  CreatePersonDto,
  UpdatePersonDto,
  GrantAccessDto,
  UpdateGrantDto,
} from '../src/access/dto/access.dto';

async function bledy(dto: object, cls: new () => object): Promise<string[]> {
  const instancja = plainToInstance(cls as never, dto);
  const wynik = await validate(instancja as object, { whitelist: true, forbidNonWhitelisted: true });
  return wynik.flatMap((blad) => Object.values(blad.constraints ?? {}));
}

describe('DTO matryzy uprawnień', () => {
  it('osoba wymaga imienia, nazwiska i poprawnego e-maila', async () => {
    assert.ok((await bledy({ firstName: '', lastName: 'X', email: 'a@f.pl' }, CreatePersonDto)).length > 0);
    assert.ok((await bledy({ firstName: 'A', lastName: 'X', email: 'nie-e-mail' }, CreatePersonDto)).length > 0);
    assert.equal((await bledy({ firstName: 'A', lastName: 'X', email: 'a@f.pl' }, CreatePersonDto)).length, 0);
  });

  it('stanowisko i dział mają limit 150 znaków', async () => {
    const zaDlugi = { firstName: 'A', lastName: 'X', email: 'a@f.pl', department: 'z'.repeat(151) };
    assert.ok((await bledy(zaDlugi, CreatePersonDto)).length > 0);
  });

  it('poziom spoza enumu jest odrzucany', async () => {
    const zly = { email: 'a@f.pl', firstName: 'A', lastName: 'X', level: 'GUEST' };
    assert.ok((await bledy(zly, GrantAccessDto)).length > 0);
    for (const poziom of ['OWNER', 'ADMIN', 'USER', 'READ_ONLY']) {
      const dobry = { email: 'a@f.pl', firstName: 'A', lastName: 'X', level: poziom };
      assert.equal((await bledy(dobry, GrantAccessDto)).length, 0, poziom);
    }
  });

  it('data wygasania musi być datą, a data w polskim formacie odrzucona', async () => {
    const zly = { email: 'a@f.pl', firstName: 'A', lastName: 'X', expiresOn: '31-12-2026' };
    assert.ok((await bledy(zly, GrantAccessDto)).length > 0);
    const dobry = { email: 'a@f.pl', firstName: 'A', lastName: 'X', expiresOn: '2026-12-31' };
    assert.equal((await bledy(dobry, GrantAccessDto)).length, 0);
  });

  it('nadanie dostępu wymaga e-maila — imię i nazwisko tylko przy nowej osobie', async () => {
    assert.ok((await bledy({ firstName: 'A', lastName: 'X' }, GrantAccessDto)).length > 0);
    // Istniejąca osoba z katalogu: e-mail wystarczy, reszta jest opcjonalna.
    assert.equal((await bledy({ email: 'a@f.pl' }, GrantAccessDto)).length, 0);
  });

  it('edycja przypisania przyjmuje tylko znane pola i czystą datę', async () => {
    assert.equal((await bledy({ level: 'ADMIN', note: 'x' }, UpdateGrantDto)).length, 0);
    assert.equal((await bledy({ expiresOn: null }, UpdateGrantDto)).length, 0);
    assert.ok((await bledy({ expiresOn: 'jutro' }, UpdateGrantDto)).length > 0);
  });

  it('edycja osoby nie przyjmuje pól spoza zestawu', async () => {
    assert.equal((await bledy({ lastName: 'Nowak' }, UpdatePersonDto)).length, 0);
    assert.ok((await bledy({ id: 'cokolwiek' }, UpdatePersonDto)).length > 0);
  });
});