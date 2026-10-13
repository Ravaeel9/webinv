import type { ReactNode } from 'react';
import { IconSort } from './icons';
import { Th } from './Table';

/**
 * Nagłówek kolumny sortowalnej.
 *
 * `<button>` wewnątrz `<th>`, a nie klikalne samo `th`: przycisk daje
 * czytnikowi ekranu i klawiaturze to, czego nie ma zwykła komórka —
 * jest w tabulatorze, reaguje na Enter i spację.
 *
 * `aria-sort` siedzi na `<th>`, nie na przycisku — to atrybut nagłówka,
 * a renderujący go przeglądarki czytników zgłasza go jako stan kolumny.
 * Dozwolone wartości to `ascending`, `descending` i `none`.
 *
 * Kolumna bez `sortBy` dostaje zwykłe `Th` i w ogóle nie jest sortowalna.
 * Wartość `sortBy` musi istnieć w białej liście `SORTABLE` w API — pilnuje
 * tego `apps/api/test/sort-kolumn.test.ts`, bo API ignoruje nieznane pole
 * po cichu, a strzałek by nie ruszyła.
 */
export function SortableTh({
  label,
  sortBy,
  currentSort,
  onSort,
  className = '',
}: {
  label: string;
  /** Nazwa pola w API — `undefined` robi z kolumny zwykły nagłówek. */
  sortBy?: string;
  /** Aktualny wybór z adresu URL: `pole`, `-pole` albo `undefined`. */
  currentSort?: string;
  onSort?: (sortBy: string) => void;
  className?: string;
  children?: ReactNode;
}) {
  if (!sortBy || !onSort) {
    return <Th className={className}>{label}</Th>;
  }

  // `startsWith('-')` odwraca kierunek — tak samo jak w API, więc
  // nagłówek i zapytanie nie rozjeżdżają się w interpretacji minusa.
  const negated = currentSort === `-${sortBy}`;
  const active = currentSort === sortBy || negated;
  const next = active && !negated ? `-${sortBy}` : sortBy;

  return (
    <Th
      className={`p-0 ${className}`}
      aria-sort={active ? (negated ? 'descending' : 'ascending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(next)}
        className="table-head flex w-full cursor-pointer items-center gap-1
                   hover:text-fg focus-visible:outline-2
                   focus-visible:outline-offset-2 focus-visible:outline-brand-600
                   dark:focus-visible:outline-brand-400"
        // Sam strzałek mówi czytnikowi mniej niż zdanie; bez tego
        // „Sortuj po statusie rosnąco" nie da się odszykać.
        aria-label={`Sortuj po „${label}” ${negated ? 'rosnąco' : 'malejąco'}`}
      >
        <span>{label}</span>
        {/* Strzałek pokazujemy tylko dla kolumny aktywnej: przy każdej
            sortowalnej sugerowałby, że lista jest w nią posortowana. */}
        {active && (
          <IconSort up={!negated} className="size-3.5 shrink-0 text-fg" />
        )}
      </button>
    </Th>
  );
}
