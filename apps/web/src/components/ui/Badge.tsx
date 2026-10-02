import type { ReactNode } from 'react';
import { describeEol } from '../../lib/format';

/** Odznaka ze stałym kolorem — do statusów i klasyfikacji. */
export function Badge({
  color,
  children,
  title,
}: {
  color: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`badge ${color}`} title={title}>
      {/* Kropka w kolorze tekstu odznaki — pomaga skanować listę
          wzrokiem, a `bg-current` trzyma ją w kontraście pary. */}
      <span
        className="size-1.5 shrink-0 rounded-full bg-current opacity-75"
        aria-hidden="true"
      />
      {children}
    </span>
  );
}

/** Odznaka terminu wycofania — kolor zależy od tego, ile zostało czasu. */
export function EolBadge({ date }: { date: string | null }) {
  if (!date) return null;

  const info = describeEol(date);
  if (!info) return null;

  const color =
    info.tone === 'danger'
      ? 'bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30'
      : info.tone === 'warn'
        ? 'bg-amber-100 text-amber-900 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30'
        : 'bg-surface-2 text-fg ring-line';

  return (
    <span className={`badge ${color}`} title={`Wycofanie: ${date}`}>
      {info.label}
    </span>
  );
}
