/**
 * Szyfrowanie sekretów GLPI w tabeli `settings`.
 *
 * Poświadczenia do API GLPI (client secret, hasło OAuth, token osobisty)
 * nie mogą leżeć w bazie jawnym tekstem — tabela `settings` to zwykły
 * klucz/wartość, którą każdy z dostępem do bazy czyta `SELECT`-em.
 * Klucz szyfrowania wyprowadzamy z `SESSION_SECRET`, który i tak jest
 * wymagany przy starcie, więc nie dokłada nowej zmiennej środowiskowej.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { szyfruj, odszyfruj } from '../src/glpi/glpi-crypto';

const SEKRET = 'a'.repeat(32);

describe('glpi-crypto', () => {
  it('szyfruje i odszyfrowuje tekst bez utraty treści', () => {
    const jawne = '717e22fcbbb4422bda326a27dab7234019de30f522104d6f3207b5d605b219c7';
    const zaszyfrowane = szyfruj(jawne, SEKRET);

    assert.notEqual(zaszyfrowane, jawne, 'szyfrogram nie może być jawnym tekstem');
    assert.equal(odszyfruj(zaszyfrowane, SEKRET), jawne);
  });

  it('ten sam tekst daje różne szyfrogramy (losowa sól IV)', () => {
    const a = szyfruj('to samo hasło', SEKRET);
    const b = szyfruj('to samo hasło', SEKRET);

    assert.notEqual(a, b, 'powtarzalny IV pozwalałby porównywać sekrety po szyfrogramie');
    assert.equal(odszyfruj(a, SEKRET), 'to samo hasło');
    assert.equal(odszyfruj(b, SEKRET), 'to samo hasło');
  });

  it('odszyfrowanie innym kluczem rzuca czytelny błąd, nie śmieci', () => {
    const zaszyfrowane = szyfruj('hasło', SEKRET);

    assert.throws(() => odszyfruj(zaszyfrowane, 'b'.repeat(32)), /Nie można odszyfrować/);
  });

  it('śmieci zamiast szyfrogramu rzucają czytelny błąd', () => {
    assert.throws(() => odszyfruj('nie-jest-szyfrogramem', SEKRET), /Nie można odszyfrować/);
    assert.throws(() => odszyfruj('', SEKRET), /Nie można odszyfrować/);
  });

  it('pusty tekst jest odrzucany — nie ma czego szyfrować', () => {
    assert.throws(() => szyfruj('', SEKRET), /pusty/);
  });
});
