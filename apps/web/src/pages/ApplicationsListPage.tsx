import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  useApplicationFormOptions,
  useApplications,
  useDeleteApplication,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/layout/AppLayout';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Checkbox, Select } from '../components/ui/Field';
import { EmptyState, ErrorMessage, Spinner } from '../components/ui/Feedback';
import { Modal } from '../components/ui/Modal';
import {
  IconChevronLeft,
  IconChevronRight,
  IconDots,
  IconDownload,
  IconFilter,
  IconGrid,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTag,
  IconTrash,
  IconX,
} from '../components/ui/icons';
import { downloadApplicationsCsv } from '../lib/queries';
import {
  ACCESS_REQUEST_NO,
  ACCESS_REQUEST_YES,
  CRITICALITY_COLORS,
  CRITICALITY_LABELS,
  SECURITY_COLORS,
  SECURITY_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  type AppStatus,
  type Application,
  type ApplicationFilters,
  type SecurityClass,
} from '../types';
import { ApiError } from '../lib/api';

const PAGE_SIZE = 25;

/**
 * Kolumny sortujące — muszą pokrywać się z białą listą SORTABLE w API.
 *
 * Uwaga na kierunek: `SORTABLE` w API trzyma dla każdego pola jego
 * *domyślną* kolejność, a prefiks `-` ją odwraca. Dla `introducedOn`
 * i `updatedAt` domyślna jest malejąca (`desc`), więc „najnowsze”
 * to **bez** minusa — z minusem wyszłyby najstarsze.
 *
 * `guestHidden` oznacza sortowanie, którego gość nie dostanie: krytyczność
 * i klasyfikacja bezpieczeństwa nie są w jego widoku, więc kolejność
 * wierszy zdradzałaby ukrytą wartość. API i tak takie sortowanie ignoruje
 * (`GUEST_SORTABLE`), tu po prostu nie pokazujemy go w menu.
 */
const SORT_OPTIONS = [
  { value: '', label: 'Domyślnie (nazwa A→Z)' },
  { value: 'name', label: 'Nazwa A→Z' },
  { value: '-name', label: 'Nazwa Z→A' },
  { value: 'criticality', label: 'Krytyczność ↓', guestHidden: true },
  { value: 'status', label: 'Status' },
  { value: 'introducedOn', label: 'Najnowsze' },
  { value: '-introducedOn', label: 'Najstarsze' },
  { value: 'updatedAt', label: 'Ostatnio zmienione' },
];

