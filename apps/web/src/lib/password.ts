/**
 * Polityka haseł — lustrzane odbicie `validatePasswordStrength`
 * w apps/api/src/auth/password.ts.
 *
 * Powtórzenie jest celowe: serwer jest źródłem prawdy i waliduje
 * niezależnie, ale bez tej kopii użytkownik dowiadywałby się
 * o wymaganiach dopiero po wysłaniu formularza.
 */

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

/** Hasła zbyt popularne — serwer je odrzuca mimo długości. */
const WEAK_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'admin',
  'admin123',
  'administrator',
  'qwerty',
  '123456789012',
  'letmein12345',
  'changeme123',
  'zaq12wsx',
]);

/** Wymagania pokazywane pod polem hasła. */
export const PASSWORD_RULES = [
  `co najmniej ${MIN_PASSWORD_LENGTH} znaków`,
  'małą i wielką literę',
  'cyfrę',
  'znak specjalny',
] as const;

export interface PasswordCheck {
  ok: boolean;
  /** Lista braków — pusta, gdy hasło spełnia wymagania. */
  errors: string[];
  /** Dla podpowiedzi „wymaganie spełnione / brak". */
  met: Record<(typeof PASSWORD_RULES)[number], boolean>;
}

export function checkPassword(plain: string): PasswordCheck {
  const errors: string[] = [];

  if (plain.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Minimum ${MIN_PASSWORD_LENGTH} znaków.`);
  }
  if (plain.length > MAX_PASSWORD_LENGTH) {
    errors.push(`Maksymalnie ${MAX_PASSWORD_LENGTH} znaków.`);
  }
  if (plain.length > 0 && WEAK_PASSWORDS.has(plain.toLowerCase())) {
    errors.push('To hasło jest zbyt popularne — wybierz inne.');
  }

  const hasLower = /[a-z]/.test(plain);
  const hasUpper = /[A-Z]/.test(plain);
  const hasDigit = /[0-9]/.test(plain);
  const hasSpecial = /[^A-Za-z0-9]/.test(plain);

  if (!hasLower) errors.push('Wymaga małej litery.');
  if (!hasUpper) errors.push('Wymaga wielkiej litery.');
  if (!hasDigit) errors.push('Wymaga cyfry.');
  if (!hasSpecial) errors.push('Wymaga znaku specjalnego.');

  return {
    ok: errors.length === 0,
    errors,
    met: {
      [`co najmniej ${MIN_PASSWORD_LENGTH} znaków`]: plain.length >= MIN_PASSWORD_LENGTH,
      'małą i wielką literę': hasLower && hasUpper,
      cyfrę: hasDigit,
      'znak specjalny': hasSpecial,
    },
  };
}
