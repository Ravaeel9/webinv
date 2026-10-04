import type { ThHTMLAttributes } from 'react';

/**
 * Nagłówek kolumny tabeli.
 *
 * Wygląd jest rolą `.table-head` z `index.css`, a nie zestawem klas
 * powtarzanym w każdej tabeli — dzięki temu oba miejsca, które mają
 * nagłówek tabeli, wyglądają tak samo. Klasa przychodzi z argumentu,
 * bo `w-[26%]` dla kolumny nazwy musi dołożyć się od zewnątrz.
 *
 * `scope="col"` jest wymagany nie dla wyglądu: czytnik ekranu i tak
 * kojarzy komórkę z kolumną, ale nagłówek bez `scope` jest w dokumencie
 * zwykłym `<th>` bez informacji o tym, do czego się odnosi.
 */
export function Th({
  children,
  className = '',
  ...rest
}: { children?: React.ReactNode } & ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    // `scope` po `{...rest}`: klasa ma być kontraktem, a nie propozycją.
    // Gdyby spread szedł pierwszy, wywołujący mógłby przykryć `scope`
    // przypadkiem — a bez niego nagłówek jest w dokumencie zwykłym `<th>`.
    <th {...rest} scope="col" className={`table-head ${className}`}>
      {children}
    </th>
  );
}
