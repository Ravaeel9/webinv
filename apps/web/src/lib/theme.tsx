import { createContext, useContext } from 'react';

/**
 * Motyw jasny / ciemny / „jak w systemie".
 *
 * Klasa `dark` leży na `<html>`, a wartość jest zapamiętywana
 * w `localStorage`. Skrypt w `index.html` ustawia ją **przed**
 * pierwszym renderem — bez tego ciemny motyw pokazywałby się
 * dopiero po białym rozbłysku.
 *
 * Kontekst i hook żyją tu, implementacja providera — w
 * `theme-provider.tsx`: plik eksportujący komponent i hook naraz
 * psuje fast refresh w dev (`react-refresh/only-export-components`).
 */

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** Klucz w `localStorage` — ten sam używa skrypt `public/theme.js`:
 * oba czytają i zapisują tę samą wartość, rozjazd = migotanie motywu. */
export const STORAGE_KEY = 'rejestr-theme';

export interface ThemeContextValue {
  /** Ustawienie wybrane przez użytkownika. */
  choice: ThemeChoice;
  /** Motyw faktycznie zastosowany — „system" po rozstrzygnięciu. */
  resolved: ResolvedTheme;
  setChoice: (choice: ThemeChoice) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme musi być użyte wewnątrz <ThemeProvider>');
  }
  return context;
}
