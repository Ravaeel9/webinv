import type {
  HTMLAttributes,
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react';

/**
 * Wspólne prymitywy tabeli.
 *
 * Powstały, bo cztery widoki modułu uprawnień napisały własne `<table>`
 * bez `text-left` i z komórkami `py-2 pr-3`: przeglądarka domyślnie
 * centruje `<th>`, a `<td>` trzyma po lewej, więc każdy nagłówek stał
 * na środku kolumny, a jej treść — 12 px na lewo od niego.
 *
 * Klasy poniżej są dokładnie tymi z `/aplikacje` (`ApplicationsListPage`):
 *  - `text-left` na `<table>`, żeby `<th>` i `<td>` dziedziczyły to samo wyrównanie,
 *  - `px-3 py-2.5` na `<td>`, bo `.table-head` ma `px-3 py-2.5` — nagłówek
 *    i komórka zaczynają się od tego samego piksela,
 *  - `border-b border-line-strong bg-surface-2` na `<thead>` i
 *    `divide-y divide-line` na `<tbody>`.
 */
export function Table({
  children,
  className = 'min-w-[760px]',
  wrapperClassName = '',
  ...rest
}: {
  children: ReactNode;
  wrapperClassName?: string;
} & TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className={`scroll-thin overflow-x-auto ${wrapperClassName}`}>
      <table {...rest} className={`w-full text-left text-sm ${className}`}>
        {children}
      </table>
    </div>
  );
}

export function Thead({
  children,
  className = '',
  ...rest
}: { children: ReactNode } & HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      {...rest}
      className={`border-b border-line-strong bg-surface-2 ${className}`}
    >
      {children}
    </thead>
  );
}

export function Tbody({
  children,
  className = '',
  ...rest
}: { children: ReactNode } & HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody {...rest} className={`divide-y divide-line ${className}`}>
      {children}
    </tbody>
  );
}

export function Td({
  children,
  className = '',
  ...rest
}: { children?: ReactNode } & TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td {...rest} className={`px-3 py-2.5 ${className}`}>
      {children}
    </td>
  );
}

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
}: { children?: ReactNode } & ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    // `scope` po `{...rest}`: klasa ma być kontraktem, a nie propozycją.
    // Gdyby spread szedł pierwszy, wywołujący mógłby przykryć `scope`
    // przypadkiem — a bez niego nagłówek jest w dokumencie zwykłym `<th>`.
    <th {...rest} scope="col" className={`table-head ${className}`}>
      {children}
    </th>
  );
}