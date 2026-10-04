import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../lib/auth';
import { useChangePassword, useRevokeSession, useSessions } from '../lib/queries';
import { Button } from '../components/ui/Button';
import { TextInput } from '../components/ui/Field';
import { EmptyState, ErrorMessage, Spinner } from '../components/ui/Feedback';
import {
  PasswordConfirm,
  PasswordInput,
} from '../components/ui/PasswordField';
import { PageHeader } from '../components/layout/AppLayout';
import { ROLE_LABELS } from '../types';
import { formatDateTime } from '../lib/format';
import { checkPassword } from '../lib/password';
import {
  IconCheck,
  IconLock,
  IconLogout,
  IconMonitor,
  IconUser,
  IconX,
} from '../components/ui/icons';

export function AccountPage() {
  const { user, mustChangePassword, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        title="Moje konto"
        description="Dane profilu, hasło i aktywne sesje"
      />

      {mustChangePassword && (
        <div className="alert alert-warn mb-5">
          <strong className="font-semibold">Ustaw własne hasło.</strong> Twoje
          konto działa na haśle nadanym przez administratora — dopóki go nie
          zmienisz, dostęp do rejestru będzie ograniczony.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card px-5 py-4">
          <h2 className="section-title">
            <IconUser />
            Profil
          </h2>

          <dl className="space-y-3">
            <Row label="Imię i nazwisko">{user?.fullName}</Row>
            <Row label="Nazwa użytkownika">
              <span className="font-mono text-xs">{user?.username}</span>
            </Row>
            <Row label="E-mail">{user?.email}</Row>
            <Row label="Rola">
              {user ? ROLE_LABELS[user.role] : ''}
            </Row>
          </dl>

          <div className="mt-5 border-t border-line pt-4">
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                await logout();
                navigate('/logowanie', { replace: true });
              }}
            >
              <IconLogout className="size-4" />
              Wyloguj się
            </Button>
          </div>
        </section>

        <ChangePasswordCard />
      </div>

      <SessionsCard />
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="field-value min-w-0 break-words">{children}</dd>
    </div>
  );
}

function ChangePasswordCard() {
  const { user, mustChangePassword } = useAuth();
  const mutation = useChangePassword();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalErrors({});

    // Walidacja jest lokalna — nie wysyłamy niczego do serwera,
    // dopóki hasło nie spełnia polityki. Serwer i tak sprawdza to
    // samo, ale użytkownik dostanie wtedy pełną listę braków.
    const check = checkPassword(next);
    if (!check.ok) {
      setLocalErrors({ next: check.errors.join(' ') });
      return;
    }
    if (next !== repeat) {
      setLocalErrors({ repeat: 'Hasła nie są identyczne.' });
      return;
    }

    try {
      await mutation.mutateAsync({ currentPassword: current, newPassword: next });
      // Serwer unieważnia wszystkie sesje i wystawia nową, więc
      // stare pola możemy wyczyścić.
      setCurrent('');
      setNext('');
      setRepeat('');
    } catch {
      // Błąd pokazuje ErrorMessage poniżej
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 px-5 py-4">
      <h2 className="section-title mb-0">
        <IconLock />
        {mustChangePassword ? 'Ustaw nowe hasło' : 'Zmiana hasła'}
      </h2>

      {mutation.isSuccess && (
        <p
          className="alert alert-ok px-3 py-2"
          role="status"
        >
          Hasło zmienione. Pozostałe sesje zostały zamknięte.
        </p>
      )}

      <ErrorMessage error={mutation.error} />

      <TextInput
        label="Aktualne hasło"
        type="password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        autoComplete="current-password"
        required
      />

      <PasswordInput
        label="Nowe hasło"
        value={next}
        onChange={setNext}
        error={localErrors.next}
        autoComplete="new-password"
        required
        showRules
      />

      <PasswordConfirm
        label="Powtórz nowe hasło"
        value={repeat}
        onChange={setRepeat}
        error={localErrors.repeat}
      />

      <Button
        type="submit"
        loading={mutation.isPending}
        disabled={!checkPassword(next).ok || next !== repeat}
      >
        <IconCheck className="size-4" />
        Zmień hasło
      </Button>

      <p className="meta-text">
        Konto: <span className="font-mono">{user?.username}</span>. Po zmianie
        hasła pozostałe sesje zostaną zamknięte.
      </p>
    </form>
  );
}

function SessionsCard() {
  const { data, isLoading, error } = useSessions();
  const revoke = useRevokeSession();

  const sessions = data?.sessions ?? [];

  return (
    <section className="card mt-5">
      <div className="border-b border-line px-5 py-4">
        <h2 className="section-title mb-0">
          <IconMonitor />
          Aktywne sesje
        </h2>
        <p className="mt-0.5 meta-text">
          Każde logowanie z innego urządzenia tworzy osobną sesję. Możesz
          zamknąc dostęp, którego nie rozpoznajesz.
        </p>
      </div>

      <ErrorMessage error={error} className="m-5" />

      {isLoading ? (
        <Spinner />
      ) : sessions.length === 0 ? (
        <EmptyState title="Brak aktywnych sesji" />
      ) : (
        <ul className="divide-y divide-line">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
            >
              <div className="min-w-0">
                <p className="field-value truncate">
                  {session.userAgent ?? 'Nieznane urządzenie'}
                </p>
                <p className="meta-text">
                  IP {session.ip ?? '—'} · logowanie{' '}
                  {formatDateTime(session.createdAt)} · ostatnia aktywność{' '}
                  {formatDateTime(session.lastSeenAt)}
                </p>
              </div>

              <Button
                variant="secondary"
                size="sm"
                loading={revoke.isPending}
                onClick={() => revoke.mutate(session.id)}
              >
                <IconX className="size-3.5" />
                Zamknij
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
