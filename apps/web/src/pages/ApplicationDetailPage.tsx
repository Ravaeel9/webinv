import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  useApplication,
  useApplicationIpAddresses,
  useAuditForEntity,
  useDeleteApplication,
  useRestoreApplication,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/layout/AppLayout';
import { CopyButton } from '../components/ui/CopyButton';
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
import { ChangeList } from '../components/audit/ChangeList';
import { ApplicationAccessSection } from '../components/access/ApplicationAccessSection';
import {
  ACCESS_REQUEST_NO,
  ACCESS_REQUEST_YES,
  CRITICALITY_TONES,
  CRITICALITY_LABELS,
  DELIVERY_TYPE_TONES,
  DELIVERY_TYPE_LABELS,
  IP_STATUS_LABELS,
  IP_STATUS_TONES,
  SECURITY_TONES,
  SECURITY_LABELS,
  STATUS_TONES,
  STATUS_LABELS,
  SUPPORT_CHANNEL_LABELS,
  SUPPORT_OWNER_LABELS,
} from '../types';
import {
  IconCalendar,
  IconExternalLink,
  IconHistory,
  IconInfo,
  IconNetwork,
  IconPencil,
  IconRefresh,
  IconTrash,
  IconUser,
} from '../components/ui/icons';

/** Wiersz definicji w sekcji „Dostęp i wsparcie". `detail-row` niesie
 *  zebra i oddech wiersza — wygląd pary etykieta/wartość definiuje klasa. */
function DeliveryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="detail-row">
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

      {/*
        Jedna kolumna, nie grid. Dawniej `lg:grid-cols-3` dawał kolumnę
        treści 2/3 szerokości i boczną 1/3; przy pełnych 1240 px
        sekcja „Opis" rozciągała się do ~150 znaków w linii.
        Teraz sekcje idą jedna pod drugą na pełnej szerokości, tak
        jak `/uzytkownicy` i `/pulpit` — bez własnego `max-w`, bo
        szerokość daje wspólny `max-w-7xl` w `AppLayout`. Dzięki temu
        strona nie wygląda jak zawężona wersja reszty aplikacji.
        Kolejność sekcji: co to jest → czy mogę z tego korzystać →
        fakty administracyjne → historia.
      */}
      <div className="space-y-5">
        {/* Pas podsumowania pod nagłówkiem — cała klasyfikacja w jednym
            rzucie oka, zanim przewini się cokolwiek. Treść dawniej
            trzymana w osobnej karcie „Klasyfikacja"; po przeglądzie
            rejestru gęstego odznaki wstają tu, a karta znika.
            `securityClass` i `criticality` są u gościa nieobecne
            (API ich nie przesyła), więc warunki robią to samo, co
            robiła karta. Etykiety dwuznacznych znaków dopisywane
            wprost, bo w rzędzie odznak „Tak” mówiło za mało. */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-2.5 shadow-sm shadow-brand-950/5">
          <Badge tone={STATUS_TONES[app.status]}>
            {STATUS_LABELS[app.status]}
          </Badge>
          <Badge
            dot={false}
            tone={app.accessRequestRequired ? ACCESS_REQUEST_YES : ACCESS_REQUEST_NO}
          >
            Wniosek o dostęp: {app.accessRequestRequired ? 'tak' : 'nie'}
          </Badge>
          <Badge tone={DELIVERY_TYPE_TONES[app.deliveryType]}>
            {DELIVERY_TYPE_LABELS[app.deliveryType]}
          </Badge>
          {app.securityClass && (
            <Badge tone={SECURITY_TONES[app.securityClass]}>
              Bezpieczeństwo: {SECURITY_LABELS[app.securityClass]}
            </Badge>
          )}
          {app.criticality !== undefined && (
            <Badge tone={CRITICALITY_TONES[app.criticality]}>
              Krytyczność: {CRITICALITY_LABELS[app.criticality]}
            </Badge>
          )}
          <EolBadge date={app.sunsetOn} />
        </div>

        <section className="card-section">
          <div className="card-section-header">
            <span className="section-icon tone-info">
              <IconInfo />
            </span>
            <h2 className="section-title">Opis</h2>
          </div>
          <div className="card-section-body divide-y divide-line">
            <Prose label="Czym to jest" text={app.description} />
            <Prose label="Do czego służy" text={app.purpose} />
            <Prose label="Integracje i API" text={app.integrations} />
          </div>
        </section>

        {/* Właściciel — osoba z ewidencji (`persons`), więc u gościa sekcji
            właściciela i adminów brak. Wickitten nie trutham właściciela wcale. */}
        {app.owner !== undefined && (
          <section className="card-section">
            <div className="card-section-header">
              <span className="section-icon tone-info">
                <IconUser />
              </span>
              <h2 className="section-title">Odpowiedzialni</h2>
            </div>
            <div className="card-section-body">
              {/* Dwie kolumny wciąż mają sens przy 896 px — to dwa pola,
                  nie powrót do dawnego układu strony. */}
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                <div>
                  <dt className="field-label">
                    Właściciel
                  </dt>
                  <dd className="text-sm">
                    {app.owner ? (
                      <span className="block">
                        <span className="text-fg">{app.owner.fullName}</span>
                        <a
                          href={`mailto:${app.owner.email}`}
                          className="ml-1.5 text-xs text-brand-600 hover:underline"
                        >
                          {app.owner.email}
                        </a>
                        {app.owner.position && (
                          <span className="ml-1.5 meta-text">
                            {app.owner.position}
                          </span>
                        )}
                      </span>
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
                            {!admin.isActive && (
                              <span className="ml-1.5 meta-text text-amber-800 dark:text-amber-300">
                                nieaktywna
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          </section>
        )}

        {/* Blok dla usług: gdzie działa i do kogo dzwonić.
            Gość tego nie widzi — API nie wysyła mu tych pól, a
            `user` pilnuje, żeby nie renderować pustej sekcji. */}
        {user && app.deliveryType !== 'GENERAL_USE' && (
          <section className="card-section">
            <div className="card-section-header">
              <span className="section-icon tone-info">
                <IconInfo />
              </span>
              <h2 className="section-title">Dostęp i wsparcie</h2>
            </div>

            <div className="card-section-body">
              {/* Jedna kolumna z naprzemiennym tłem wierszy — siatka
                  dwukolumnowa (wariantowa po przeglądzie) nie wygrywała
                  z prostym listowaniem: nazwa URL i kontaktu potrzebowały
                  szerokości, a zebra (`detail-row`) daje wierszom granicę
                  bez dodatkowych linii. „Wsparcie — uwagi" to zwykły
                  wiersz tych samych klas. */}
              <dl className="space-y-1">
                <DeliveryRow label="Adres bazowy">
                  {app.baseUrl ? (
                    <span className="inline-flex items-center gap-1">
                      <a
                        href={app.baseUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline"
                      >
                        {app.baseUrl}
                        <IconExternalLink className="size-3" />
                      </a>
                      <CopyButton value={app.baseUrl} />
                    </span>
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
                    <span className="inline-flex items-center gap-1">
                      <a
                        href={`mailto:${app.supportEmail}`}
                        className="text-sm text-brand-600 hover:underline"
                      >
                        {app.supportEmail}
                      </a>
                      <CopyButton value={app.supportEmail} />
                    </span>
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
                  <div className="detail-row">
                    <dt className="field-label">
                      Wsparcie — uwagi
                    </dt>
                    <dd className="text-sm whitespace-pre-line text-fg">
                      {app.supportNotes}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </section>
        )}

        {/* Matryca uprawnień — tylko dla roli z `access:read` (ADMIN i
            SUPER_ADMIN) oraz dla usług (poza `GENERAL_USE`). Sekcja nie jest
            montowana u gościa, u VIEWERA ani dla programów ogólnego użytku,
            więc nie powstaje żądanie skończone 401 i nie ma pustej karty. */}
        {can('access:read') && app.deliveryType !== 'GENERAL_USE' && (
          <ApplicationAccessSection applicationId={app.id} />
        )}

        {/* Adresy IP — ta sama reguła usługowa co wyżej (`SELF_HOSTED`),
            plus warunek sesji: `ipam:read` ma każda rola zalogowana
            i żadna publiczna, więc `can('ipam:read')` jest dokładnie
            „jest sesja". Gość nie zobaczy ani wierszy, ani pustego
            stanu — sekcja w ogóle nie jest montowana, więc nie idzie
            po nią żądanie, które skończyłoby się 401. */}
        {can('ipam:read') && app.deliveryType === 'SELF_HOSTED' && (
          <ApplicationIpSection id={app.id} />
        )}

        {/* „Fakty administracyjne" — dawniej trzy osobne karty („Daty",
            „Dostawca i licencja", „Środowiska"); każda trzymała kilka
            pól, a razem budowały długi stos drobnych sekcji. Jedna karta
            skanuje się szybciej: daty i licencja w jednej siatce
            kolumnowej, środowiska chipsami na dole. Kalendarz otwiera
            kartę, bo daty są jej pierwszym wierszem. */}
        <section className="card-section">
          <div className="card-section-header">
            <span className="section-icon tone-info">
              <IconCalendar />
            </span>
            <h2 className="section-title">Fakty administracyjne</h2>
          </div>

          <div className="card-section-body">
            {/* Jedna kolumna i zebra — wiersze prowadzą wzrok
                „do góry–na dół” jak wiersze tabeli, bez siatki
                kolumnowej; daty i licencja dzielą tę samą listę,
                bo wszystko jest faktem administracyjnym tego
                samego rodzaju. */}
            <dl className="space-y-1">
              <div className="detail-row">
                <dt className="field-label">
                  Wprowadzono
                </dt>
                <dd className="field-value">
                  {formatDate(app.introducedOn)}
                </dd>
              </div>
              <div className="detail-row">
                <dt className="field-label">
                  Wycofanie (EOL)
                </dt>
                <dd className="field-value flex flex-wrap items-center gap-2">
                  {formatDate(app.sunsetOn)}
                  <EolBadge date={app.sunsetOn} />
                </dd>
              </div>
              <div className="detail-row">
                <dt className="field-label">
                  Ostatnia zmiana
                </dt>
                <dd className="field-value">
                  {formatDateTime(app.updatedAt)}
                </dd>
              </div>
              {app.createdBy && (
                <div className="detail-row">
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

            {/* Środowiska — chipsy prowadzą do filtrowanej listy rejestru,
                więc mogą być jednym wierszem na dole wspólnej karty. */}
            <div className="mt-5">
              <h3 className="field-label">Środowiska</h3>
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
                      className="badge tone-neutral hover:bg-surface-3"
                    >
                      {env.name}
                    </Link>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="card-section">
          <div className="card-section-header">
            <span className="section-icon tone-info">
              <IconExternalLink />
            </span>
            <h2 className="section-title">Linki</h2>
          </div>

          <div className="card-section-body">
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
          </div>
        </section>

        <ApplicationHistory id={app.id} viewerId={user?.id} />
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
    /* `py-4` zamiast dawnego `mb-4`: granicę między polami niesie
       `divide-y divide-line` na wrapperze `card-section-body` w sekcji
       „Opis" — bez marginesów, które zlewały kolejne pary
       etykieta-akapit w jeden pas tekstu. */
    <div className="py-4 first:pt-0 last:pb-0">
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
    <div className="detail-row flex items-baseline justify-between gap-3">
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
    <section className="card-section">
      <div className="card-section-header">
        <span className="section-icon tone-info">
          <IconHistory />
        </span>
        <h2 className="section-title">Historia zmian</h2>
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
              {entry.changes && (
                <ChangeList changes={entry.changes} limit={8} />
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * Przypisane adresy IP — odczyt z karty aplikacji.
 *
 * Sekcja żyje własnym zapytaniem (`GET /api/ipam/applications/:appId/
 * ip-addresses`), nie polami rekordu aplikacji: przypisania to osobne
 * dane i osobne drzewo tras. Rodzic decyduje, kiedy ją montować —
 * tutaj tylko zakładamy, że patrzy zalogowany widz z `SELF_HOSTED`.
 *
 * Każdy wiersz prowadzi do karty podsieci, bo „czy ten adres jest
 * jeszcze wolny, ile ich tam jest, co skan widział" rozstrzyga się
 * w katalogu IPAM, a nie na karcie aplikacji.
 */
function ApplicationIpSection({ id }: { id: string }) {
  const { data, isLoading, error, refetch } = useApplicationIpAddresses(id);
  const addresses = data?.addresses ?? [];

  return (
    <section className="card-section">
      <div className="card-section-header">
        <span className="section-icon tone-info">
          <IconNetwork />
        </span>
        <h2 className="section-title">Adresy IP</h2>
      </div>

      {isLoading ? (
        <Spinner label="Ładowanie adresów…" />
      ) : error ? (
        <ErrorMessage error={error} onRetry={() => refetch()} className="mx-5 mb-4" />
      ) : addresses.length === 0 ? (
        <EmptyState title="Brak przypisanych adresów" />
      ) : (
        <ul className="divide-y divide-line">
          {addresses.map((address) => (
            <li
              key={address.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3"
            >
              <span className="font-mono text-sm text-fg">
                {address.address}
              </span>

              <Badge tone={IP_STATUS_TONES[address.status]}>
                {IP_STATUS_LABELS[address.status]}
              </Badge>

              <span className="text-sm text-fg-muted">
                {address.description ?? (
                  <span className="text-fg-subtle">bez opisu</span>
                )}
              </span>

              <Link
                to={`/ipam/${address.subnet.id}`}
                className="ml-auto shrink-0 text-xs font-medium text-brand-600 hover:underline"
              >
                {address.subnet.name} · {address.subnet.cidr}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
