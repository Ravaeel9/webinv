import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { IconAlert, IconCheck, IconX } from './icons';

type Ton = 'ok' | 'blad';
type Toast = { id: number; tekst: string; ton: Ton };

const ToastContext = createContext<(tekst: string, ton?: Ton) => void>(() => {});

/**
 * Powiadomienie po akcji — `useToast().pokaz('Zapisano')`.
 *
 * Dlaczego toasty, a nie inline: mutacje żyją w listach i modalach, które
 * po sukcesie **znikają** (modal się zamyka, wiersz odświeża) — komunikat
 * w miejscu akcji nie ma gdzie się zatrzymać. Toast jest jedynym elementem,
 * który przeżywa własne DOM-owe otoczenie, więc nadaje się też po
 * przekierowaniu.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasty, setToasty] = useState<Toast[]>([]);
  const nastepnyId = useRef(1);

  const usun = useCallback((id: number) => {
    setToasty((poprzednie) => poprzednie.filter((t) => t.id !== id));
  }, []);

  const pokaz = useCallback(
    (tekst: string, ton: Ton = 'ok') => {
      const id = nastepnyId.current++;
      setToasty((poprzednie) => [...poprzednie, { id, tekst, ton }]);
      window.setTimeout(() => usun(id), 4500);
    },
    [usun],
  );

  return (
    <ToastContext.Provider value={pokaz}>
      {children}
      {/* `pointer-events-none` na tle, `pointer-events-auto` na kaflu —
          obszar pod toasty nie zjada klików w aplikację pod nim. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2"
      >
        {toasty.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg animate-in-up ${
              toast.ton === 'ok'
                ? 'alert-ok'
                : 'alert-danger'
            }`}
          >
            {toast.ton === 'ok' ? (
              <IconCheck className="mt-0.5 size-4 shrink-0" />
            ) : (
              <IconAlert className="mt-0.5 size-4 shrink-0" />
            )}
            <p className="min-w-0 flex-1">{toast.tekst}</p>
            <button
              type="button"
              aria-label="Zamknij powiadomienie"
              onClick={() => usun(toast.id)}
              className="shrink-0 rounded-md p-0.5 text-current opacity-60 hover:opacity-100"
            >
              <IconX className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Pokazanie toastu: `const toast = useToast(); toast.pokaz('Zapisano')`. */
export function useToast() {
  return { pokaz: useContext(ToastContext) };
}
