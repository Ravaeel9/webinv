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
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-lg border border-rose-500/30
                  bg-rose-500/10 px-4 py-3 text-sm text-rose-800
                  dark:text-rose-200 ${className}`}
    >
      <IconAlert className="mt-0.5 size-4 shrink-0" />

      <div className="min-w-0 flex-1">
        <p className="font-medium">{message}</p>

        {/* Dodatkowe komunikaty walidacji z serwera */}
        {isApi && error.details.length > 1 && (
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-rose-700 dark:text-rose-300">
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
                     text-rose-700 underline-offset-2 hover:bg-rose-500/20
                     hover:underline dark:text-rose-300"
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

      <h3 className="text-sm font-semibold text-fg">{title}</h3>
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
