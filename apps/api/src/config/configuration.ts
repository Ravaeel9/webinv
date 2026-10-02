import { registerAs } from '@nestjs/config';

/**
 * Walidacja zmiennych środowiskowych przy starcie.
 * Celowo rzucamy wyjątek — lepiej nie wstać niż wstać bez sekretu.
 */
function required(key: string): string {
  const value = process.env[key];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `Brak wymaganej zmiennej środowiskowej: ${key}. ` +
        `Sprawdź plik .env (wzorzec: .env.example).`,
    );
  }
  return value;
}

function bool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function int(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Zmienna ${key} musi być liczbą, otrzymano: ${raw}`);
  }
  return parsed;
}

/** Przeliczniki dla `duration()` — nazwa jednostki na milisekundy. */
const UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Czas w postaci czytelnej (`15m`) na milisekundy.
 *
 * `@Throttle` przyjmuje `ttl` wyłącznie jako liczbę milisekund — sam
 * niczego nie parsuje. Dzięki temu `.env` może mieć
 * `LOGIN_RATE_LIMIT_WINDOW=15m`, a do dekoratora trafia `900000`.
 *
 * Zła wartość to wyjątek przy starcie, nie cicha awaria przy pierwszym
 * zgłoszeniu limitu (gdzie objawiłaby się jako natychmiastowe blokowanie
 * albo brak blokowania w ogóle).
 */
function duration(key: string, fallback: string): number {
  const raw = (process.env[key] ?? fallback).trim();
  const match = /^(\d+)\s*(ms|s|m|h|d)$/.exec(raw);
  if (!match) {
    throw new Error(
      `Zmienna ${key} musi mieć format liczba+jednostka ` +
        `(np. 15m, 30s, 1h, 7d), otrzymano: ${raw}`,
    );
  }
  return Number.parseInt(match[1], 10) * UNITS[match[2]];
}

/**
 * Limit żądań na logowanie — w formacie akceptowanym przez `@Throttle`.
 *
 * Liczony na poziomie modułu, a nie w fabryce `appConfig`: `@Throttle`
 * czyta wartości w momencie dekorowania kontrolera, czyli przy imporcie
 * pliku, zanim `ConfigService` w ogóle istnieje. Ta sama stała musi
 * więc być widoczna dla obu miejsc.
 */
export const loginRateLimit = {
  limit: int('LOGIN_RATE_LIMIT_MAX', 10),
  ttlMs: duration('LOGIN_RATE_LIMIT_WINDOW', '15m'),
};

export const appConfig = registerAs('app', () => {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';

  return {
    nodeEnv,
    isProd,
    port: int('PORT', 3000),
    corsOrigins: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    seed: {
      username: process.env.SEED_ADMIN_USERNAME ?? 'admin',
      email: process.env.SEED_ADMIN_EMAIL ?? 'admin@firma.local',
      password: required('SEED_ADMIN_PASSWORD'),
      fullName: process.env.SEED_ADMIN_FULLNAME ?? 'Administrator Systemu',
    },
    loginRateLimit,
  };
});

export const dbConfig = registerAs('db', () => ({
  url: required('DATABASE_URL'),
}));

export const sessionConfig = registerAs('session', () => {
  const secret = required('SESSION_SECRET');
  if (secret.length < 32) {
    throw new Error(
      'SESSION_SECRET musi mieć co najmniej 32 znaki. ' +
        'Wygeneruj: openssl rand -hex 32',
    );
  }
  return {
    secret,
    ttlDays: int('SESSION_TTL_DAYS', 7),
    cookieSecure: bool('COOKIE_SECURE', false),
    cookieName: 'webinv_sid',
  };
});
