/**
 * Klient HTTP.
 *
 * Wszystkie żądania idą z `credentials: 'include'` — sesja siedzi
 * w ciasteczku httpOnly, którego JS nie widzi, więc nie podpinamy
 * żadnego nagłówka Authorization.
 */

import { ApiError, extractError } from './api-error';

// `ApiError` i `extractError` żyją w `api-error.ts` (czysty moduł bez
// `import.meta`), żeby testy API mogły je typować i sprawdzać.
export { ApiError, extractError };

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

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Nie parsuj odpowiedzi jako JSON (eksport CSV). */
  raw?: boolean;
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
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// `buildQuery` żyje w osobnym module (`query.ts`), bo ten plik czyta
// `import.meta.env` i nie da się go zaimportować poza bundlem Vite.
// Reeksportujemy dla wygody dotychczasowego importu.
export { buildQuery } from './query';
