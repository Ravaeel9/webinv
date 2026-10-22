import { useEffect, type ReactNode } from 'react';
import { useBlocker } from 'react-router';
import { Button } from './Button';
import { Modal } from './Modal';

/**
 * Zabezpieczenie formularza przed utratą niezapisanych zmian.
 *
 * Dwie drogi wyjścia z formularza, dwie różne bramki:
 *
 *  - **Nawigacja wewnątrz aplikacji** (menu, link wstecz) — `useBlocker`
 *    z react-router przechwytuje zmianę trasy i pyta modalem. `window.confirm`
 *    tu nie wystarcza: wygląda obco i nie daje miejsca na wyjaśnienie.
 *  - **Zamknięcie/odświeżenie karty** — `beforeunload`, jedyna możliwa
 *    bramka; przeglądarka pokazuje własny komunikat.
 *
 * Użycie: `const guard = useDirtyGuard(brama.czyBrudny)` i wyrenderowanie
 * `guard` obok formularza. **Getter, nie bool** — react-router rejestruje
 * funkcję blockera dopiero w efekcie (po renderze), więc `useState` tu
 * kłamie przy nawigacji wywołanej synchronicznie po zapisie; getter czyta
 * stan bramy zawsze na bieżąco (patrz `lib/dirty-guard.ts`). Po udanym
 * zapisie wystarczy `brama.zwolnij()`, żeby przekierowanie nie wpadło
 * we własną blokadę.
 */
export function useDirtyGuard(czyAktywny: () => boolean): ReactNode {
  // Zamykanie karty / odświeżenie. `preventDefault` + `returnValue` —
  // Chrome wymaga obu, Firefox czyta tylko `returnValue`. Listener
  // jest zawsze podpięty — świeżość decyduje getter w środku.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!czyAktywny()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [czyAktywny]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      czyAktywny() && currentLocation.pathname !== nextLocation.pathname,
  );

  // Bez efektu i bez stanu w komponencie wołającym: decyzja użytkownika
  // (`proceed`/`reset`) to jedyny efekt uboczny, więc modal jest czystą
  // funkcją stanu blockera.
  useEffect(() => {
    if (blocker.state !== 'blocked') return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') blocker.reset?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [blocker]);

  if (blocker.state !== 'blocked') return null;

  return (
    <Modal
      open
      onClose={() => blocker.reset?.()}
      title="Niezapisane zmiany"
      description="Formularz zawiera dane, których nie zapisano. Wyjście teraz je utraci."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => blocker.reset?.()}>
            Wróć do edycji
          </Button>
          <Button variant="danger" onClick={() => blocker.proceed?.()}>
            Opuść bez zapisywania
          </Button>
        </>
      }
    >
      {/* Treść niesie sam opis w nagłówku — puste ciało okna wygląda
          lepiej niż dublowanie komunikatu. */}
      <span className="sr-only">Potwierdź opuszczenie formularza.</span>
    </Modal>
  );
}
