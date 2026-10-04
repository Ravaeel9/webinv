import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  useApplication,
  useAuditForEntity,
  useDeleteApplication,
  useRestoreApplication,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/layout/AppLayout';
import { Badge, EolBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState, ErrorMessage, Spinner } from '../components/ui/Feedback';
import { Modal } from '../components/ui/Modal';
import {
  describeAction,
  formatCurrency,
  formatDate,
  formatDateTime,
} from '../lib/format';
import { fieldLabel, formatChangeValue } from '../lib/audit-fields';
import { visibleChanges, truncatedFields, type AuditChanges } from '../types';
import {
  ACCESS_REQUEST_NO,
  ACCESS_REQUEST_YES,
  CRITICALITY_TONES,
  CRITICALITY_LABELS,
  DELIVERY_TYPE_TONES,
  DELIVERY_TYPE_LABELS,
  SECURITY_TONES,
  SECURITY_LABELS,
  STATUS_TONES,
  STATUS_LABELS,
  SUPPORT_CHANNEL_LABELS,
  SUPPORT_OWNER_LABELS,
  type Application,
} from '../types';
import {
  IconBox,
  IconCalendar,
  IconExternalLink,
  IconHistory,
  IconInfo,
  IconPencil,
  IconRefresh,
  IconShield,
  IconTag,
  IconTrash,
  IconUser,
} from '../components/ui/icons';

/** Wiersz definicji w sekcji „Dostęp i wsparcie". */
function DeliveryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="field-label">
        {label}
      </dt>
      <dd className="field-value">{children}</dd>
    </div>
  );
}

/** Zaślepka dla pola, którego nie wypełniono — nie myli „nie wiadomo” z brakiem. */
function Missing() {
  return <span className="text-fg-muted">nie uzupełniono</span>;
}

