/** Formatowanie danych po polsku — spójne w całym UI. */

const DATE_FMT = new Intl.DateTimeFormat('pl-PL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const DATETIME_FMT = new Intl.DateTimeFormat('pl-PL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const CURRENCY_FMT = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits: 0,
});

/** RRRR-MM-DD → data w formacie polskim. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return DATE_FMT.format(date);
}

/** Znacznik czasu w formacie polskim. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return DATETIME_FMT.format(date);
}

/** Wartość dla <input type="date">. */
export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

/** Kwota w złotych. */
export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return CURRENCY_FMT.format(value);
}

/**
 * Ile dni zostało do daty. Ujemne = termin już minął.
 * Liczymy w pełnych dniach kalendarzowych, nie w godzinach —
 * „wycofywana za 3 dni" ma sens operacyjny, „za 47 godzin" mniej.
 */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);

  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** Opis terminu wycofania po polsku, gotowy do odznaki. */
export function describeEol(iso: string | null | undefined): {
  label: string;
  tone: 'ok' | 'warn' | 'danger';
} | null {
  const days = daysUntil(iso);
  if (days === null) return null;

  if (days < 0) {
    const overdue = Math.abs(days);
    return {
      label: `Po terminie od ${overdue} ${pluralDays(overdue)}`,
      tone: 'danger',
    };
  }
  if (days === 0) return { label: 'Wycofywana dzisiaj', tone: 'danger' };
  if (days <= 30) return { label: `Za ${days} ${pluralDays(days)}`, tone: 'danger' };
  if (days <= 90) return { label: `Za ${days} ${pluralDays(days)}`, tone: 'warn' };
  return { label: `Za ${days} ${pluralDays(days)}`, tone: 'ok' };
}

/**
 * Odmiana „dzień/dni".
 *
 * Prosta, bo poprawna gramatycznie forma „dni" jest taka sama dla
 * wszystkich liczb poza 1 — polski nie ma osobnej liczby mnogiej dla
 * 2–4 w tym rzeczowniku.
 */
export function pluralDays(n: number): string {
  return n === 1 ? 'dzień' : 'dni';
}

// `truncate` nie miał call-site'ów (pozostałe wystąpienia nazwy to klasa
// Tailwind `.truncate` w JSX). Usunięty jako martwy eksport.

/**
 * Opis akcji audytowej po polsku. Klucze muszą pokrywać się z tym,
 * co zapisuje AuditService w API — przy nieznanym kluczu pokazujemy
 * surową nazwę, a nie pustkę.
 */
const ACTION_LABELS: Record<string, string> = {
  'app.created': 'Utworzono aplikację',
  'app.updated': 'Zmieniono aplikację',
  'app.deleted': 'Usunięto aplikację',
  'app.restored': 'Przywrócono aplikację',
  'auth.login': 'Logowanie',
  'auth.login_failed': 'Nieudane logowanie',
  'auth.logout': 'Wylogowanie',
  'auth.password_changed': 'Zmiana hasła',
  'auth.password_changed_by_admin': 'Hasło zmienione przez administratora',
  'auth.session_revoked': 'Sesja zamknięta',
  'user.created': 'Utworzono użytkownika',
  'user.updated': 'Zmieniono użytkownika',
  'user.deleted': 'Usunięto użytkownika',
  'user.password_reset': 'Reset hasła użytkownika',
  'user.password_change_required': 'Wymuszono zmianę hasła',
  'user.sessions_revoked': 'Zamknięto sesje użytkownika',
};

export function describeAction(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** Pierwsza litera imienia — do awatara. */
export function initials(fullName: string | null | undefined): string {
  if (!fullName) return '?';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
