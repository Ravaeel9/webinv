/**
 * Klient HTTP.
 *
 * Wszystkie żądania idą z `credentials: 'include'` — sesja siedzi
 * w ciasteczku httpOnly, którego JS nie widzi, więc nie podpinamy
 * żadnego nagłówka Authorization.
 */

/**
 * Adres bazowy API.
 *
 * Leniwie, nie na poziomie modułu: `import.meta.env` istnieje tylko
 * w bundlu Vite'a. Czytanie go przy imporcie wywracałoby `api.ts` poza
 * Vite (testy `node --test`, `tsx`), gdzie tego obiektu nie ma.
 */
function baseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL || '/api';
}

/** Błąd z komunikatem po polsku, gotowym do pokazania w UI. */
export class ApiError extends Error {
  readonly status: number;
  readonly details: string[];

  constructor(status: number, message: string, details: string[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }

  /** 401 → sesja wygasła, UI powinno wypisać użytkownika. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }

  /** 429 → limit zapytań przekroczony. */
  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Nie parsuj odpowiedzi jako JSON (eksport CSV). */
  raw?: boolean;
}

/**
 * Wyciąga czytelny komunikat z odpowiedzi NestJS.
 * Nest zwraca message jako string albo tablicę walidacji.
 */
export async function extractError(response: Response): Promise<ApiError> {
  let message = `Błąd ${response.status}`;
  const details: string[] = [];

  try {
    const payload = await response.json();

    if (typeof payload?.message === 'string') {
      message = payload.message;
    } else if (Array.isArray(payload?.message)) {
      // Lista błędów walidacji z class-validator
      details.push(...payload.message.map(String));
      message = details[0] ?? 'Popraw błędne pola formularza.';
    } else if (typeof payload?.error === 'string') {
      message = payload.error;
    }
  } catch {
    // Odpowiedź nie jest JSON-em (np. 502 od nginx) — zostaje komunikat domyślny
  }

  if (response.status === 429) {
    message = 'Zbyt wiele żądań. Spróbuj ponownie za chwilę.';
  }
  if (response.status === 502 || response.status === 503) {
    message = 'Usługa chwilowo niedostępna. Spróbuj ponownie za chwilę.';
  }

  return new ApiError(response.status, message, details);
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, raw, headers, ...rest } = options;

  const init: RequestInit = {
    ...rest,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
  };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const response = await fetch(`${baseUrl()}${path}`, init);

  if (!response.ok) {
    throw await extractError(response);
  }

  if (raw) {
    return (await response.text()) as T;
  }

  // 204 albo pusta odpowiedź
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// `buildQuery` żyje w osobnym module (`query.ts`), bo ten plik czyta
// `import.meta.env` i nie da się go zaimportować poza bundlem Vite.
// Reeksportujemy dla wygody dotychczasowego importu.
export { buildQuery } from './query';
