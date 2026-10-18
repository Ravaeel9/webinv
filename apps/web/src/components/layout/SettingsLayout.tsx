import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../../lib/auth';
import { IconGear, IconHistory, IconUsers } from '../ui/icons';

/**
 * Wspólny szkielet sekcji Ustawienia: pasek zakładek + treść podstrony.
 *
 * Sekcja grupuje widoki o **różnych** uprawnieniach, więc zakładki są
 * filtrowane per pozycja — super administrator widzi wszystkie trzy,
 * administrator tylko „Użytkowników" i „Dziennik", widz wyłącznie
 * „Użytkowników". Gość bez żadnego z tych uprawnień nie powinien w ogóle
 * trafić pod ten adres (menu i tak nie ma dla niego linku), a pusty pasek
 * bez zakładek nie szkodzi — dziecko i tak wyświetli „Brak uprawnień".
 *
 * Zakładki to ten sam wzorzec kafelków co w widoku Uprawnień: stan aktywny
 * to `.tab-active` (tint + krawędź), nie wypełnienie kolorem marki.
 */
const ZAKLADKI = [
  {
    to: '/ustawienia',
    label: 'System',
    icon: IconGear,
    permission: 'settings:write',
    // Zakładka na adres sekcji — bez `end` podświetlałaby się też na
    // podstronach. Tu akurat nie zaszkodzi (podstrony mają własne pozycje),
    // ale jawnie: „System" to tylko index.
    end: true,
  },
  {
    to: '/ustawienia/uzytkownicy',
    label: 'Użytkownicy',
    icon: IconUsers,
    permission: 'user:read',
    end: false,
  },
  {
    to: '/ustawienia/dziennik',
    label: 'Dziennik zdarzeń',
    icon: IconHistory,
    permission: 'audit:read',
    end: false,
  },
] as const;

export function SettingsLayout() {
  const { can } = useAuth();
  const widoczne = ZAKLADKI.filter((z) => can(z.permission));

  return (
    <>
      {widoczne.length > 0 && (
        <div
          className="mb-4 flex flex-wrap gap-2"
          role="tablist"
          aria-label="Sekcje ustawień"
        >
          {widoczne.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              role="tab"
              className={({ isActive }) => [
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition',
                isActive
                  ? 'tab-active'
                  : 'bg-surface text-fg-muted ring-line-strong hover:bg-page',
              ].join(' ')}
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </div>
      )}
      <Outlet />
    </>
  );
}