export function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can, user } = useAuth();

  const { data, isLoading, error, refetch } = useApplication(id);
  const remove = useDeleteApplication();
  const restore = useRestoreApplication();

  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (isLoading) return <Spinner label="Ładowanie aplikacji…" />;

  if (error || !data) {
    return (
      <>
        <PageHeader
          title="Nie znaleziono aplikacji"
          back={{ to: '/aplikacje', label: 'Wróć do listy' }}
        />
        <ErrorMessage error={error} onRetry={() => refetch()} />
      </>
    );
  }

  const app = data.application;
  const canWrite = can('app:write');

  const handleDelete = async () => {
    await remove.mutateAsync(app.id);
    navigate('/aplikacje', { replace: true });
  };

  const handleRestore = async () => {
    await restore.mutateAsync(app.id);
  };

  return (
    <>
      <PageHeader
        title={app.name}
        description={`Wersja ${app.version} · ${DELIVERY_TYPE_LABELS[app.deliveryType]}`}
        back={{ to: '/aplikacje', label: 'Wróć do listy' }}
        actions={
          <>
            {canWrite && !app.deletedAt && (
              <Link to={`/aplikacje/${app.id}/edycja`}>
                <Button variant="secondary">
                  <IconPencil className="size-4" />
                  Edytuj
                </Button>
              </Link>
            )}
            {canWrite && app.deletedAt && (
              <Button
                loading={restore.isPending}
                onClick={handleRestore}
              >
                <IconRefresh className="size-4" />
                Przywróć
              </Button>
            )}
            {canWrite && !app.deletedAt && (
              <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
                <IconTrash className="size-4" />
                Usuń
              </Button>
            )}
          </>
        }
      />

      {app.deletedAt && (
        <div className="alert alert-danger mb-5">
          <IconTrash className="mt-0.5 size-4 shrink-0 text-rose-600 dark:text-rose-400" />
          <span>
            Ta aplikacja została usunięta {formatDate(app.deletedAt)} i jest
            ukryta z listy. Możesz ją przywrócić.
          </span>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* ─── Kolumna główna ─────────────────────────────────── */}
        <div className="space-y-5 lg:col-span-2">
          <section className="card px-5 py-4">
            <h2 className="section-title">
              <IconInfo />
              Opis
            </h2>
            <Prose label="Czym to jest" text={app.description} />
            <Prose label="Do czego służy" text={app.purpose} />
            <Prose label="Integracje i API" text={app.integrations} />
          </section>

          {/* Właściciel i administratorzy — tylko dla zalogowanych.
              API nie zwraca `ownerEmail`, więc u gościa sekcji nie ma wcale. */}
          {app.ownerEmail !== undefined && (
            <section className="card px-5 py-4">
              <h2 className="section-title">
                <IconUser />
                Odpowiedzialni
              </h2>

            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <div>
                <dt className="field-label">
                  Właściciel
                </dt>
                <dd className="text-sm">
                  {app.ownerEmail ? (
                    <a
                      href={`mailto:${app.ownerEmail}`}
                      className="text-brand-600 hover:underline"
                    >
                      {app.ownerEmail}
                    </a>
                  ) : (
                    <span className="field-value text-amber-800 dark:text-amber-300">
                      nieprzypisana — ktoś musi to uzupełnić
                    </span>
                  )}
                </dd>
              </div>

              <div>
                <dt className="field-label">
                  Administratorzy
                </dt>
                <dd className="text-sm">
                  {app.admins.length === 0 ? (
                    <span className="text-fg-muted">brak</span>
                  ) : (
                    <ul className="space-y-0.5">
                      {app.admins.map((admin) => (
                        <li key={admin.id}>
                          <span className="text-fg">{admin.fullName}</span>
                          <a
                            href={`mailto:${admin.email}`}
                            className="ml-1.5 text-xs text-brand-600 hover:underline"
                          >
                            {admin.email}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
            </dl>
            </section>
          )}

          <section className="card px-5 py-4">
            <h2 className="section-title">
              <IconBox />
              Środowiska
            </h2>
              <div className="flex flex-wrap gap-1.5">
                {app.environments.length === 0 ? (
                  <span className="text-sm text-fg-muted">
                    nie przypisano środowisk
                  </span>
                ) : (
                  app.environments.map((env) => (
                    <Link
                      key={env.id}
                      to={`/aplikacje?environmentId=${env.id}`}
                      className="badge bg-surface-2 text-fg ring-line
                                 hover:bg-surface-3"
                    >
                      {env.name}
                    </Link>
                  ))
                )}
            </div>
          </section>

          {/* Blok dla usług: gdzie działa i do kogo dzwonić.
              Gość tego nie widzi — API nie wysyła mu tych pól, a
              `user` pilnuje, żeby nie renderować pustej sekcji. */}
          {user && app.deliveryType !== 'GENERAL_USE' && (
            <section className="card px-5 py-4">
              <h2 className="section-title">
                <IconInfo />
                Dostęp i wsparcie
              </h2>

              <dl className="space-y-3">
                <DeliveryRow label="Adres bazowy">
                  {app.baseUrl ? (
                    <a
                      href={app.baseUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline"
                    >
                      {app.baseUrl}
                      <IconExternalLink className="size-3" />
                    </a>
                  ) : (
                    <Missing />
                  )}
                </DeliveryRow>
                <DeliveryRow label="Wsparcie prowadzi">
                  {app.supportOwnerType ? (
                    SUPPORT_OWNER_LABELS[app.supportOwnerType]
                  ) : (
                    <Missing />
                  )}
                </DeliveryRow>
                <DeliveryRow label="Wsparcie — kto">
                  {app.supportOwnerName ?? <Missing />}
                </DeliveryRow>
                <DeliveryRow label="Wsparcie — e-mail">
                  {app.supportEmail ? (
                    <a
                      href={`mailto:${app.supportEmail}`}
                      className="text-sm text-brand-600 hover:underline"
                    >
                      {app.supportEmail}
                    </a>
                  ) : (
                    <Missing />
                  )}
                </DeliveryRow>
                <DeliveryRow label="Główny kanał">
                  {app.supportChannel ? (
                    SUPPORT_CHANNEL_LABELS[app.supportChannel]
                  ) : (
                    <Missing />
                  )}
                </DeliveryRow>
                <DeliveryRow label="Adres zgłoszeń">
                  {app.supportUrl ? (
                    <a
                      href={app.supportUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline"
                    >
                      {app.supportUrl}
                      <IconExternalLink className="size-3" />
                    </a>
                  ) : (
                    <Missing />
                  )}
                </DeliveryRow>
                <DeliveryRow label="Gdzie hostowane">
                  {app.hostingLocation ?? <Missing />}
                </DeliveryRow>
                <DeliveryRow label="Zespół administracyjny">
                  {app.adminTeam ?? <Missing />}
                </DeliveryRow>
                {app.supportNotes && (
                  <div>
                    <dt className="field-label">
                      Wsparcie — uwagi
                    </dt>
                    <dd className="text-sm whitespace-pre-line text-fg">
                      {app.supportNotes}
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          )}

          <ApplicationHistory id={app.id} viewerId={user?.id} />
        </div>

        {/* ─── Kolumna boczna ──────────────────────────────────── */}
        <div className="space-y-5">
          <section className="card px-5 py-4">
            <h2 className="section-title">
              <IconShield />
              Klasyfikacja
            </h2>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-fg-muted">Status</span>
                <Badge tone={STATUS_TONES[app.status]}>
                  {STATUS_LABELS[app.status]}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-fg-muted">Wniosek o dostęp</span>
                <Badge
                  dot={false}
                  tone={app.accessRequestRequired ? ACCESS_REQUEST_YES : ACCESS_REQUEST_NO}
                >
                  {app.accessRequestRequired ? 'Tak' : 'Nie'}
                </Badge>
              </div>
              {/* Typ dostarczenia widać także bez sesji — to informacja
                  techniczna, a nie dana wewnętrzna. */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-fg-muted">Dostarczanie</span>
                <Badge tone={DELIVERY_TYPE_TONES[app.deliveryType]}>
                  {DELIVERY_TYPE_LABELS[app.deliveryType]}
                </Badge>
              </div>
              {/* Gość nie widzi klasyfikacji ani krytyczności — API
                  nie przesyła tych pól w odpowiedzi. */}
              {app.securityClass && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-fg-muted">Bezpieczeństwo</span>
                  <Badge tone={SECURITY_TONES[app.securityClass]}>
                    {SECURITY_LABELS[app.securityClass]}
                  </Badge>
                </div>
              )}
              {app.criticality !== undefined && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-fg-muted">Krytyczność</span>
                  <Badge tone={CRITICALITY_TONES[app.criticality]}>
                    {CRITICALITY_LABELS[app.criticality]}
                  </Badge>
                </div>
              )}
            </div>
          </section>

          <section className="card px-5 py-4">
            <h2 className="section-title">
              <IconCalendar />
              Daty
            </h2>

            <dl className="space-y-3">
              <div>
                <dt className="field-label">
                  Wprowadzono
                </dt>
                <dd className="field-value">
                  {formatDate(app.introducedOn)}
                </dd>
              </div>
              <div>
                <dt className="field-label">
                  Wycofanie (EOL)
                </dt>
                <dd className="field-value flex flex-wrap items-center gap-2">
                  {formatDate(app.sunsetOn)}
                  <EolBadge date={app.sunsetOn} />
                </dd>
              </div>
              <div>
                <dt className="field-label">
                  Ostatnia zmiana
                </dt>
                <dd className="field-value">
                  {formatDateTime(app.updatedAt)}
                </dd>
              </div>
              {app.createdBy && (
                <div>
                  <dt className="field-label">
                    Dodał
                  </dt>
                  <dd className="field-value">
                    {app.createdBy.fullName}
                    <span className="ml-1.5 meta-text">
                      {formatDateTime(app.createdAt)}
                    </span>
                  </dd>
                </div>
              )}
            </dl>
          </section>

          <section className="card px-5 py-4">
            <h2 className="section-title">
              <IconTag />
              Dostawca i licencja
            </h2>

            <dl className="space-y-3">
              <SimpleRow label="Dostawca" value={app.vendor} />
              <SimpleRow label="Licencja" value={app.license} />
              <SimpleRow
                label="Licznik"
                value={
                  app.licenseCount === null
                    ? null
                    : `${app.licenseCount} ${app.licenseCount === 1 ? 'sztuka' : 'szt.'}`
                }
              />
              <SimpleRow
                label="Koszt roczny"
                value={
                  app.annualCost === null
                    ? null
                    : formatCurrency(app.annualCost)
                }
              />
            </dl>
          </section>

          <section className="card px-5 py-4">
            <h2 className="section-title">
              <IconExternalLink />
              Linki
            </h2>

            <ul className="space-y-2">
              <ExtLink label="Strona WWW" href={app.websiteUrl} />
              <ExtLink label="Dokumentacja" href={app.docsUrl} />
              <ExtLink label="Repozytorium" href={app.repoUrl} />
              <ExtLink label="Runbook" href={app.runbookUrl} />
              {!app.websiteUrl &&
                !app.docsUrl &&
                !app.repoUrl &&
                !app.runbookUrl && (
                  <li className="text-sm text-fg-muted">brak</li>
                )}
            </ul>
          </section>
        </div>
      </div>

      <Modal
        open={confirmingDelete}
        size="sm"
        title="Usunąć aplikację?"
        onClose={() => setConfirmingDelete(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
              Anuluj
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={handleDelete}>
              <IconTrash className="size-4" />
              Usuń
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">
          Aplikacja <strong className="text-fg">{app.name}</strong> zniknie
          z listy, ale zostanie w bazie i w dzienniku zdarzeń. Można ją później
          przywrócić.
        </p>
        {remove.error && <ErrorMessage error={remove.error} className="mt-3" />}
      </Modal>
    </>
  );
}

function Prose({ label, text }: { label: string; text: string | null }) {
  return (
    <div className="mb-4 last:mb-0">
      <h3 className="field-label">
        {label}
      </h3>
      {text ? (
        <p className="card-text whitespace-pre-wrap">{text}</p>
      ) : (
        <p className="card-text text-fg-subtle">nie uzupełniono</p>
      )}
    </div>
  );
}

function SimpleRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-sm text-fg-muted">{label}</dt>
      <dd className="field-value min-w-0 break-words text-right">
        {value ?? '—'}
      </dd>
    </div>
  );
}

function ExtLink({ label, href }: { label: string; href: string | null }) {
  if (!href) return null;

  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline"
      >
        {label}
        <IconExternalLink className="size-3.5" />
      </a>
    </li>
  );
}

/** Historia zmian konkretnej aplikacji z dziennika zdarzeń. */
function ApplicationHistory({
  id,
  viewerId,
}: {
  id: string;
  viewerId: string | undefined;
}) {
  const { can } = useAuth();
  const canAudit = can('audit:read');
  // `enabled` jest tu celowe: sama funkcja i tak nic nie renderuje bez
  // `audit:read`, ale bez tego gość wysyłałby zbędne żądanie o audit,
  // które kończy się 401.
  const { data, isLoading } = useAuditForEntity('Application', id, 20, canAudit);

  const entries = data?.items ?? [];

  if (!canAudit) return null;

  return (
    <section className="card">
      <div className="border-b border-line px-5 py-4">
        <h2 className="section-title mb-0">
          <IconHistory />
          Historia zmian
        </h2>
      </div>

      {isLoading ? (
        <Spinner />
      ) : entries.length === 0 ? (
        <EmptyState title="Brak zarejestrowanych zmian" />
      ) : (
        <ol className="divide-y divide-line">
          {entries.map((entry) => (
            <li key={entry.id} className="px-5 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-fg">
                  {describeAction(entry.action)}
                </span>
                <span className="meta-text">
                  {formatDateTime(entry.createdAt)}
                </span>
              </div>
              <p className="mt-0.5 meta-text">
                {entry.actorName ?? 'system'}
                {entry.actorId === viewerId ? ' (Ty)' : ''}
                {entry.ip ? ` · ${entry.ip}` : ''}
              </p>
              {entry.changes && <ChangeList changes={entry.changes} />}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ChangeList({ changes }: { changes: AuditChanges }) {
  const entries = visibleChanges(changes);
  if (entries.length === 0) return null;

  return (
    <ul className="mt-1.5 space-y-0.5">
      {entries.slice(0, 8).map(([field, change]) => (
        <li key={field} className="meta-text">
          <span className="font-medium text-fg">{fieldLabel(field)}</span>
          {': '}
          <span className="text-fg-muted line-through">
            {formatChangeValue(change.from)}
          </span>{' '}
          → <span className="text-fg">{formatChangeValue(change.to)}</span>
        </li>
      ))}
      {entries.length > 8 && (
        <li className="text-xs text-fg-subtle">
          …i {entries.length - 8} innych pól
        </li>
      )}
      {changes._truncated && (
        <li className="text-xs text-amber-800 dark:text-amber-300">
          {truncatedFields(changes).length > 0 ? (
            <>
              Przycięto wartości pól:{' '}
              {truncatedFields(changes).map(fieldLabel).join(', ')}
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

export type { Application };
