import { createContext, useContext } from 'react';

/** Ton powiadomienia — sukces albo błąd. */
export type Ton = 'ok' | 'blad';

export const ToastContext = createContext<(tekst: string, ton?: Ton) => void>(() => {});

/** Pokazanie toastu: `const toast = useToast(); toast.pokaz('Zapisano')`.
 *
 * Kontekst i hook bez komponentu w tym pliku; sam `ToastProvider`
 * z renderem kafli leży w `ToastProvider.tsx` — plik eksportujący
 * komponent i hook naraz psuje fast refresh w dev (`react-refresh`).
 */
export function useToast() {
  return { pokaz: useContext(ToastContext) };
}
