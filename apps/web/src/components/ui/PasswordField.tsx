import { useId } from 'react';
import { checkPassword, PASSWORD_RULES, MAX_PASSWORD_LENGTH } from '../../lib/password';

/**
 * Pole hasła z podpowiedzzią wymagań. Walidacja jest wizualna
 * (na żywo podczas pisania) i blokująca (przed wysłaniem),
 * ale docelową weryfikację zawsze wykonuje serwer.
 */
export function PasswordInput({
  label,
  value,
  onChange,
  error,
  hint,
  autoComplete,
  required,
  showRules,
  maxLength = MAX_PASSWORD_LENGTH,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  autoComplete?: string;
  required?: boolean;
  /** Pokaż listę wymagań — przydatne przy tworzeniu/zmianie hasła. */
  showRules?: boolean;
  maxLength?: number;
}) {
  const check = checkPassword(value);
  // `useId`, nie stały string — dwa pola hasła na jednej stronie
  // dostałyby to samo `id`, a `htmlFor` wskazywałby wtedy nie to pole.
  const id = useId();
  const errorId = `${id}-error`;
  // Dopóki pole jest puste, nie straszymy czerwonym komunikatem —
  // błąd pokazujemy dopiero po pierwszym znaku.
  const touched = value.length > 0;
  const errorText =
    error ?? (touched && !check.ok ? check.errors.join(' ') : undefined);

  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
        {required && (
          <span className="ml-0.5 text-rose-500" aria-hidden="true">
            *
          </span>
        )}
      </label>

      <input
        id={id}
        aria-invalid={errorText ? true : undefined}
        aria-describedby={errorText ? errorId : undefined}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`input font-mono ${error || (touched && !check.ok) ? 'input-error' : ''}`}
        autoComplete={autoComplete}
        required={required}
        maxLength={maxLength}
        // type="text" zamiast "password", bo administrator musi przekazać
        // hasło startowe i nie może go przepisywać z terminala
        spellCheck={false}
      />

      {errorText && (
        <p id={errorId} className="error-text" role="alert">
          {errorText}
        </p>
      )}

      {showRules && (
        <PasswordRules met={check.met} />
      )}

      {!error && hint && !showRules && (
        <p className="mt-1 meta-text">{hint}</p>
      )}
    </div>
  );
}

/** Lista wymagań z ptaszkami — spełnione warunki przygaszają. */
function PasswordRules({ met }: { met: Record<string, boolean> }) {
  return (
    <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
      {PASSWORD_RULES.map((rule) => (
        <li
          key={rule}
          className={`flex items-center gap-1 text-[11px] ${
            met[rule] ? 'text-accent-700 dark:text-accent-400' : 'text-fg-muted'
          }`}
        >
          <span aria-hidden="true">{met[rule] ? '✓' : '○'}</span>
          {rule}
        </li>
      ))}
    </ul>
  );
}

/** Pole do potwierdzenia hasła — sprawdza zgodność lokalnie. */
export function PasswordConfirm({
  label,
  value,
  onChange,
  error,
  autoComplete = 'new-password',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoComplete?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input
        id={id}
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`input ${error ? 'input-error' : ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        autoComplete={autoComplete}
        required
        maxLength={MAX_PASSWORD_LENGTH}
      />
      {error && (
        <p id={errorId} className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
