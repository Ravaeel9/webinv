import type { ReactNode } from 'react';
import { ApiError } from '../../lib/api';
import { IconAlert, IconBox, IconFilter } from './icons';

/**
 * Komunikat błędu z opcjonalnym przyciskiem ponowienia.
 * Komunikat bierze z ApiError, żeby błędy walidacji z serwera
 * pokazywały się dokładnie tak, jak je zdefiniował backend.
 */
export function ErrorMessage({
  error,
  onRetry,
  className = '',
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  if (!error) return null;

  const isApi = error instanceof ApiError;
  const message = isApi ? error.message : 'Coś poszło nie tak. Spróbuj ponownie.';

  return (
    <div role="alert" className={`alert alert-danger ${className}`}>
      <IconAlert className="mt-0.5 size-4 shrink-0" />

      <div className="min-w-0 flex-1">
        <p className="font-medium">{message}</p>

        {/* Dodatkowe komunikaty walidacji z serwera */}
        {isApi && error.details.length > 1 && (
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {error.details.slice(1).map((detail, i) => (
              <li key={i}>{detail}</li>
            ))}
          </ul>
        )}
      </div>

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-md px-2 py-1 text-xs font-medium
                     underline-offset-2 hover:underline
                     hover:bg-[oklch(0.83_0.08_20_/_0.4)]"
        >
          Ponów
        </button>
      )}
    </div>
  );
}

/** Stan pusty — lista bez wyników. */
export function EmptyState({
  title,
  description,
  action,
  icon,
  tone = 'default',
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  /**
   * `neutral` dla „nie ma żadnych danych", `muted` dla „filtrowanie
   * nic nie zwróciło". Dwa różne stany zasługują na dwa różne ikony —
   * kosz sugeruje, że problem leży w danych, a nie w zapytaniu.
   */
  tone?: 'default' | 'muted';
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div
        className={`mb-3 flex size-12 items-center justify-center rounded-full ${
          tone === 'muted' ? 'bg-page text-fg-subtle' : 'bg-surface-2 text-fg-subtle'
        }`}
      >
        {icon ?? (tone === 'muted' ? <IconFilter className="size-6" /> : <IconBox className="size-6" />)}
      </div>

      {/* `.section-title` zamiast `text-sm font-semibold`: opis poniżej ma
          14 px, więc tytuł 14 px był dokładnie tak duży jak treść, którą
          opisuje — odwrócona hierarchia, którą znoszą role z `index.css`. */}
      <h3 className="section-title mb-0 justify-center">{title}</h3>
      {description && (
        <p className="mt-1 max-w-md text-sm text-fg-muted">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Szkielet ładowania — zapobiega „skakaniu” layoutu. */
export function Spinner({ label = 'Ładowanie…' }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-3 px-6 py-16 text-sm text-fg-muted"
    >
      <svg className="size-5 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
        />
      </svg>
      {label}
    </div>
  );
}

/**
 * Szkielet tabeli — pasma o wysokości wiersza zamiast spinnera.
 *
 * Spinner nad listą tabeli nie zachowuje jej wymiarów: po załadowaniu
 * strona skacze o wysokość nagłówka i wierszy. Szkielet z tą samą
 * strukturą (`wierszy` pasm w karcie) trzyma layout w miejscu, a pasek
 * postępu animuje się subtelnie, żeby nie konkurował z treścią.
 */
export function TableSkeleton({
  wierszy = 5,
  kolumn = 4,
}: {
  wierszy?: number;
  kolumn?: number;
}) {
  return (
    <div role="status" aria-label="Wczytywanie danych" className="card overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-line bg-surface-2">
            {Array.from({ length: kolumn }, (_, i) => (
              <th key={i} className="px-3 py-2.5">
                <span className="block h-3 w-16 animate-pulse rounded bg-surface-3" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: wierszy }, (_, w) => (
            <tr key={w} className="border-b border-line last:border-0">
              {Array.from({ length: kolumn }, (_, k) => (
                <td key={k} className="px-3 py-2.5">
                  <span
                    className="block h-3 animate-pulse rounded bg-surface-3"
                    // Zróżnicowane szerokości imitują rzeczywistą treść —
                    // jednakowe pasma wyglądają jak błąd renderowania.
                    style={{ width: `${55 + ((w * 13 + k * 29) % 35)}%` }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
