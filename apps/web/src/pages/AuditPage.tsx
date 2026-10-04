import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useAudit, useAuditMeta, useUsers } from '../lib/queries';
import { PageHeader } from '../components/layout/AppLayout';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Field';
import { EmptyState, ErrorMessage, Spinner } from '../components/ui/Feedback';
import { describeAction, formatDateTime } from '../lib/format';
import { visibleChanges, truncatedFields, type AuditChanges } from '../types';
import {
  IconChevronLeft,
  IconChevronRight,
  IconFilter,
} from '../components/ui/icons';

const PAGE_SIZE = 50;

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const meta = useAuditMeta();

  const filters = useMemo(
    () => ({
      page: Number(params.get('page') ?? 1),
      limit: PAGE_SIZE,
      entity: params.get('entity') ?? '',
      action: params.get('action') ?? '',
      actorId: params.get('actorId') ?? '',
    }),
    [params],
  );

  const { data, isLoading, error, refetch } = useAudit(filters);
  const users = useUsers(false);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === '') {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    // Każda zmiana filtra wraca na pierwszą stronę
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const page = filters.page;
  const lastPage = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  return (
    <>
      <PageHeader
        title="Dziennik zdarzeń"
        description={
          isLoading
            ? undefined
            : `${total} ${total === 1 ? 'zdarzenie' : 'zdarzeń'}`
        }
      />

      <div className="card mb-4 px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label="Encja"
            value={filters.entity}
            onChange={(e) => setFilter('entity', e.target.value)}
            className="w-44"
          >
            <option value="">Wszystkie</option>
            {meta.data?.entities.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.key} ({entry.count})
              </option>
            ))}
          </Select>

          <Select
            label="Akcja"
            value={filters.action}
            onChange={(e) => setFilter('action', e.target.value)}
            className="w-56"
          >
            <option value="">Wszystkie</option>
            {meta.data?.actions.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {describeAction(entry.key)} ({entry.count})
              </option>
            ))}
          </Select>

          <Select
            label="Sprawca"
            value={filters.actorId}
            onChange={(e) => setFilter('actorId', e.target.value)}
            className="w-56"
          >
            <option value="">Wszystcy</option>
            {users.data?.users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.fullName}
              </option>
            ))}
          </Select>

          {(filters.entity || filters.action || filters.actorId) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setParams(new URLSearchParams(), { replace: true })}
            >
              <IconFilter className="size-4" />
              Wyczyść filtry
            </Button>
          )}
        </div>
      </div>

      <ErrorMessage error={error} onRetry={() => refetch()} className="mb-4" />

      <div className="card overflow-hidden">
        {isLoading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState
            title="Brak zdarzeń"
            description="Żaden wpis nie pasuje do wybranych kryteriów."
          />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {items.map((entry) => (
                <li key={entry.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-fg">
                        {describeAction(entry.action)}
                      </span>
                      <ActionTone action={entry.action} />
                      {entry.entity && (
                        <span className="text-xs text-fg-muted">
                          {entry.entity}
                        </span>
                      )}
                    </span>

                    <time
                      dateTime={entry.createdAt}
                      className="text-xs text-fg-muted"
                    >
                      {formatDateTime(entry.createdAt)}
                    </time>
                  </div>

                  <p className="mt-0.5 text-xs text-fg-muted">
                    {entry.actorName ?? 'system'}
                    {entry.ip ? ` · ${entry.ip}` : ''}
                  </p>

                  {entry.changes && <Changes changes={entry.changes} />}
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-xs text-fg-muted">
              <span>
                Strona {page} z {lastPage} · {total} zdarzeń
              </span>

              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setFilter('page', String(page - 1))}
                >
                  <IconChevronLeft className="size-3.5" />
                  Poprzednia
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= lastPage}
                  onClick={() => setFilter('page', String(page + 1))}
                >
                  Następna
                  <IconChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** Kolorowa odznika: czerwień dla operacji nieudanych. */
function ActionTone({ action }: { action: string }) {
  const failed = action.includes('failed') || action.includes('revoked');

  if (!failed) return null;

  return (
    <span
      className={`badge ${
        action.includes('failed')
          ? 'bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30'
          : 'bg-surface-2 text-fg-muted ring-line'
      }`}
    >
      {action.includes('failed') ? 'niepowodzenie' : 'sesje zamknięte'}
    </span>
  );
}

function Changes({ changes }: { changes: AuditChanges }) {
  const entries = visibleChanges(changes);
  if (entries.length === 0) return null;

  return (
    <ul className="mt-1.5 space-y-0.5">
      {entries.slice(0, 10).map(([field, change]) => (
        <li key={field} className="text-xs text-fg-muted">
          <span className="font-medium text-fg">
            {FIELD_LABELS[field] ?? field}
          </span>
          {': '}
          <span className="text-fg-muted line-through">
            {show(change.from)}
          </span>{' '}
          →{' '}
          <span className="text-fg">{show(change.to)}</span>
        </li>
      ))}
      {entries.length > 10 && (
        <li className="text-xs text-fg-subtle">
          …i {entries.length - 10} innych pól
        </li>
      )}
      {changes._truncated && (
        <li className="text-xs text-amber-700">
          {truncatedFields(changes).length > 0 ? (
            <>
              Przycięto wartości pól:{' '}
              {truncatedFields(changes)
                .map((field) => FIELD_LABELS[field] ?? field)
                .join(', ')}
              .
            </>
          ) : (
            'Zmiana była zbyt duża, żeby pokazać jej treść.'
          )}
        </li>
      )}
    </ul>
  );
}

/** Nazwy pól w formie używanej w dzienniku (snake_case z bazy). */
const FIELD_LABELS: Record<string, string> = {
  name: 'nazwa',
  username: 'nazwa użytkownika',
  email: 'e-mail',
  fullName: 'imię i nazwisko',
  role: 'rola',
  isActive: 'aktywność',
  version: 'wersja',
  category: 'kategoria',
  description: 'opis',
  purpose: 'cel',
  ownerEmail: 'e-mail właściciela',
  securityClass: 'klasyfikacja',
  criticality: 'krytyczność',
  status: 'status',
  vendor: 'dostawca',
  license: 'licencja',
  licenseCount: 'liczba licencji',
  annualCost: 'koszt roczny',
  introducedOn: 'data wprowadzenia',
  sunsetOn: 'data wycofania',
  accessRequestRequired: 'wniosek o dostęp',
  websiteUrl: 'adres WWW',
  docsUrl: 'dokumentacja',
  repoUrl: 'repozytorium',
  runbookUrl: 'runbook',
  integrations: 'integracje',
  count: 'liczba',
  mustChangePassword: 'wymuszona zmiana hasła',
};

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'tak' : 'nie';
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 40);
  return String(value);
}
