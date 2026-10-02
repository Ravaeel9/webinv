import { Navigate, Outlet, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { useAuth } from '../../lib/auth';
import type { Permission } from '../../types';
import { Spinner } from '../ui/Feedback';

/**
 * Bramka trasy: sprawdza sesję przed dopuszczeniem do widoku.
 *
 * Trzy stany, których nie wolno zmieszać:
 *  - `isLoading` → jeszcze nie wiemy, czy jest sesja (pokaż spinner)
 *  - brak usera  → wypisz na /logowanie, zapamiętując skąd przyszliśmy
 *  - `mustChangePassword` → jedyna dozwolona droga to /konto
 */
export function RequireAuth() {
  const { user, isLoading, mustChangePassword } = useAuth();
  const location = useLocation();

  if (isLoading) return <Spinner label="Sprawdzanie sesji…" />;

  if (!user) {
    return <Navigate to="/logowanie" replace state={{ from: location }} />;
  }

  // Konto ze startowym hasłem nie może korzystać z reszty aplikacji,
  // dopóki hasła nie zmieni.
  if (mustChangePassword && location.pathname !== '/konto') {
    return <Navigate to="/konto" replace />;
  }

  return <Outlet />;
}

/**
 * Bramka uprawnień.
 *
 * Dwa sposoby użycia, bo trasy niżej są pisane wygodniej z jawnym
 * elementem niż z zagnieżdżonym layoutem:
 *  - `<RequirePermission permission="user:read">` — opakowuje widok
 *  - jako `element` trasy z dzieckiem `index` — wypuszcza `<Outlet />`
 */
import { IconAlert } from '../ui/icons';

export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children?: ReactNode;
}) {
  const { can } = useAuth();

  if (!can(permission)) {
    return (
      <div className="card mx-auto max-w-lg px-6 py-12 text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
          <IconAlert className="size-6" />
        </div>
        <h1 className="text-base font-semibold text-fg">
          Brak uprawnień
        </h1>
        <p className="mx-auto mt-1 max-w-sm text-sm text-fg-muted">
          Twoja rola nie pozwala otworzyć tej strony. Skontaktuj się
          z administratorem, jeśli uważasz, że to błąd.
        </p>
      </div>
    );
  }

  return children ? <>{children}</> : <Outlet />;
}
