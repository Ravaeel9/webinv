import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useAudit, useAuditMeta, useUsers } from '../lib/queries';
import { PageHeader } from '../components/layout/AppLayout';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Pagination } from '../components/ui/Pagination';
import { Select } from '../components/ui/Field';
import { EmptyState, ErrorMessage, Spinner } from '../components/ui/Feedback';
import { describeAction, formatDateTime } from '../lib/format';
import { ChangeList } from '../components/audit/ChangeList';
import { IconFilter } from '../components/ui/icons';

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
        back={{ to: '/ustawienia', label: 'Wróć do ustawień' }}
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
                <li key={entry.id} className="px-4 py-3 transition-colors hover:bg-surface-2/50">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-fg">
                        {describeAction(entry.action)}
                      </span>
                      <ActionTone action={entry.action} />
                      {entry.entity && (
                        <span className="meta-text">
                          {entry.entity}
                        </span>
                      )}
                    </span>

                    <time
                      dateTime={entry.createdAt}
                      className="meta-text"
                    >
                      {formatDateTime(entry.createdAt)}
                    </time>
                  </div>

                  <p className="mt-0.5 meta-text">
                    {entry.actorName ?? 'system'}
                    {entry.ip ? ` · ${entry.ip}` : ''}
                  </p>

                  {entry.changes && <ChangeList changes={entry.changes} />}
                </li>
              ))}
            </ul>

            <div className="border-t border-line">
              <Pagination
                strona={page}
                ostatnia={lastPage}
                total={total}
                onZmien={(s) => setFilter('page', String(s))}
                etykieta="Paginacja dziennika"
              />
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** Odznika zdarzenia: czerwień dla operacji nieudanych. */
function ActionTone({ action }: { action: string }) {
  // `revoked` to nie błąd — administrator zamknął sesje albo odebrał
  // dostęp do aplikacji, celem i z podziękowaniem, więc ton neutralny.
  // Wcześniej oba przypadki miały tę samą klasę sklepaną ręcznie, co
  // oznaczało przezroczyste `dark:bg-rose-500/15`, którego kontrastu nie
  // da się policzyć.
  //
  // Odznaka nazywa to, co **zdarzenie** zrobiło: „odebrano dostęp” przy
  // macierzy, „sesje zamknięte” przy kontach. Jedna etykieta dla obu
  // sugerowałaby, że odebranie uprawnień to zamknięcie sesji.
  if (action.includes('failed')) {
    return (
      <Badge tone="danger" dot={false}>
        niepowodzenie
      </Badge>
    );
  }

  if (!action.includes('revoked')) return null;

  return (
    <Badge tone="neutral" dot={false}>
      {action.startsWith('access.') ? 'dostęp odebrany' : 'sesje zamknięte'}
    </Badge>
  );
}

