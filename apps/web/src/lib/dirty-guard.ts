/**
 * Stan bramy niezapisanych zmian — zwykła zmienna, nie stan Reacta.
 *
 * Powód, dla którego to jest osobny moduł: predykat blockera czyta
 * router **spoza** cyklu renderowania, a react-router rejestruje jego
 * funkcję dopiero w efekcie (po renderze). Gdyby brud siedział w
 * `useState`, nawigacja wywołana synchronicznie tuż po zwolnieniu
 * bramki widziałaby jeszcze starą wartość — i modal „Niezapisane
 * zmiany" wyskakiwał własny zapis. Domknięcie jest czytane zawsze
 * na bieżąco, więc `zwolnij()` działa od razu, bez przerenderowania.
 */
export type BramaZmian = {
  /** Czy są zmiany, których nie zapisano. */
  czyBrudny(): boolean;
  /** Użytkownik zmienił pole — brudne. */
  oznacz(): void;
  /** Zapis udany albo szkic odrzucony — czysto, natychmiast. */
  zwolnij(): void;
};

export function bramaZmian(): BramaZmian {
  let brudny = false;
  return {
    czyBrudny: () => brudny,
    oznacz: () => {
      brudny = true;
    },
    zwolnij: () => {
      brudny = false;
    },
  };
}
