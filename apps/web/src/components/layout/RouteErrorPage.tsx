import { useRouteError, isRouteErrorResponse, Link } from 'react-router';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/Feedback';

/**
 * Ekran błędu trasy.
 *
 * Bez tego React wypisuje na białym tle „Unexpected Application Error!"
 * wraz ze stack trace'em — widocznym w devtoolsach każdemu, kto otworzy
 * stronę, i zupełnie nieprzydatnym dla osoby, która chciała po prostu
 * zobaczyć listę aplikacji.
 *
 * Treść błędu pokazujemy tylko w trybie deweloperskim (`import.meta.env.DEV`).
 * W produkcji stack trace na ekranie to wyciek informacji o wewnętrznej
 * strukturze aplikacji, a użytkownikowi nic nie wnosi.
 */
export function RouteErrorPage() {
  const error = useRouteError();

  const title = isRouteErrorResponse(error)
    ? `${error.status} — ${error.statusText || 'błąd strony'}`
    : 'Coś poszło nie tak';

  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    // `bg-transparent`, nie `bg-page` — patrz `LoginPage`: pełnoekranowe tło
    // na wierzchu gradientu z `body` ukryłoby go.
    <div className="flex min-h-screen items-center justify-center bg-transparent px-4">
      <div className="card w-full max-w-lg px-6 py-8">
        <EmptyState
          title={isNotFound ? 'Nie znaleziono strony' : title}
          description={
            isNotFound
              ? 'Adres, który otworzyłeś, nie istnieje w tej aplikacji.'
              : 'Strona nie mogła się wyświetlić. Spróbuj odświeżyć — jeśli problem wraca, zgłoś go administratorowi.'
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => window.location.reload()}>
                Odśwież stronę
              </Button>
              <Link to="/aplikacje">
                <Button variant="secondary">Wróć do rejestru</Button>
              </Link>
            </div>
          }
        />

        {import.meta.env.DEV && error instanceof Error && (
          <pre className="mt-4 max-h-56 overflow-auto rounded-lg border border-line bg-surface-2 px-4 py-3 text-left text-xs text-fg">
            {error.stack ?? error.message}
          </pre>
        )}
      </div>
    </div>
  );
}
