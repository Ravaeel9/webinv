/**
 * Błąd API i wyciąganie komunikatów — moduł czysty, bez `import.meta.env`,
 * żeby dał się zaimportować i typować także z testów API (jak `query.ts`).
 *
 * Reguła tłumaczenia błędów: ogólny tekst „Usługa chwilowo niedostępna"
 * jest tylko dla 502/503 **bez treści** (nginx przed niedostępnym API).
 * Gdy API dostarczyło konkretny komunikat — np. integracja GLPI opisuje,
 * czego brakuje w konfiguracji — nadpisywanie go ogólnikiem zabija całą
 * jego wartość.
 */

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

/**
 * Wyciąga czytelny komunikat z odpowiedzi NestJS.
 * Nest zwraca message jako string albo tablicę walidacji.
 */
export async function extractError(response: Response): Promise<ApiError> {
  let message = `Błąd ${response.status}`;
  let zTrescia = false;
  const details: string[] = [];

  try {
    const payload = (await response.json()) as {
      message?: unknown;
      error?: unknown;
    } | null;

    if (typeof payload?.message === 'string') {
      message = payload.message;
      zTrescia = true;
    } else if (Array.isArray(payload?.message)) {
      // Lista błędów walidacji z class-validator
      details.push(...payload.message.map(String));
      message = details[0] ?? 'Popraw błędne pola formularza.';
      zTrescia = true;
    } else if (typeof payload?.error === 'string') {
      message = payload.error;
      zTrescia = true;
    }
  } catch {
    // Odpowiedź nie jest JSON-em (np. 502 od nginx) — zostaje komunikat domyślny
  }

  if (response.status === 429) {
    message = 'Zbyt wiele żądań. Spróbuj ponownie za chwilę.';
  }
  if ((response.status === 502 || response.status === 503) && !zTrescia) {
    message = 'Usługa chwilowo niedostępna. Spróbuj ponownie za chwilę.';
  }

  return new ApiError(response.status, message, details);
}