export function ApplicationsListPage() {
  const { can, user } = useAuth();
  const [params, setParams] = useSearchParams();

  // ─── Filtry ────────────────────────────────────────────────
  // Trzymamy je w URL, żeby dało się linkować do widoku
  // (np. z pulpitu) i udostępnić go koledze.
  const filters: ApplicationFilters = useMemo(
    () => ({
      q: params.get('q') ?? undefined,
      status: params.get('status') ?? undefined,
      securityClass: params.get('securityClass') ?? undefined,
      ownerId: params.get('ownerId') ?? undefined,
      environmentId: params.get('environmentId') ?? undefined,
      category: params.get('category') ?? undefined,
      criticality: params.get('criticality')
        ? Number(params.get('criticality'))
        : undefined,
      includeDeleted: params.get('includeDeleted') === 'true',
      missingOwner: params.get('missingOwner') === 'true',
      sort: params.get('sort') ?? undefined,
      limit: PAGE_SIZE,
      offset: Number(params.get('offset') ?? 0),
    }),
    [params],
  );

  const setFilter = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '' || value === 'false') {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    // Każda zmiana filtra wraca na pierwszą stronę
    if (key !== 'offset') next.delete('offset');
    setParams(next, { replace: true });
  };

  const clearFilters = () => setParams(new URLSearchParams(), { replace: true });

  const { data, isLoading, isFetching, error, refetch } = useApplications(filters);
  // Słownik użytkowników idzie tylko do opisu filtra „Właściciel",
  // a `/users/options` wymaga sesji — gość nie musi go pobierać.
  const { environments, users } = useApplicationFormOptions(Boolean(user));

  // Pole wyszukiwania ma własny stan, żeby nie odpytywać API
  // na każdy znak — synchronizujemy je z URL przy zmianie filtra.
  const [search, setSearch] = useState(filters.q ?? '');
  useEffect(() => setSearch(filters.q ?? ''), [filters.q]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setFilter('q', search.trim());
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const offset = filters.offset ?? 0;
  const hasMore = data?.hasMore ?? false;

  /**
   * Gość nie widzi klasyfikacji bezpieczeństwa, krytyczności ani
   * właściciela. Nie chodzi tylko o kolumny — ukrywamy też filtry
   * i wypiski, bo inaczej dałoby się wartość odtworzyć z adresu
   * (`?securityClass=RESTRICTED` wypychałoby wiersze na górę).
   */
  const isGuest = !user;

  const activeFilters = [
    filters.status && { key: 'status', label: `Status: ${STATUS_LABELS[filters.status as AppStatus]}` },
    !isGuest && filters.securityClass && {
      key: 'securityClass',
      label: `Bezpieczeństwo: ${SECURITY_LABELS[filters.securityClass as SecurityClass]}`,
    },
    filters.environmentId && {
      key: 'environmentId',
      label: `Środowisko: ${environments.data?.environments.find((e) => e.id === filters.environmentId)?.name ?? '…'}`,
    },
    filters.ownerId && {
      key: 'ownerId',
      label: `Właściciel: ${users.data?.users.find((u) => u.id === filters.ownerId)?.fullName ?? '…'}`,
    },
    !isGuest && filters.criticality && {
      key: 'criticality',
      label: `Krytyczność: ${CRITICALITY_LABELS[filters.criticality]}`,
    },
    filters.category && { key: 'category', label: `Kategoria: ${filters.category}` },
    filters.missingOwner && { key: 'missingOwner', label: 'Bez właściciela' },
    !isGuest && filters.includeDeleted && { key: 'includeDeleted', label: 'Pokazuj usunięte' },
  ].filter(Boolean) as Array<{ key: string; label: string }>;

  return (
    <>
      <PageHeader
        title="Aplikacje"
        description={
          isLoading
            ? undefined
            : `${total} ${total === 1 ? 'pozycja' : total < 5 ? 'pozycje' : 'pozycji'} w rejestrze`
        }
        actions={
          <>
            {can('app:write') && (
              <Link to="/aplikacje/nowa">
                <Button>
                  <IconPlus className="size-4" />
                  Dodaj aplikację
                </Button>
              </Link>
            )}
            {/* Eksport wymaga sesji (endpoint nie jest @Public),
                więc goścowi nie pokazujemy przycisku. */}
            {user && <CsvExportButton filters={filters} />}
          </>
        }
      />

      {/* Filtry */}
      <div className="card mb-4 px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <form onSubmit={submitSearch} className="min-w-[240px] flex-1">
            <label htmlFor="search" className="label">
              Szukaj
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
                <input
                  id="search"
                  type="search"
                  className="input pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Nazwa, wersja, opis, właściciel…"
                />
              </div>
              <Button type="submit" variant="secondary">
                Szukaj
              </Button>
            </div>
          </form>

          <Select
            label="Sortowanie"
            value={filters.sort ?? ''}
            onChange={(e) => setFilter('sort', e.target.value)}
            className="w-52"
          >
            {SORT_OPTIONS.filter((o) => !isGuest || !('guestHidden' in o) || !o.guestHidden).map(
              (option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ),
            )}
          </Select>

          <Select
            label="Status"
            value={filters.status ?? ''}
            onChange={(e) => setFilter('status', e.target.value)}
            className="w-40"
          >
            <option value="">Wszystkie</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>

          {!isGuest && (
            <Select
              label="Bezpieczeństwo"
              value={filters.securityClass ?? ''}
              onChange={(e) => setFilter('securityClass', e.target.value)}
              className="w-44"
            >
              <option value="">Wszystkie</option>
              {Object.entries(SECURITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}

          <Select
            label="Środowisko"
            value={filters.environmentId ?? ''}
            onChange={(e) => setFilter('environmentId', e.target.value)}
            className="w-44"
          >
            <option value="">Wszystkie</option>
            {environments.data?.environments.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
          </Select>

          {!isGuest && (
            <Select
              label="Krytyczność"
              value={filters.criticality ?? ''}
              onChange={(e) => setFilter('criticality', e.target.value)}
              className="w-36"
            >
              <option value="">Wszystkie</option>
              {[4, 3, 2, 1].map((level) => (
                <option key={level} value={level}>
                  {CRITICALITY_LABELS[level]}
                </option>
              ))}
            </Select>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
          {/* Gość nie widzi wpisów usuniętych (API ich nie zwraca),
              więc ten przełącznik byłby dla niego martwy. */}
          {!isGuest && (
            <Checkbox
              label="Pokazuj usunięte"
              checked={filters.includeDeleted ?? false}
              onChange={(e) =>
                setFilter('includeDeleted', e.target.checked ? 'true' : null)
              }
            />
          )}

          {activeFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {activeFilters.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setFilter(filter.key, null)}
                  className="badge bg-surface-2 text-fg ring-line hover:bg-surface-3"
                >
                  <IconTag className="size-3 opacity-60" />
                  {filter.label}
                  <IconX className="size-3 opacity-60" />
                </button>
              ))}
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                <IconFilter className="size-3.5" />
                Wyczyść wszystkie
              </button>
            </div>
          )}
        </div>
      </div>

      <ErrorMessage error={error} onRetry={() => refetch()} className="mb-4" />

      {/* Tabela */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState
            tone={activeFilters.length > 0 || filters.q ? 'muted' : 'default'}
            title={
              activeFilters.length > 0 || filters.q
                ? 'Brak wyników dla podanych kryteriów'
                : 'Rejestr jest pusty'
            }
            description={
              activeFilters.length > 0 || filters.q
                ? 'Zmień filtry albo wyczyść wyszukiwanie.'
                : 'Dodaj pierwszą aplikację, żeby zacząć budować rejestr.'
            }
            action={
              activeFilters.length > 0 || filters.q ? (
                <Button variant="secondary" onClick={clearFilters}>
                  <IconFilter className="size-4" />
                  Wyczyść filtry
                </Button>
              ) : can('app:write') ? (
                <Link to="/aplikacje/nowa">
                  <Button>
                    <IconPlus className="size-4" />
                    Dodaj aplikację
                  </Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            {/*
              Pod węższymi ekranami tabela z `min-w-[900px]` wymuszała
              poziomy scroll przez całą szerokość telefonu, bez żadnej
              wskazówki, że coś się przewija. Dlatego poniżej `md`
              renderujemy kafelki zamiast wierszy — te same dane,
              inaczej ułożone.
            */}
            <ul className="divide-y divide-line md:hidden">
              {items.map((app) => (
                <ApplicationCard
                  key={app.id}
                  app={app}
                  canWrite={can('app:write')}
                  showRestricted={!isGuest}
                />
              ))}
            </ul>

            {/*
              `overflow-x-auto` tworzy nowy kontekst przewijania, więc
              sticky nagłówek działałby tylko wewnątrz tego diva —
              czyli znikał przy przewijaniu strony w pionie. Żeby
              przykleić go do krawędzi viewportu, sama tabela musi
              być wyższa niż ekran; inaczej nie ma czego przyklejać.
              Bez tego warunku zostawiamy zwykły nagłówek.
            */}
            <div className="scroll-thin hidden overflow-x-auto md:block">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b border-line bg-page">
                  <tr>
                    <Th className="w-[26%]">Nazwa</Th>
                    <Th>Kategoria</Th>
                    <Th>Status</Th>
                    <Th>Wniosek o dostęp</Th>
                    {!isGuest && <Th>Bezpieczeństwo</Th>}
                    {!isGuest && <Th>Krytyczność</Th>}
                    {!isGuest && <Th>Właściciel</Th>}
                    <Th className="w-10">
                      <span className="sr-only">Akcje</span>
                    </Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {items.map((app) => (
                    <ApplicationRow
                      key={app.id}
                      app={app}
                      canWrite={can('app:write')}
                      showRestricted={!isGuest}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Paginacja — przy jednej stronie (albo pustej liście)
                licznik „1–5 z 5" tylko zajmuje miejsce. */}
            {total > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-xs text-fg-muted">
                <span>
                  {offset + 1}–{Math.min(offset + items.length, total)} z {total}
                  {isFetching && ' · aktualizuję…'}
                </span>

              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() =>
                    setFilter('offset', String(Math.max(offset - PAGE_SIZE, 0)))
                  }
                >
                  <IconChevronLeft className="size-3.5" />
                  Poprzednia
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!hasMore}
                  onClick={() => setFilter('offset', String(offset + PAGE_SIZE))}
                >
                  Następna
                  <IconChevronRight className="size-3.5" />
                </Button>
              </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-fg-muted ${className}`}
    >
      {children}
    </th>
  );
}

/**
 * Kafelek zamiast wiersza tabeli — widok poniżej `md`.
 *
 * Świadomie powtarza dane z `ApplicationRow` zamiast współdzielić
 * wiersz: tabela i lista mają inne elementy (`td` vs `div`), a próba
 * zrobienia z tego jednego komponentu kończy się nieczytelnymi
 * warunkami w każdej komórce.
 */
function ApplicationCard({
  app,
  canWrite,
  showRestricted,
}: {
  app: Application;
  canWrite: boolean;
  showRestricted: boolean;
}) {
  const remove = useDeleteApplication();
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <li className={`px-4 py-3 ${app.deletedAt ? 'opacity-60' : ''}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              to={`/aplikacje/${app.id}`}
              className="block font-medium text-fg hover:text-brand-600"
            >
              {app.name}
              <span className="ml-1.5 font-normal text-fg-muted">
                {app.version}
              </span>
            </Link>

            {app.category && (
              <p className="mt-0.5 truncate text-xs text-fg-muted">
                {app.category}
              </p>
            )}

            {app.environments.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {app.environments.slice(0, 3).map((env) => (
                  <span
                    key={env.id}
                    className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-muted"
                  >
                    {env.name}
                  </span>
                ))}
                {app.environments.length > 3 && (
                  <span className="text-[11px] text-fg-subtle">
                    +{app.environments.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="shrink-0">
            <RowActions
              app={app}
              canWrite={canWrite && !app.deletedAt}
              onDelete={() => setConfirming(true)}
            />
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge color={STATUS_COLORS[app.status]}>
            {STATUS_LABELS[app.status]}
          </Badge>
          <Badge
            color={app.accessRequestRequired ? ACCESS_REQUEST_YES : ACCESS_REQUEST_NO}
          >
            {app.accessRequestRequired ? 'wniosek' : 'bez wniosku'}
          </Badge>
          {showRestricted && app.securityClass && (
            <Badge color={SECURITY_COLORS[app.securityClass]}>
              {SECURITY_LABELS[app.securityClass]}
            </Badge>
          )}
          {app.deletedAt && (
            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-medium text-rose-800 dark:bg-rose-500/15 dark:text-rose-300">
              usunięta
            </span>
          )}
        </div>
      </li>

      {confirming && (
        <DeleteConfirmModal
          app={app}
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            await remove.mutateAsync(app.id);
            setConfirming(false);
          }}
          pending={remove.isPending}
          error={remove.error}
        />
      )}
    </>
  );
}

/** Okno potwierdzenia usunięcia — wspólne dla wiersza i kafelka. */
function DeleteConfirmModal({
  app,
  onClose,
  onConfirm,
  pending,
  error,
}: {
  app: Application;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  pending: boolean;
  error: unknown;
}) {
  return (
    <Modal
      open
      size="sm"
      title="Usunąć aplikację?"
      description="Wpis zostaje oznaczony jako usunięty — dane nie znikają z bazy."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Anuluj
          </Button>
          <Button variant="danger" loading={pending} onClick={onConfirm}>
            Usuń
          </Button>
        </>
      }
    >
      <p className="text-sm text-fg-muted">
        Czy na pewno chcesz usunąć{' '}
        <strong className="font-semibold text-fg">{app.name}</strong>?
        Wpis zniknie z listy, ale pozostanie w bazie i w dzienniku zdarzeń.
      </p>

      {/* ErrorMessage sam nic nie rysuje dla pustego błędu, więc
          niepotrzebny jest tu warunek — a `error` jest typu `unknown`. */}
      <ErrorMessage error={error} className="mt-3" />
    </Modal>
  );
}

function ApplicationRow({
  app,
  canWrite,
  showRestricted,
}: {
  app: Application;
  canWrite: boolean;
  showRestricted: boolean;
}) {
  const remove = useDeleteApplication();
  const [confirming, setConfirming] = useState(false);

  const handleDelete = async () => {
    await remove.mutateAsync(app.id);
    setConfirming(false);
  };

  return (
    <>
      <tr
        className={`group hover:bg-page ${
          app.deletedAt ? 'opacity-60' : ''
        }`}
      >
        <td className="px-4 py-2.5">
          <Link
            to={`/aplikacje/${app.id}`}
            className="block truncate font-medium text-fg hover:text-brand-600"
          >
            {app.name}
            <span className="ml-1.5 font-normal text-fg-muted">{app.version}</span>
          </Link>

          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {app.environments.slice(0, 3).map((env) => (
              <span
                key={env.id}
                className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-muted"
              >
                {env.name}
              </span>
            ))}
            {app.environments.length > 3 && (
              <span className="text-[11px] text-fg-subtle">
                +{app.environments.length - 3}
              </span>
            )}
            {app.deletedAt && (
              <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-medium text-rose-800 dark:bg-rose-500/15 dark:text-rose-300">
                usunięta
              </span>
            )}
          </div>
        </td>

        <td className="px-4 py-2.5 text-fg-muted">
          {app.category ?? '—'}
        </td>

        <td className="px-4 py-2.5">
          <Badge color={STATUS_COLORS[app.status]}>
            {STATUS_LABELS[app.status]}
          </Badge>
        </td>

        <td className="px-4 py-2.5">
          <Badge
            color={app.accessRequestRequired ? ACCESS_REQUEST_YES : ACCESS_REQUEST_NO}
          >
            {app.accessRequestRequired ? 'Tak' : 'Nie'}
          </Badge>
        </td>

        {showRestricted && (
          <td className="px-4 py-2.5">
            {app.securityClass && (
              <Badge color={SECURITY_COLORS[app.securityClass]}>
                {SECURITY_LABELS[app.securityClass]}
              </Badge>
            )}
          </td>
        )}

        {showRestricted && (
          <td className="px-4 py-2.5">
            {app.criticality !== undefined && (
              <Badge color={CRITICALITY_COLORS[app.criticality]}>
                {CRITICALITY_LABELS[app.criticality]}
              </Badge>
            )}
          </td>
        )}

        {showRestricted && (
          <td className="px-4 py-2.5">
            {app.owner ? (
              <span className="text-fg">{app.owner.fullName}</span>
            ) : (
              <span className="text-xs text-amber-600 dark:text-amber-400">nieprzypisana</span>
            )}
          </td>
        )}

        <td className="px-4 py-2.5 text-right">
          <RowActions
            app={app}
            canWrite={canWrite && !app.deletedAt}
            onDelete={() => setConfirming(true)}
          />
        </td>
      </tr>

      {confirming && (
        <DeleteConfirmModal
          app={app}
          onClose={() => setConfirming(false)}
          onConfirm={handleDelete}
          pending={remove.isPending}
          error={remove.error}
        />
      )}
    </>
  );
}

/** Menu kontekstowe wiersza (kebab) z akcjami. */
function RowActions({
  app,
  canWrite,
  onDelete,
}: {
  app: Application;
  canWrite: boolean;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Akcje dla ${app.name}`}
        className="rounded-md p-1.5 text-fg-subtle transition
                   hover:bg-surface-2 hover:text-fg-muted
                   focus:opacity-100 group-hover:opacity-100"
      >
        <IconDots className="size-4" />
      </button>

      {open && (
        <>
          {/* Przyciemnienie zamyka menu po kliknięciu obok */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg
                       border border-line bg-surface py-1 shadow-lg"
          >
            <Link
              to={`/aplikacje/${app.id}`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-fg hover:bg-page"
            >
              <IconGrid className="size-4 text-fg-muted" />
              Szczegóły
            </Link>

            {canWrite && (
              <>
                <Link
                  to={`/aplikacje/${app.id}/edycja`}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm text-fg hover:bg-page"
                >
                  <IconPencil className="size-4 text-fg-muted" />
                  Edytuj
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onDelete();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm
                             text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                >
                  <IconTrash className="size-4" />
                  Usuń
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Przycisk eksportu CSV — pobiera plik przez fetch, nie przez link. */
function CsvExportButton({ filters }: { filters: ApplicationFilters }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const handleExport = async () => {
    setBusy(true);
    setError(null);
    try {
      const csv = await downloadApplicationsCsv(filters);
      const stamp = new Date().toISOString().slice(0, 10);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = `rejestr-${stamp}.csv`;
      link.click();

      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Button
        variant="secondary"
        loading={busy}
        onClick={handleExport}
        title="Eksport bieżącego widoku do pliku CSV"
      >
        <IconDownload className="size-4" />
        Eksport CSV
      </Button>
      {error instanceof ApiError && (
        <ErrorMessage error={error} className="mt-2" />
      )}
    </div>
  );
}
