import { randomBytes, createHash } from 'node:crypto';
import * as argon2 from 'argon2';

// Argon2id — kompromis między odpornością na GPU a zużyciem RAM.
// Parametry celują w ~50-80 ms na weryfikację na przeciętnym serwerze.
const ARGON2_OPTIONS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

/** Minimalna długość hasła. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Maksymalna długość hasła.
 *
 * Górna granica chroni przed dwoma rzeczami na raz: bardzo długie
 * wejście w argon2 (koszt) oraz bardzo długie ciągi w komunikatach
 * walidacji i w dzienniku zdarzeń.
 */
export const MAX_PASSWORD_LENGTH = 200;

/**
 * Hashuje hasło. Zawsze zwraca gotowy hash — nigdy nie zwracaj
 * hasła w postaci jawnej poza `seed`.
 */
export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków.`,
    );
  }
  return argon2.hash(plain, ARGON2_OPTIONS);
}

/**
 * Weryfikuje hasło w bezpieczny sposób.
 *
 * Jeśli użytkownik nie istnieje, wciąż wykonujemy kosztowną operację
 * na atrapie — dzięki temu czas odpowiedzi nie zdradza, czy konto istnieje.
 */
export async function verifyPassword(
  hash: string | null | undefined,
  plain: string,
): Promise<boolean> {
  if (!hash) {
    // Dekoy — tyle samo kosztu co prawdziwa weryfikacja
    await argon2.verify(
      '$argon2id$v=19$m=19456,t=2,p=1$YWJjZGVmZ2hpamts$b3BhcXVlZHVta2R1bW15Y2hhbmdlMTIzNA',
      plain,
    ).catch(() => false);
    return false;
  }
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** Losowy token sesji (32 bajty → 64 znaki hex). */
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Skrót tokenu sesji — w bazie trzymamy wyłącznie to.
 * Nawet przy wycieku bazy nie da się podszyć pod istniejącą sesję.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}



/** Typowe hasła, których nie przyjmujemy nawet jeśli są długie. */
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

/** Weryfikacja siły hasła — komunikaty po polsku, gotowe do pokazania w UI. */
export function validatePasswordStrength(plain: string): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (plain.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Minimum ${MIN_PASSWORD_LENGTH} znaków.`);
  }
  if (plain.length > MAX_PASSWORD_LENGTH) {
    errors.push(`Maksimum ${MAX_PASSWORD_LENGTH} znaków.`);
  }
  if (WEAK_PASSWORDS.has(plain.toLowerCase())) {
    errors.push('To hasło jest zbyt popularne — wybierz inne.');
  }
  if (!/[a-z]/.test(plain)) errors.push('Wymaga małej litery.');
  if (!/[A-Z]/.test(plain)) errors.push('Wymaga wielkiej litery.');
  if (!/[0-9]/.test(plain)) errors.push('Wymaga cyfry.');
  if (!/[^A-Za-z0-9]/.test(plain)) {
    errors.push('Wymaga znaku specjalnego.');
  }

  return { ok: errors.length === 0, errors };
}
