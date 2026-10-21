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
  /* Przycisk główny — jedyna powierzchnia malowana gradientem i
     z uniesieniem. `bg-linear-to-b` to v4-owy zapis pionowego gradientu;
     hover przestawia stopnie o jedną pozycję w skali, więc stan najechania
     jest widoczny bez dodatkowych kolorów. `-translate-y-px` + cień =
     subtelne „uniesienie”, spójne z miękkimi kartami. */
  primary:
    'bg-linear-to-b from-brand-500 to-brand-600 text-white ' +
    'hover:from-brand-600 hover:to-brand-700 ' +
    'active:from-brand-700 active:to-brand-800 active:translate-y-0 ' +
    'shadow-sm shadow-brand-600/25 ' +
    'hover:shadow-md hover:shadow-brand-600/30 hover:-translate-y-px',
  secondary:
    'bg-surface text-fg border border-line-strong hover:bg-page active:bg-surface-2 shadow-xs',
  ghost: 'text-fg-muted hover:bg-surface-2 active:bg-surface-3',
  /* Danger — płaski, bez browsingu gradientem: błąd ma wyglądać poważnie,
     nie ozdobnie. Jedynie współdzieli uniesienie z primary, żeby
     interakcja miała jeden rytm. */
  danger:
    'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 shadow-xs ' +
    'hover:-translate-y-px active:translate-y-0',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md'): string {
  return [
    'inline-flex items-center justify-center rounded-xl font-semibold',
    /* `transition` (nie `transition-colors`): uniesienie zmienia cień i
       transform, więc tranzycja musi je obejmować — inaczej hover skacze. */
    'transition',
    VARIANTS[variant],
    SIZES[size],
  ].join(' ');
}
