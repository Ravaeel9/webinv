import { useState, type FormEvent } from 'react';
import {
  useCreateUser,
  useDeleteUser,
  useResetPassword,
  useUpdateUser,
  useUsers,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/layout/AppLayout';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Checkbox, Select, TextInput } from '../components/ui/Field';
import { EmptyState, ErrorMessage, Spinner } from '../components/ui/Feedback';
import { Modal } from '../components/ui/Modal';
import { Th } from '../components/ui/Table';
import { PasswordInput } from '../components/ui/PasswordField';
import { formatDateTime } from '../lib/format';
import { checkPassword } from '../lib/password';
import {
  IconCheck,
  IconDots,
  IconLock,
  IconPencil,
  IconPlus,
  IconTrash,
} from '../components/ui/icons';
import { ROLE_LABELS, type Role, type Tone, type UserListItem } from '../types';

export function UsersPage() {
  const { user: currentUser, can } = useAuth();
  const [includeInactive, setIncludeInactive] = useState(true);
  const { data, isLoading, error, refetch } = useUsers(includeInactive);

  const [editorFor, setEditorFor] = useState<'new' | UserListItem | null>(null);
  const [passwordFor, setPasswordFor] = useState<UserListItem | null>(null);
  const [deleteFor, setDeleteFor] = useState<UserListItem | null>(null);

  const canWrite = can('user:write');

  const users = data?.users ?? [];
  const superAdmins = users.filter(
    (u) => u.role === 'SUPER_ADMIN' && u.isActive,
  );

  return (
    <>
      <PageHeader
        title="Użytkownicy"
        description={
          isLoading
            ? undefined
            : `${users.length} ${users.length === 1 ? 'konto' : 'kont'}`
        }
        actions={
          canWrite && (
            <Button onClick={() => setEditorFor('new')}>
              <IconPlus className="size-4" />
              Dodaj użytkownika
            </Button>
          )
        }
      />

      <div className="card mb-4 px-4 py-3">
        <Checkbox
          label="Pokazuj nieaktywne konta"
          checked={includeInactive}
          onChange={(e) => setIncludeInactive(e.target.checked)}
        />
      </div>

      <ErrorMessage error={error} onRetry={() => refetch()} className="mb-4" />

      {superAdmins.length <= 1 && superAdmins.length === 1 && (
        <p className="alert alert-warn mb-4 py-2.5">
          To jedyne aktywne konto super administratora. Jego roli nie da się
          zmienić ani go wyłączyć, dopóki nie powstanie drugie.
        </p>
      )}

      <div className="card overflow-hidden">
        {isLoading ? (
          <Spinner />
        ) : users.length === 0 ? (
          <EmptyState
            title="Brak użytkowników"
            description={
              includeInactive
                ? 'Dodaj pierwsze konto, aby zespół mógł się logować.'
                : 'Wszystkie konta są nieaktywne.'
            }
            action={
              canWrite && (
                <Button onClick={() => setEditorFor('new')}>
                  <IconPlus className="size-4" />
                  Dodaj użytkownika
                </Button>
              )
            }
          />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-line-strong bg-surface-2">
                <tr>
                  <Th>Imię i nazwisko</Th>
                  <Th>Nazwa użytkownika</Th>
                  <Th>E-mail</Th>
                  <Th>Rola</Th>
                  <Th>Ostatnie logowanie</Th>
                  <Th>Stan</Th>
                  {canWrite && (
                    <Th className="w-10">
                      <span className="sr-only">Akcje</span>
                    </Th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {users.map((u) => (
                  <UserRow
                    key={u.id}
                    user={u}
                    isSelf={u.id === currentUser?.id}
                    canWrite={canWrite}
                    onEdit={() => setEditorFor(u)}
                    onResetPassword={() => setPasswordFor(u)}
                    onDelete={() => setDeleteFor(u)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editorFor && (
        <UserEditorModal
          target={editorFor === 'new' ? null : editorFor}
          onClose={() => setEditorFor(null)}
        />
      )}

      {passwordFor && (
        <ResetPasswordModal
          target={passwordFor}
          onClose={() => setPasswordFor(null)}
        />
      )}

      {deleteFor && (
        <DeleteUserModal target={deleteFor} onClose={() => setDeleteFor(null)} />
      )}
    </>
  );
}

function UserRow({
  user,
  isSelf,
  canWrite,
  onEdit,
  onResetPassword,
  onDelete,
}: {
  user: UserListItem;
  isSelf: boolean;
  canWrite: boolean;
  onEdit: () => void;
  onResetPassword: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);

  // Ton zamiast składania klas z palety. Wcześniej `SUPER_ADMIN` i `ADMIN`
  // miały wyłącznie klasy `dark:`, więc w trybie jasnym te odznaki
  // renderowały się bez tła — były niewidoczne.
  const roleTone: Tone =
    user.role === 'SUPER_ADMIN' ? 'violet' : user.role === 'ADMIN' ? 'info' : 'neutral';

  return (
    <tr className={`transition-colors hover:bg-surface-2/70 ${user.isActive ? '' : 'opacity-60'}`}>
      <td className="px-4 py-2.5">
        <span className="font-medium text-fg">{user.fullName}</span>
        {isSelf && (
          <span className="ml-1.5 meta-text">(Ty)</span>
        )}
        {user.mustChangePassword && (
          <Badge tone="warn" dot={false} className="ml-1.5 text-[11px]">
            musi zmienić hasło
          </Badge>
        )}
      </td>

      <td className="px-4 py-2.5">
        <span className="font-mono meta-text">{user.username}</span>
      </td>

      <td className="px-4 py-2.5">
        <a
          href={`mailto:${user.email}`}
          className="text-fg-muted hover:text-brand-600"
        >
          {user.email}
        </a>
      </td>

      <td className="px-4 py-2.5">
        <Badge tone={roleTone}>{ROLE_LABELS[user.role]}</Badge>
      </td>

      <td className="px-4 py-2.5 meta-text">
        {formatDateTime(user.lastLoginAt)}
      </td>

      <td className="px-4 py-2.5">
        <Badge tone={user.isActive ? 'ok' : 'neutral'}>
          {user.isActive ? 'aktywne' : 'wyłączone'}
        </Badge>
      </td>

      {canWrite && (
        <td className="px-4 py-2.5 text-right">
          <div className="relative inline-block">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={`Akcje dla ${user.username}`}
              className="rounded-md p-1.5 text-fg-subtle hover:bg-surface-2 hover:text-fg-muted"
            >
              <IconDots className="size-4" />
            </button>

            {open && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setOpen(false)}
                  aria-hidden="true"
                />
                <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg">
                  <MenuItem
                    icon={<IconPencil className="size-4 text-fg-muted" />}
                    onClick={() => { setOpen(false); onEdit(); }}
                  >
                    Edytuj konto
                  </MenuItem>
                  <MenuItem
                    icon={<IconLock className="size-4 text-fg-muted" />}
                    onClick={() => { setOpen(false); onResetPassword(); }}
                  >
                    Ustaw hasło
                  </MenuItem>
                  {!isSelf && (
                    <MenuItem
                      danger
                      icon={<IconTrash className="size-4" />}
                      onClick={() => { setOpen(false); onDelete(); }}
                    >
                      Usuń konto
                    </MenuItem>
                  )}
                </div>
              </>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
  icon,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-page ${
        danger ? 'text-rose-600 hover:bg-rose-500/10 dark:text-rose-400' : 'text-fg'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

/** Id formularza — przycisk w stopce modala odwołuje się do niego atrybutem `form`. */
const FORM_ID = 'user-editor-form';

interface UserFormState {
  username: string;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  password: string;
}

function UserEditorModal({
  target,
  onClose,
}: {
  target: UserListItem | null;
  onClose: () => void;
}) {
  const isNew = target === null;

  const [form, setForm] = useState<UserFormState>({
    username: target?.username ?? '',
    email: target?.email ?? '',
    fullName: target?.fullName ?? '',
    role: target?.role ?? 'VIEWER',
    isActive: target?.isActive ?? true,
    // Nowe konto dostaje hasło startowe i musi je zmienić przy
    // pierwszym logowaniu — dlatego pole jest wymagane tylko przy tworzeniu.
    password: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const create = useCreateUser();
  const update = useUpdateUser();
  const mutation = isNew ? create : update;

  const set = <K extends keyof UserFormState>(
    key: K,
    value: UserFormState[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const { [key]: _drop, ...rest } = prev;
      return rest;
    });
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};

    if (isNew || form.username !== target?.username) {
      if (form.username.trim().length < 3) {
        next.username = 'Minimum 3 znaki.';
      } else if (!/^[a-zA-Z0-9._-]+$/.test(form.username.trim())) {
        next.username = 'Dozwolone: litery, cyfry oraz . _ -';
      }
    }

    if (!form.fullName.trim()) next.fullName = 'Imię i nazwisko jest wymagane.';

    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      next.email = 'Podaj poprawny adres e-mail.';
    }

    if (isNew) {
      const check = checkPassword(form.password);
      if (!check.ok) next.password = check.errors.join(' ');
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validate()) return;

    if (isNew) {
      await create.mutateAsync({
        username: form.username.trim(),
        email: form.email.trim(),
        fullName: form.fullName.trim(),
        role: form.role,
        password: form.password,
      });
    } else {
      // UpdateUserDto nie przyjmuje hasła — reset osobnym endpointem
      const payload: Record<string, unknown> = {
        username: form.username.trim(),
        email: form.email.trim(),
        fullName: form.fullName.trim(),
        role: form.role,
        isActive: form.isActive,
      };
      await update.mutateAsync({ id: target.id, ...payload });
    }

    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'Nowy użytkownik' : `Edycja: ${target.fullName}`}
      description={
        isNew
          ? 'Konto dostanie hasło startowe i będzie musiało je zmienić przy pierwszym logowaniu.'
          : 'Zmiana roły lub wyłączenie konta zamyka jego aktywne sesje.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Anuluj
          </Button>
          {/* Przycisk żyje w stopce modala, poza <form>, więc
              wskazujemy go atrybutem `form` zamiast onClickiem. */}
          <Button type="submit" form={FORM_ID} loading={mutation.isPending}>
            {isNew ? (
              <IconPlus className="size-4" />
            ) : (
              <IconCheck className="size-4" />
            )}
            {isNew ? 'Utwórz konto' : 'Zapisz'}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} noValidate className="space-y-4">
        <ErrorMessage error={mutation.error} />

        <TextInput
          label="Nazwa użytkownika"
          required
          value={form.username}
          onChange={(e) => set('username', e.target.value)}
          error={errors.username}
          hint="Litery, cyfry oraz znaki . _ -"
          maxLength={64}
        />

        <TextInput
          label="Imię i nazwisko"
          required
          value={form.fullName}
          onChange={(e) => set('fullName', e.target.value)}
          error={errors.fullName}
          maxLength={200}
        />

        <TextInput
          label="E-mail"
          type="email"
          required
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          error={errors.email}
          maxLength={200}
        />

        <Select
          label="Rola"
          value={form.role}
          onChange={(e) => set('role', e.target.value as Role)}
          hint={
            form.role === 'SUPER_ADMIN'
              ? 'Może zarządzać użytkownikami i wszystkim w rejestrze.'
              : form.role === 'ADMIN'
                ? 'Może dodawać i edytować aplikacje, nie zarządza kontami.'
                : 'Tylko odczyt.'
          }
        >
          {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </Select>

        {isNew ? (
          <PasswordInput
            label="Hasło startowe"
            required
            value={form.password}
            onChange={(value) => set('password', value)}
            error={errors.password}
            hint="Przekaż je użytkownikowi bezpiecznym kanałem — pole jest jawne, żeby dało się je odczytać i przekazać."
            autoComplete="new-password"
            showRules
          />
        ) : (
          <Checkbox
            label="Konto aktywne"
            checked={form.isActive}
            onChange={(e) => set('isActive', e.target.checked)}
            hint="Wyłączone konto nie może się zalogować."
          />
        )}
      </form>
    </Modal>
  );
}

function ResetPasswordModal({
  target,
  onClose,
}: {
  target: UserListItem;
  onClose: () => void;
}) {
  const reset = useResetPassword();
  const [password, setPassword] = useState('');

  const check = checkPassword(password);

  const handleReset = async () => {
    if (!check.ok) return;
    await reset.mutateAsync({ id: target.id, newPassword: password });
    onClose();
  };

  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title="Ustaw nowe hasło"
      description={`Dla konta ${target.username} (${target.fullName})`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Anuluj
          </Button>
          <Button
            loading={reset.isPending}
            disabled={!check.ok}
            onClick={handleReset}
          >
            <IconLock className="size-4" />
            Ustaw hasło
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorMessage error={reset.error} />

        <p className="alert alert-warn px-3 py-2 text-xs">
          Zmiana hasła zamyka wszystkie sesje tego użytkownika. Konto będzie
          musiało ustawić własne hasło przy następnym logowaniu.
        </p>

        <PasswordInput
          label="Nowe hasło"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          showRules
        />
      </div>
    </Modal>
  );
}

function DeleteUserModal({
  target,
  onClose,
}: {
  target: UserListItem;
  onClose: () => void;
}) {
  const remove = useDeleteUser();

  const handleDelete = async () => {
    await remove.mutateAsync(target.id);
    onClose();
  };

  return (
    <Modal
      open
      size="sm"
      title="Usunąć konto?"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Anuluj
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={handleDelete}>
            <IconTrash className="size-4" />
            Usuń konto
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-fg-muted">
          Konto <strong className="text-fg">{target.username}</strong> (
          {target.fullName}) zostanie trwale usunięte.
        </p>

        <p className="meta-text">
          Usunięcie jest możliwe tylko wtedy, gdy nikt nie przypisał temu kontu
          żadnej aplikacji jako właściciela. Jeśli tak jest właśnie ten przypadek,
          lepiej wyłączyć konto — zachowasz historię.
        </p>

        <ErrorMessage error={remove.error} />
      </div>
    </Modal>
  );
}
