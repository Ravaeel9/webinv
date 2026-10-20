/**
 * Wygląd przycisku jako samodzielna klasa — bez komponentu Reacta.
 *
 * Dla miejsc, które muszą być linkiem, a nie przyciskiem — `<Link>` z
 * klasami `Button` to `<a><button></a>`, czyli niepoprawny HTML i
 * zawodne sterowanie klawiaturą. Zamiast sklejać wariant drugi raz
 * w JSX (i mieć go potem w dwóch miejscach), link bierze tę samą
 * klasę co przycisk.
 *
 * Nie używaj tego, jeśli można po prostu wstawić `Button`.
 * Odseparowane od komponentu `Button`, bo plik eksportujący komponent
 * i funkcję naraz psuje fast refresh w dev (`react-refresh`).
 */
export type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-xs',
  secondary:
    'bg-surface text-fg border border-line-strong hover:bg-page active:bg-surface-2 shadow-xs',
  ghost: 'text-fg-muted hover:bg-surface-2 active:bg-surface-3',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 shadow-xs',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md'): string {
  return [
    'inline-flex items-center justify-center rounded-lg font-semibold',
    'transition-colors',
    VARIANTS[variant],
    SIZES[size],
  ].join(' ');
}
