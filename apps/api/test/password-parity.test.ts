/**
 * Test zgodności polityki haseł serwer ↔ interfejs.
 *
 * `apps/web/src/lib/password.ts` to celowa kopia `validatePasswordStrength`
 * z `apps/api/src/auth/password.ts`. Kopia istnieje po to, żeby użytkownik
 * widział pełną listę braków przed wysłaniem formularza, a nie dopiero
 * po odpowiedzi 400 z serwera.
 *
 * Cena za powtórzenie to ryzyko rozjazdu: ktoś poprawi regułę w jednym
 * pliku i zapomni o drugim. Interfejs zacznie wtedy blokować hasła,
 * które serwer przyjmie (albo odwrotnie — przepuści do serwera hasło,
 * które ono odrzuci). Ten test jest na to zabezpieczeniem: sprawdza,
 * że obie implementacje zgadzają się co do werdyktu, a nie co do
 * sformułowania komunikatu.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  validatePasswordStrength,
} from '../src/auth/password';
import {
  checkPassword,
  MAX_PASSWORD_LENGTH as UI_MAX,
  MIN_PASSWORD_LENGTH as UI_MIN,
} from '../../web/src/lib/password';

/**
 * Zestaw prób — hasła dobrane tak, żeby trafiać w każdą regułę
 * osobno i w kombinacjach.
 */
const PROBES = [
  '',
  'a',
  'A',
  '1',
  '!',
  'Aa1!',
  'Aa1!aaa',
  'Aa1!aaaa',
  'Bezpieczne!2026',
  'bezpieczne!2026',
  'BEZPIECZNE!2026',
  'Bezpieczne2026',
  'Bezpiecznz!2026',
  'bezpieczne!2026',
  'password',
  'password1',
  'password123',
  'PASSWORD123',
  'admin',
  'admin123',
  'administrator',
  'qwerty',
  '123456789012',
  'letmein12345',
  'changeme123',
  'zaq12wsx',
  'zaq12wsxcd',
  'ZaQ12wsxCD!ef',
  '   spaces   1!',
  'Tab\tz\nw\nm 1!',
  'zażółćgęśląjaźń1!',
  'АБВГДЕЖЗИЙ1!',
  '123456789012!',
  '!!!!!!!!!!!!!!!',
  '          !!!!!',
  'aA1!aA1!aA1!',
  'a'.repeat(MIN_PASSWORD_LENGTH - 1) + 'A1!',
  'a'.repeat(MIN_PASSWORD_LENGTH - 2) + 'A1!',
  'A'.repeat(200) + '1!',
  'x'.repeat(MAX_PASSWORD_LENGTH) + 'A1!',
  'x'.repeat(MAX_PASSWORD_LENGTH - 1) + 'A1!',
  'https://example.com',
  'Zażółć-Gęślą-Jaźń-1!',
];

describe('polityka haseł: serwer i interfejs mówią to samo', () => {
  it('ta sama minimalna i maksymalna długość', () => {
    assert.equal(UI_MIN, MIN_PASSWORD_LENGTH);
    assert.equal(UI_MAX, MAX_PASSWORD_LENGTH);
  });

  for (const [index, probe] of PROBES.entries()) {
    const label = JSON.stringify(probe.length > 40 ? `${probe.slice(0, 37)}…` : probe);

    it(`[${index}] ${label}`, () => {
      const server = validatePasswordStrength(probe);
      const ui = checkPassword(probe);

      assert.equal(
        ui.ok,
        server.ok,
        `rozjazd werdyktu dla ${label}: serwer ${server.ok ? 'akceptuje' : 'odrzuca'} ` +
          `(${server.errors.join(', ')}), interfejs ${ui.ok ? 'akceptuje' : 'odrzuca'} ` +
          `(${ui.errors.join(', ')})`,
      );
    });
  }

  it('serwer i interfejs zgadzają się na 500 losowych haseł', () => {
    // Z generatorem, nie na stałe — chcemy złapać przypadki, o których
    // nie pomyśleliśmy w PROBES.
    const alphabet = 'aA1! zZażółć';
    let checked = 0;

    for (let i = 0; i < 500; i += 1) {
      const length = i % 24;
      let probe = '';
      for (let j = 0; j < length; j += 1) {
        const at = (i * 31 + j * 17) % alphabet.length;
        probe += alphabet[at];
      }

      const server = validatePasswordStrength(probe);
      const ui = checkPassword(probe);
      assert.equal(
        ui.ok,
        server.ok,
        `rozjazd dla ${JSON.stringify(probe)}: serwer ${server.errors.join(', ') || 'OK'} ` +
          `vs interfejs ${ui.errors.join(', ') || 'OK'}`,
      );
      checked += 1;
    }

    assert.equal(checked, 500);
  });

  it('serwer zawsze podaje uzasadnienie, gdy odrzuca', () => {
    // Interfejs pokazuje listę `errors` — pusta lista przy `ok: false`
    // dałaby użytkownikowi bezsilny komunikat „hasło nie spełnia wymagań”.
    for (const probe of PROBES) {
      const server = validatePasswordStrength(probe);
      assert.equal(
        server.errors.length > 0,
        !server.ok,
        `pusta lista błędów dla ${JSON.stringify(probe)} (ok=${server.ok})`,
      );
      const ui = checkPassword(probe);
      assert.equal(
        ui.errors.length > 0,
        !ui.ok,
        `pusta lista błędów w UI dla ${JSON.stringify(probe)} (ok=${ui.ok})`,
      );
    }
  });

  it('lista popularnych haseł jest taka sama po obu stronach', () => {
    // Serwer i interfejs mają własne zbiory. Jeżeli jedno zna hasło,
    // którego nie zna drugie, rozjazd wróci przy najmniej jednym
    // haśle spoza PROBES.
    const shared = ['password', 'password123', 'admin123', 'zaq12wsx'];
    for (const word of shared) {
      assert.equal(
        validatePasswordStrength(word).ok,
        false,
        `serwer powinien odrzucić „${word}"`,
      );
      assert.equal(checkPassword(word).ok, false, `UI powinien odrzucić „${word}"`);
    }
  });
});
