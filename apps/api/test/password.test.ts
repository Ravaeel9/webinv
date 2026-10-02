/**
 * Testy polityki haseł.
 *
 * Uruchomienie: npm test --workspace @webinv/api
 * Testy nie dotykają bazy — sprawdzają czystą logikę, więc można je
 * puszczać bez podniesionego stosu.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  MIN_PASSWORD_LENGTH,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  validatePasswordStrength,
  verifyPassword,
} from '../src/auth/password';

describe('validatePasswordStrength', () => {
  it('akceptuje hasło spełniające wszystkie wymagania', () => {
    const result = validatePasswordStrength('Bezpieczne!2026');
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  it('odrzuca za krótkie hasło', () => {
    const result = validatePasswordStrength('Aa1!aaa');
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.includes(String(MIN_PASSWORD_LENGTH))),
      `brak wzmianki o długości: ${result.errors.join(', ')}`,
    );
  });

  it('wymaga małej i wielkiej litery', () => {
    const result = validatePasswordStrength('bezposrednio1!');
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.includes('wielkiej litery')),
      `brak wzmianki o wielkiej literze: ${result.errors.join(', ')}`,
    );
  });

  it('wymaga cyfry', () => {
    const result = validatePasswordStrength('BezCyfr!abcdef');
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('cyfr')));
  });

  it('wymaga znaku specjalnego', () => {
    const result = validatePasswordStrength('BezSpecjalnego2026');
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.includes('specjalnego')),
      `brak wzmianki o znaku specjalnym: ${result.errors.join(', ')}`,
    );
  });

  it('odrzuca hasła zbyt popularne', () => {
    for (const weak of ['password123', 'Password123', 'zaq12wsx']) {
      const result = validatePasswordStrength(weak);
      assert.equal(result.ok, false, `"${weak}" nie powinno przejść`);
    }
  });

  it('odrzuca hasła dłuższe niż 200 znaków', () => {
    const result = validatePasswordStrength(`A1!${'a'.repeat(200)}`);
    assert.equal(result.ok, false);
  });

  it('nie zgłasza braków dla pustego hasła w komunikacie o popularności', () => {
    // Puste hasło jest błędne, ale nie powinno触发ować reguły „popularne"
    const result = validatePasswordStrength('');
    assert.equal(result.ok, false);
    assert.equal(
      result.errors.some((e) => e.includes('popularne')),
      false,
    );
  });
});

describe('hashPassword / verifyPassword', () => {
  // Uwaga na kolejność argumentów: verifyPassword(skrót, hasło).
  // Odwrócenie nie zgłasza błędu — po prostu weryfikuje nie to,
  // co myślimy. Kolejność wynika z tego, że skrót bywa null
  // (konto nie istnieje), a hasło zawsze jest.

  it('hasło poprawne po hashowaniu i weryfikacji', async () => {
    const hash = await hashPassword('Bezpieczne!2026');
    assert.equal(await verifyPassword(hash, 'Bezpieczne!2026'), true);
  });

  it('hasło błędne nie przechodzi weryfikacji', async () => {
    const hash = await hashPassword('Bezpieczne!2026');
    assert.equal(await verifyPassword(hash, 'Bezpieczne!2027'), false);
  });

  it('każde hashowanie daje inny skrót (sól jest losowa)', async () => {
    const first = await hashPassword('Bezpieczne!2026');
    const second = await hashPassword('Bezpieczne!2026');
    assert.notEqual(first, second);
    // ...ale oba poprawne
    assert.equal(await verifyPassword(first, 'Bezpieczne!2026'), true);
    assert.equal(await verifyPassword(second, 'Bezpieczne!2026'), true);
  });

  it('nie ujawnia hasła w skrócie', async () => {
    const hash = await hashPassword('Bezpieczne!2026');
    assert.equal(hash.includes('Bezpieczne'), false);
  });

  it('brak skrótu (konto nie istnieje) daje false', async () => {
    assert.equal(await verifyPassword(null, 'cokolwiek'), false);
    assert.equal(await verifyPassword(undefined, 'cokolwiek'), false);
    assert.equal(await verifyPassword('', 'cokolwiek'), false);
  });

  it('weryfikacja nie rzuca wyjątkiem dla uszkodzonego skrótu', async () => {
    // Uszkodzony skrót to niepoprawny format — funkcja ma zwrócić
    // „false", a nie wywrócić się (inaczej zepsute konto blokowałoby
    // logowanie błędem 500 zamiast komunikatem o złym haśle).
    assert.equal(await verifyPassword('nie-hash-argon2', 'cokolwiek'), false);
  });

  it('odrzuca hashowanie za krótkiego hasła', async () => {
    await assert.rejects(() => hashPassword('Krótkie1!'));
  });
});

describe('tokeny sesji', () => {
  it('generateSessionToken zwraca 64 znaki hex', () => {
    const token = generateSessionToken();
    assert.equal(token.length, 64);
    assert.match(token, /^[0-9a-f]{64}$/);
  });

  it('tokeny są losowe', () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => generateSessionToken()),
    );
    assert.equal(tokens.size, 50, 'tokeny powinny być unikalne');
  });

  it('hashSessionToken jest deterministyczny i nieodwracalny', () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    assert.equal(hashSessionToken(token), hash, 'ten sam token → ten sam skrót');
    assert.equal(hash.length, 64, 'SHA-256 hex to 64 znaki');
    assert.equal(hash.includes(token), false, 'skrót nie zawiera tokenu');
  });

  it('różne tokeny dają różne skróty', () => {
    const a = hashSessionToken(generateSessionToken());
    const b = hashSessionToken(generateSessionToken());
    assert.notEqual(a, b);
  });
});

describe('hashSessionToken', () => {
  it('jest deterministyczny', () => {
    // Skrót służy do indeksowania w bazie, więc ten sam token musi
    // zawsze dawać ten sam skrót.
    assert.equal(hashSessionToken('abc123'), hashSessionToken('abc123'));
  });

  it('nie da się odwrócić — z tokenu nie odzyskamy oryginału', () => {
    // W bazie trzymamy wyłącznie skrót, więc przejęcie bazy nie daje
    // gotowych ciasteczek sesyjnych.
    const hash = hashSessionToken('abc123');
    assert.notEqual(hash, 'abc123');
    assert.equal(hash.length, 64, 'sha256 hex to 64 znaki');
  });

  it('różne tokeny dają różne skróty', () => {
    assert.notEqual(hashSessionToken('a'), hashSessionToken('b'));
  });
});
