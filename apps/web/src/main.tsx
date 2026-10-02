import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from './router';
import { ThemeProvider } from './lib/theme';
import './index.css';

/**
 * QueryClient z rozsądnymi ustawieniami retry.
 * 401 (wylogowanie) i 403 (brak uprawnień) nie są błądami sieciowymi,
 * więc nie próbujemy ich ponawiać w nieskończoność — tym zajmuje się UI.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        const err = error as { isUnauthorized?: boolean; isForbidden?: boolean };
        if (err?.isUnauthorized || err?.isForbidden) return false;
        return failureCount < 3;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

const root = document.getElementById('root');
if (!root) {
  throw new Error('Nie znaleziono elementu #root w index.html');
}

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
