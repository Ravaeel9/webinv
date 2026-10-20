import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ThemeContext, STORAGE_KEY, type ThemeChoice, type ResolvedTheme } from './theme';

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

/**
 * Provider motywu — implementacja; kontekst i hook `useTheme` żyją
 * w `theme.tsx`. Plik eksportujący komponent i hook naraz psuje fast
 * refresh w dev (`react-refresh/only-export-components`).
 */
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
