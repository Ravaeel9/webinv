import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Budowanie SPA, które nginx serwuje jako pliki statyczne
 * i które samo proxyuje /api do kontenera API.
 *
 * `VITE_API_BASE_URL` jest wstrzykiwane jako argument builda
 * (patrz apps/web/Dockerfile). Domyślnie '/api' — w produkcji
 * nginx obsługuje tę ścieżkę, więc nie potrzebujemy pełnego URL.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],

  build: {
    // Skąd nginx będzie serwował pliki
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // Podział na paczki: vendor (react, router, query) osobno od kodu
    // aplikacji. Dzięki temu zmiana widoku nie unieważnia cache'a
    // największej paczki. Używamy formy funkcji — obiektowej nie ma
    // w rolldown, na którym stoi Vite 8.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@tanstack')) return 'query';
          return 'vendor';
        },
      },
    },
  },

  server: {
    port: 5173,
    // W trybie dev przekazujemy /api do API uruchomionego lokalnie.
    // Bez tego Vite odpowiedzie 404 na każde zapytanie do backendu.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
