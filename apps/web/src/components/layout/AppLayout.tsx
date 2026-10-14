import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../../lib/auth';
import { ROLE_LABELS } from '../../types';
import { initials } from '../../lib/format';
import { Button } from '../ui/Button';
import { ThemeToggle } from '../ui/ThemeToggle';
import { VersionBadge } from '../ui/VersionBadge';
import {
  IconChevronLeft,
  IconGauge,
  IconGear,
  IconHistory,
  IconLogout,
  IconMenu,
  IconNetwork,
  IconUsers,
  IconX,
} from '../ui/icons';

/**
 * Pozycje nawigacji — `permission` decyduje o widoczności.
 *
 * Rejestru (`/aplikacje`) tu nie ma: wejściem do niego jest logo w
 * nagłówku, a `/` i tak przekierowuje na tę listę. Świadomie — pozycja
 * znika z menu, nie z aplikacji, i z jej usunięciem znika też jedyny
 * sygnał „jesteś w rejestrze", czyli `nav-item-active`. Dlatego zostawiamy
 * link w logo.
 */
const NAV = [
  { to: '/pulpit', label: 'Pulpit', icon: IconGauge, requiresAuth: true },
  // Przed „Użytkownikami", żeby grupował się z zasobami (podsieć,
  // aplikacja), a nie z narzędziami (dziennik, ustawienia).
  // `requiresAuth` jest tu nieopcjonalny: IPAM nie jest treścią
  // publiczną i nie ma widoku dla gościa.
  { to: '/ipam', label: 'Adresy IP', icon: IconNetwork, permission: 'ipam:read', requiresAuth: true },
  { to: '/uzytkownicy', label: 'Użytkownicy', icon: IconUsers, permission: 'user:read', requiresAuth: true },
  { to: '/audyt', label: 'Dziennik zdarzeń', icon: IconHistory, permission: 'audit:read', requiresAuth: true },
  // Tylko super admin: `settings:write` pozwala wyłączyć tryb demo
  // i skasować 30 przykładowych rekordów naraz.
  { to: '/ustawienia', label: 'Ustawienia', icon: IconGear, permission: 'settings:write', requiresAuth: true },
] as const;

export function AppLayout() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  /**
   * Bez sesji `can()` zwraca false dla wszystkiego, więc pozycje
   * z uprawnieniem znikają same. Pozostaje dopisać pozycje wymagające
   * zalogowania, ale bez uprawnienia (np. „Pulpit") — inaczej gość
   * widziałby link do strony, która od razu wyrzuci go na /logowanie.
   */
  const visibleNav = NAV.filter(
    (item) =>
      (!('requiresAuth' in item) || !item.requiresAuth || Boolean(user)) &&
      (!('permission' in item) || can(item.permission)),
  );

  const handleLogout = async () => {
    await logout();
    // `/` przekierowuje na `/aplikacje` — po wylogowaniu wracamy
    // na stronę główną, nie na formularz logowania.
    navigate('/', { replace: true });
  };

  const navLinks = (
    <>
      {visibleNav.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          // Bez `end` — żadna pozycja nie jest trasą „korzenia",
          // więc dopasowanie jest zawsze prefiksowe.
          end={false}
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) =>
            [
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'nav-item-active'
                : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
            ].join(' ')
          }
        >
          <item.icon className="size-4" />
          {item.label}
        </NavLink>
      ))}
    </>
  );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          {/* Logo — prowadzi na stronę główną, czyli rejestr */}
          <NavLink to="/aplikacje" className="flex shrink-0 items-center gap-2">
            <span
              className="flex size-8 items-center justify-center rounded-lg
                         bg-linear-to-br from-brand-600 to-accent-600
                         text-sm font-bold text-white"
              aria-hidden="true"
            >
              R
            </span>
            <span className="hidden text-sm font-semibold text-fg sm:block">
              Rejestr Oprogramowania
            </span>
          </NavLink>

          {/* Nawigacja — desktop */}
          <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="Nawigacja główna">
            {navLinks}
          </nav>

          {/* Konto — gość widzi tylko wejście, bo nie ma sesji */}
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            {user ? (
              <>
                <NavLink
                  to="/konto"
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5
                             hover:bg-surface-2"
                  title="Moje konto"
                >
                  <span
                    className="flex size-7 items-center justify-center rounded-full
                               bg-linear-to-br from-brand-500 to-accent-500
                               text-xs font-semibold text-white"
                    aria-hidden="true"
                  >
                    {initials(user.fullName)}
                  </span>
                  <span className="hidden text-left lg:block">
                    <span className="block text-xs font-medium leading-tight text-fg">
                      {user.fullName}
                    </span>
                    <span className="block text-[11px] leading-tight text-fg-muted">
                      {ROLE_LABELS[user.role]}
                    </span>
                  </span>
                </NavLink>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleLogout}
                  className="hidden sm:inline-flex"
                >
                  <IconLogout className="size-4" />
                  Wyloguj
                </Button>
              </>
            ) : (
              <NavLink
                to="/logowanie"
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium
                           text-white transition-colors hover:bg-brand-700"
              >
                Zaloguj się
              </NavLink>
            )}

            {/* Przełącznik menu mobilnego */}
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              aria-expanded={mobileOpen}
              aria-label="Przełącz menu"
              className="rounded-lg p-2 text-fg-muted hover:bg-surface-2 md:hidden"
            >
              {mobileOpen ? (
                <IconX className="size-5" />
              ) : (
                <IconMenu className="size-5" />
              )}
            </button>
          </div>
        </div>

        {/* Nawigacja — mobile */}
        {mobileOpen && (
          <nav
            className="border-t border-line px-4 py-2 md:hidden"
            aria-label="Nawigacja mobilna"
          >
            <div className="flex flex-col gap-1">{navLinks}</div>
            {user ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleLogout}
                className="mt-2 w-full"
              >
                <IconLogout className="size-4" />
                Wyloguj
              </Button>
            ) : (
              <NavLink
                to="/logowanie"
                className="mt-2 block rounded-lg bg-brand-600 px-3 py-2
                           text-center text-sm font-medium text-white
                           transition-colors hover:bg-brand-700"
              >
                Zaloguj się
              </NavLink>
            )}
          </nav>
        )}

        {/* Linia akcentu na dolnej krawędzi nagłówka — spina niebiesko-
            zieloną identyfikację motywu bez dotykania treści strony. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5
                     bg-linear-to-r from-brand-500/80 via-accent-500/80 to-brand-500/80"
        />
      </header>

      {/* `pb-14` zostawia miejsce na plakietkę wersji w prawym dolnym
          rogu — bez tego `fixed` zasłaniałby ostatni wiersz listy. */}
      <main className="mx-auto max-w-7xl px-4 pb-14 pt-6 sm:px-6">
        <Outlet />
      </main>

      <VersionBadge />
    </div>
  );
}

/** Nagłówek strony — tytuł, opcjonalny opis i akcje po prawej. */
export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  back?: { to: string; label: string };
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <NavLink
            to={back.to}
            className="mb-1 inline-flex items-center gap-1 text-xs font-medium
                       text-fg-muted hover:text-brand-600"
          >
            <IconChevronLeft className="size-3.5" />
            {back.label}
          </NavLink>
        )}
        <h1 className="page-title break-words">{title}</h1>
        {description && (
          <p className="mt-0.5 text-sm text-fg-muted">{description}</p>
        )}
      </div>

      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}
