/**
 * Ustawienia panelu: sesje konta i stan trybu demonstracyjnego.
 */
export interface SessionInfo {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

/**
 * Stan trybu demonstracyjnego.
 *
 * `source` mówi, skąd wzięła się odpowiedź: `db` — z wpisu w panelu,
 * `env` — z `SEED_DEMO_APPS`, bo nikt jeszcze w panelu nie decydował.
 * Pokazujemy to w interfejsie, żeby administrator wiedział, że przełącznik
 * podczas restartu kontenera zostanie zignorowany.
 */
export type DemoModeState = {
  enabled: boolean;
  source: 'db' | 'env';
  recordCount: number;
};

