import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../lib/auth';
import { Button } from '../components/ui/Button';
import { TextInput } from '../components/ui/Field';
import { ErrorMessage } from '../components/ui/Feedback';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { IconLock, IconUser } from '../components/ui/icons';
import { ApiError } from '../lib/api';

export function LoginPage() {
  const { user, isLoading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Skąd użytkownik próbował wejść przed wylogowaniem
  const from = (location.state as { from?: { pathname: string } } | null)?.from;

  if (!isLoading && user) {
    return <Navigate to={from?.pathname ?? '/'} replace />;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const loggedIn = await login(username.trim(), password);
      // Konto ze startowym hasłem musi najpierw je zmienić
      navigate(loggedIn.mustChangePassword ? '/konto' : (from?.pathname ?? '/'), {
        replace: true,
      });
    } catch (err) {
      // Sprawdzamy typ, bo `useMutation` rzuca czymkolwiek —
      // do komunikatu dla użytkownika przyjmujemy tylko ApiError.
      setError(err instanceof ApiError ? err : new ApiError(0, 'Nie udało się połączyć z serwerem.'));
      // Nie zostawiamy hasła w polu po błędzie — inaczej kliknięcie
      // „Ponów" od razu wysyła te same dane, a użytkownik zapomina,
      // co wpisał.
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  const rateLimited = error?.isRateLimited ?? false;

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-page px-4 py-10">
      {/* Miękka poświata za kartą — gradientowa identyfikacja motywu
          bez dotykania kontrastu tekstu (karta ma nieprzezroczyste tło). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <span className="absolute top-[-6rem] left-[max(1rem,calc(50%-22rem))] size-72 rounded-full bg-brand-500/15 blur-3xl dark:bg-brand-500/25" />
        <span className="absolute bottom-[-6rem] right-[max(1rem,calc(50%-22rem))] size-72 rounded-full bg-accent-500/15 blur-3xl dark:bg-accent-500/25" />
      </div>

      {/* Motyw dostępny też przed zalogowaniem — gość nie ma nagłówka
          z AppLayout, więc przełącznik wieszamy w rogu strony. */}
      <div className="absolute top-3 right-3">
        <ThemeToggle />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="mb-6 text-center">
          <span
            className="mx-auto mb-3 flex size-11 items-center justify-center
                       rounded-xl bg-linear-to-br from-brand-600 to-accent-600
                       text-lg font-bold text-white"
            aria-hidden="true"
          >
            R
          </span>
          <h1 className="text-lg font-semibold text-fg">
            Rejestr Oprogramowania
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            Zaloguj się, aby przejść do panelu
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4 px-5 py-5">
          {rateLimited && (
            <ErrorMessage
              error={
                new ApiError(
                  429,
                  'Zbyt wiele prób logowania. Odczekaj kilka minut i spróbuj ponownie.',
                )
              }
            />
          )}
          {error && !rateLimited && <ErrorMessage error={error} />}

          <TextInput
            label="Nazwa użytkownika lub e-mail"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            maxLength={200}
            icon={<IconUser className="size-4" />}
          />

          <TextInput
            label="Hasło"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            maxLength={200}
            icon={<IconLock className="size-4" />}
          />

          <Button type="submit" loading={submitting} className="w-full">
            Zaloguj się
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-fg-subtle">
          Dostęp dla pracowników organizacji. Konto zakłada administrator.
        </p>
      </div>
    </div>
  );
}
