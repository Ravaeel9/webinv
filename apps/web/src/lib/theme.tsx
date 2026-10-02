import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Motyw jasny / ciemny / „jak w systemie".
 *
 * Klasa `dark` leży na `<html>`, a wartość jest zapamiętywana
 * w `localStorage`. Skrypt w `index.html` ustawia ją **przed**
 * pierwszym renderem — bez tego ciemny motyw pokazywałby się
 * dopiero po białym rozbłysku.
 */

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'rejestr-theme';

interface ThemeContextValue {
  /** Ustawienie wybrane przez użytkownika. */
  choice: ThemeChoice;
  /** Motyw faktycznie zastosowany — „system" po rozstrzygnięciu. */
  resolved: ResolvedTheme;
  setChoice: (choice: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // localStorage bywa niedostępny (tryb prywatny, wyłączone cookies).
    // Wtedy po prostu jedziemy ustawieniem systemowym.
  }
  return 'system';
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function resolve(choice: ThemeChoice): ResolvedTheme {
  return choice === 'system' ? systemTheme() : choice;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(readStoredChoice);
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    resolve(readStoredChoice()),
  );

  // Klasę dokładamy do <html>, bo tam bawią się style przeglądarki
  // (pasek przewijania, `color-scheme` dla natywnych kontrolek).
  useEffect(() => {
    const root = document.documentElement;

    // Klasa `theme-transition` tylko na czas przełączenia, żeby
    // kolory nie „płynęły” przy każdym renderze strony.
    root.classList.add('theme-transition');
    root.classList.toggle('dark', resolved === 'dark');

    const timer = window.setTimeout(
      () => root.classList.remove('theme-transition'),
      220,
    );
    return () => window.clearTimeout(timer);
  }, [resolved]);

  // Gdy ustawienie to „system", reagujemy na zmianę motywu w systemie
  // (np. użytkownik przełącza wieczorną motywę w Windowsie).
  useEffect(() => {
    if (choice !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolved(systemTheme());
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    setResolved(resolve(next));
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Brak localStorage nie może przerwać zmiany motywu.
    }
  }, []);

  const value = useMemo(
    () => ({ choice, resolved, setChoice }),
    [choice, resolved, setChoice],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme musi być użyte wewnątrz <ThemeProvider>');
  }
  return context;
}
