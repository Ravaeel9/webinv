import { IconChevronLeft, IconChevronRight } from './icons';

/**
 * Okno numerów stron wokół aktywnej: pierwsza i ostatnia zawsze, obok
 * aktywnej jedna z każdej strony, w środku wielokropek. Dla ≤7 stron
 * numery idą po kolei — okno zaczyna się migotać dopiero przy długich
 * listach, a krótkie nie potrzebują skrótów.
 */
function numeryStron(
  aktywna: number,
  ostatnia: number,
): Array<number | '…'> {
  if (ostatnia <= 7) {
    return Array.from({ length: ostatnia }, (_, i) => i + 1);
  }

  const strony = new Set<number>([1, ostatnia, aktywna - 1, aktywna, aktywna + 1]);
  const posortowane = [...strony]
    .filter((s) => s >= 1 && s <= ostatnia)
    .sort((a, b) => a - b);

  const wynik: Array<number | '…'> = [];
  let poprzednia = 0;
  for (const s of posortowane) {
    if (s - poprzednia > 1) wynik.push('…');
    wynik.push(s);
    poprzednia = s;
  }
  return wynik;
}

/**
 * Paginacja prev/next + numery stron. Stan trzyma strona wywołująca
 * (URLSearchParams), więc komponent jest głupi i przeżywa zmiany
 * źródła danych (offset od zera vs `page` od jedynki).
 */
export function Pagination({
  strona,
  ostatnia,
  total,
  onZmien,
  etykieta = 'Paginacja',
}: {
  /** Numer strony od 1. */
  strona: number;
  /** Numer ostatniej strony, minimum 1. */
  ostatnia: number;
  /** Liczba wszystkich wierszy — widoczna obok, gdy podana. */
  total?: number;
  onZmien: (strona: number) => void;
  etykieta?: string;
}) {
  if (ostatnia <= 1) return null;

  return (
    <nav
      aria-label={etykieta}
      className="flex flex-wrap items-center justify-between gap-3 px-1 py-3"
    >
      {total !== undefined && (
        <p className="text-xs text-fg-muted">
          Strona {strona} z {ostatnia} · {total} wierszy
        </p>
      )}

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          aria-label="Poprzednia strona"
          disabled={strona <= 1}
          onClick={() => onZmien(strona - 1)}
          className="flex size-8 items-center justify-center rounded-lg border border-line-strong
                     text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg
                     disabled:cursor-not-allowed disabled:opacity-40"
        >
          <IconChevronLeft className="size-4" />
        </button>

        {numeryStron(strona, ostatnia).map((s, i) =>
          s === '…' ? (
            // Klucz po indeksie: wielokropek nie jest stroną i może się
            // powtórzyć (początek i koniec listy).
            <span key={`gap-${i}`} className="px-1 text-fg-subtle">
              …
            </span>
          ) : (
            <button
              key={s}
              type="button"
              aria-current={s === strona ? 'page' : undefined}
              onClick={() => onZmien(s)}
              className={`flex size-8 items-center justify-center rounded-lg border text-sm transition-colors ${
                s === strona
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                  : 'border-line-strong text-fg-muted hover:bg-surface-2 hover:text-fg'
              }`}
            >
              {s}
            </button>
          ),
        )}

        <button
          type="button"
          aria-label="Następna strona"
          disabled={strona >= ostatnia}
          onClick={() => onZmien(strona + 1)}
          className="flex size-8 items-center justify-center rounded-lg border border-line-strong
                     text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg
                     disabled:cursor-not-allowed disabled:opacity-40"
        >
          <IconChevronRight className="size-4" />
        </button>
      </div>
    </nav>
  );
}
