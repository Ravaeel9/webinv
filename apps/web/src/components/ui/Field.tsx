import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  ReactNode,
} from 'react';
import { useId } from 'react';

/**
 * Wspólne pudełko pola formularza: etykieta + komunikat błędu.
 *
 * `className` trafia na obudowę pola (szerokość w siatce), a nie na sam
 * input — dzięki temu `className="w-40"` ustawia kolumnę formularza,
 * a nie styl samego kontrolki.
 *
 * Błędy trzymamy w jednym obiekcie `Record<string, string>` w formularzu,
 * a każde pole samo decyduje, co z nim zrobić. Dzięki temu wysyłka do
 * serwera i podświetlenie pól rozjeżdżają się tylko wtedy, gdy zmienimy
 * nazwę pola — nie w całej reszcie kodu.
 */
export function Field({
  label,
  error,
  hint,
  required,
  children,
  className = '',
}: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: (props: {
    id: string;
    describedBy: string | undefined;
    invalid: boolean;
  }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') ||
    undefined;

  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="label">
          {label}
          {required && (
            <span className="ml-0.5 text-rose-500" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}

      {children({ id, describedBy, invalid: Boolean(error) })}

      {hint && !error && (
        <p id={hintId} className="mt-1 text-xs text-fg-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type InputProps = {
  label: string;
  error?: string;
  hint?: string;
  /** Szerokość obudowy pola, nie samego inputa. */
  className?: string;
  /** Ikona wewnątrz inputa (po lewej); input dostaje wtedy `pl-9`. */
  icon?: ReactNode;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>;

export function TextInput({
  label,
  error,
  hint,
  className,
  icon,
  ...rest
}: InputProps) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      {({ id, describedBy, invalid }) =>
        icon ? (
          <div className="relative">
            <span
              className="pointer-events-none absolute top-1/2 left-3
                         -translate-y-1/2 text-fg-subtle"
              aria-hidden="true"
            >
              {icon}
            </span>
            <input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              className={`input pl-9 ${invalid ? 'input-error' : ''}`}
              {...rest}
            />
          </div>
        ) : (
          <input
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className={`input ${invalid ? 'input-error' : ''}`}
            {...rest}
          />
        )
      }
    </Field>
  );
}

type TextareaProps = {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>;

export function Textarea({
  label,
  error,
  hint,
  className,
  rows = 4,
  ...rest
}: TextareaProps) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          rows={rows}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={`input resize-y ${invalid ? 'input-error' : ''}`}
          {...rest}
        />
      )}
    </Field>
  );
}

type SelectProps = {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'children'>;

export function Select({
  label,
  error,
  hint,
  className,
  children,
  ...rest
}: SelectProps) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={`input cursor-pointer ${invalid ? 'input-error' : ''}`}
          {...rest}
        >
          {children}
        </select>
      )}
    </Field>
  );
}

/** Checkbox z etykietą — do flag i przełączników. */
export function Checkbox({
  label,
  hint,
  ...rest
}: {
  label: string;
  hint?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'>) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-line-strong text-brand-600 focus:ring-brand-500/30"
        {...rest}
      />
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-sm text-fg">
          {label}
        </label>
        {hint && (
          <p id={hintId} className="text-xs text-fg-muted">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
