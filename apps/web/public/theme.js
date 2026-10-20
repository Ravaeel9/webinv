/**
 * Bootstrap motywu — ustawia klasę `dark` na <html> PRZED pierwszym
 * renderem Reacta. Bez tego ciemny motyw pojawiałby się po białym
 * rozbłysku przy każdym wejściu na stronę.
 *
 * Skrypt musi być zewnętrzny (`<script src="/theme.js">`): CSP aplikacji
 * to `script-src 'self'` bez 'unsafe-inline', więc inline <script> w
 * index.html zostałby przez przeglądarkę zablokowany. Zewnętrzny plik
 * z `public/` Vite kopiuje bez zmian, a test `nginx-config.test.ts`
 * pilnuje, żeby index.html nie dostał żadnego inline skryptu.
 *
 * Zapis w localStorage i key ('rejestr-theme') muszą pozostać spójne
 * z `src/lib/theme.tsx` — oba czytają ten sam klucz.
 */
(function () {
  try {
    var stored = localStorage.getItem('rejestr-theme');
    var theme =
      stored === 'light' || stored === 'dark'
        ? stored
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    }
  } catch {
    /* localStorage niedostępny — zostaje motyw jasny */
  }
})();
