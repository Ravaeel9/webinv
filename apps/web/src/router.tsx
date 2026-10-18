import { createBrowserRouter, Navigate } from 'react-router';
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
import { AccessPage } from './pages/AccessPage';
import { PersonDetailPage } from './pages/PersonDetailPage';
import { AuditPage } from './pages/AuditPage';
import { IpamListPage } from './pages/IpamListPage';
import { ImportPage } from './pages/ImportPage';
import { SubnetDetailPage } from './pages/SubnetDetailPage';
import { SubnetFormPage } from './pages/SubnetFormPage';
import { SettingsPage } from './pages/SettingsPage';
import { SettingsLayout } from './components/layout/SettingsLayout';
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
          // Strona główna to `/aplikacje`; `/` tylko na nią wskazuje,
          // żeby adres z paska adresu i linki w kodzie nie rozjeżdżały się.
          { index: true, element: <Navigate to="/aplikacje" replace /> },
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

              // ─── Macierz uprawnień do aplikacji ──────────────
              //
              // Cały blok pod `RequirePermission access:read` (ADMIN i
              // SUPER_ADMIN): macierz zawiera dane osobowe osób spoza
              // panelu, więc nie jest treścią widoczną dla roli VIEWER.
              {
                path: 'uprawnienia',
                children: [
                  {
                    index: true,
                    element: (
                      <RequirePermission permission="access:read">
                        <AccessPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'osoby/:id',
                    element: (
                      <RequirePermission permission="access:read">
                        <PersonDetailPage />
                      </RequirePermission>
                    ),
                  },
                ],
              },

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

              // ─── Katalog podsieci i adresów IP ────────────────
              //
              // Cały blok stoi w gałęzi `RequireAuth`: IPAM nie jest
              // treścią publiczną. To mapa infrastruktury — adresy
              // sieci wewnętrznych, VLAN-y i przypisania aplikacji —
              // i ani jedna trasa `/api/ipam` nie jest `@Public()`.
              // Gość nie ma w niej czego szukać.
              {
                path: 'ipam',
                children: [
                  { index: true, element: <IpamListPage /> },
                  {
                    // Ścieżka „/ipam/:id" łapie również „nowa",
                    // więc kolejność ma znaczenie — nowa jest wyżej.
                    path: 'nowa',
                    element: (
                      <RequirePermission permission="ipam:write">
                        <SubnetFormPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: 'import',
                    element: (
                      <RequirePermission permission="ipam:write">
                        <ImportPage />
                      </RequirePermission>
                    ),
                  },
                  {
                    path: ':id/edycja',
                    element: (
                      <RequirePermission permission="ipam:write">
                        <SubnetFormPage />
                      </RequirePermission>
                    ),
                  },
                  { path: ':id', element: <SubnetDetailPage /> },
                ],
              },

              // Stary adres dziennika — przekierowanie, żeby zakładki nie
              // lądowały w 404 po przeniesieniu widoku pod Ustawienia.
              {
                path: 'audyt',
                element: <Navigate to="/ustawienia/dziennik" replace />,
              },

              // Stary adres użytkowników — przekierowanie, żeby zakładki nie
              // lądowały w 404 po przeniesieniu widoku pod Ustawienia
              // (ten sam wzorzec co przy /audyt).
              {
                path: 'uzytkownicy',
                element: <Navigate to="/ustawienia/uzytkownicy" replace />,
              },

              {
                // Sekcja Ustawień grupuje widoki o różnych uprawnieniach,
                // więc sama nie ma bramki — każdy podwidok pilnuje swojego:
                // tryb demo (`settings:write`), dziennik (`audit:read`),
                // użytkownicy (`user:read`). Wspólna bramka odcięłaby
                // administratora od rzeczy, do których ma prawo.
                path: 'ustawienia',
                element: <SettingsLayout />,
                children: [
                  {
                    index: true,
                    element: (
                      <RequirePermission permission="settings:write">
                        <SettingsPage />
                      </RequirePermission>
                    ),
                  },
                  { path: 'dziennik', element: <RequirePermission permission="audit:read"><AuditPage /></RequirePermission> },
                  { path: 'uzytkownicy', element: <RequirePermission permission="user:read"><UsersPage /></RequirePermission> },
                ],
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
