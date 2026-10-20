import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { buttonClass, type Variant, type Size } from './button-class';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  // Domyślnie `button`, nie domyślne HTML-owe `submit`. Dziś każdy
  // przycisk wysyłający formularz ma `type="submit"` jawnie, więc nic
  // się nie zmienia — a przycisk postawiony w przyszłości wewnątrz
  // `<form>` nie wyśle go przez przypadek.
  type = 'button',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      // Gdy `loading`, blokujemy kliknięcia — inaczej user wysyła
      // formularz dwa razy i tworzy dwa wpisy
      disabled={disabled || loading}
      className={[
        buttonClass(variant, size),
        'disabled:cursor-not-allowed disabled:opacity-60',
        className,
      ].join(' ')}
      {...rest}
    >
      {loading && (
        <svg
          className="size-4 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
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
      )}
      {children}
    </button>
  );
}
