import { createBrowserRouter } from 'react-router';
import { AuthProvider } from './lib/auth';
import { AppLayout } from './components/layout/AppLayout';
import { RequireAuth, RequirePermission } from './components/layout/guards';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { AccountPage } from './pages/AccountPage';
import { ApplicationsListPage } from './pages/ApplicationsListPage';
import { ApplicationFormPage } from './pages/ApplicationFormPage';
import { ApplicationDetailPage } from './pages/ApplicationDetailPage';
import { UsersPage } from './pages/UsersPage';
import { AuditPage } from './pages/AuditPage';
import { EmptyState } from './components/ui/Feedback';
import { RouteErrorPage } from './components/layout/RouteErrorPage';

/**
 * Trasy są PL i bez diakrytyków (`/aplikacje`, `/uzytkownicy`) —
 * są bezpieczniejsze w linkach, skrótach i zakładkach niż polskie znaki.
 */
export const router = createBrowserRouter([
  {
    // AuthProvider jest korzeniem całej aplikacji, również dla
    // `/logowanie` — LoginPage czyta z niego `login()` i stan sesji.
    // Dlatego logowanie musi być dzieckiem tego elementu, a nie
    // osobną trasą obok niego.
    element: <AuthProvider />,
    // Awaria w AuthProvider samym w sobie (np. `useQuery` poza
    // QueryClientProvider) nie ma sensu pokazywać jako gość —
    // i tak nie da się nic zrobić, zostaje ekran błędu.
    errorElement: <RouteErrorPage />,
    children: [
      { path: '/logowanie', element: <LoginPage /> },

      // ─── Widok publiczny (tylko odczyt) ────────────────────
      // Lista i szczegóły aplikacji mają być dostępne bez sesji,
      // więc stoją poza `RequireAuth`. Zapis i tak wymaga
      // `app:write` po stronie API, więc widok jest tylko do odczytu.
      //
      // `/` to strona główna — rejestr, bez logowania. Pulpit
      // przeniesiony na `/pulpit` i dostępny tylko zalogowanym.
      {
        element: <AppLayout />,
        errorElement: <RouteErrorPage />,
        children: [
          { index: true, element: <ApplicationsListPage /> },
          { path: 'aplikacje', element: <ApplicationsListPage /> },
          { path: 'aplikacje/:id', element: <ApplicationDetailPage /> },
        ],
      },

      // ─── Panel (wymaga zalogowania) ─────────────────────────
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppLayout />,
            errorElement: <RouteErrorPage />,
            children: [
              { path: 'pulpit', element: <DashboardPage /> },
              { path: 'konto', element: <AccountPage /> },

              {
                path: 'aplikacje',
                children: [
                  {
                    // Ścieżka „/aplikacje/:id" łapie również „nowa",
                    // więc kolejność ma znaczenie — nowa jest wyżej.
                    path: 'nowa',
                    element: (
                      <RequirePermission permission="app:write">
                        <ApplicationFormPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: ':id/edycja',
                    element: (
                      <RequirePermission permission="app:write">
                        <ApplicationFormPage />
                      </RequirePermission>
                    ),
                  },
                ],
              },

              {
                path: 'uzytkownicy',
                element: (
                  <RequirePermission permission="user:read">
                    <UsersPage />
                  </RequirePermission>
                ),
              },

              {
                path: 'audyt',
                element: (
                  <RequirePermission permission="audit:read">
                    <AuditPage />
                  </RequirePermission>
                ),
              },

              {
                path: '*',
                element: (
                  <div className="card mx-auto max-w-lg">
                    <EmptyState
                      title="Nie znaleziono strony"
                      description="Adres, który otworzyłeś, nie istnieje w tej aplikacji."
                    />
                  </div>
                ),
              },
            ],
          },
        ],
      },
      // Gość nie przechodzi przez `RequireAuth`, więc jego nieznane
      // adresy obsługuje własny 404 — bez przekierowania na pulpit,
      // który i tak wymagałby zalogowania.
      {
        element: <AppLayout />,
        children: [
          {
            path: '*',
            element: (
              <div className="card mx-auto max-w-lg">
                <EmptyState
                  title="Nie znaleziono strony"
                  description="Adres, który otworzyłeś, nie istnieje w tej aplikacji."
                />
              </div>
            ),
          },
        ],
      },
    ],
  },
]);
