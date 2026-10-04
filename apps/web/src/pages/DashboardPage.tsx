import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../lib/auth';
import { useStats } from '../lib/queries';
import { PageHeader } from '../components/layout/AppLayout';
import { Badge } from '../components/ui/Badge';
import {
  ErrorMessage,
  Spinner,
} from '../components/ui/Feedback';
import {
  IconAlert,
  IconBox,
  IconCalendar,
  IconGauge,
  IconGrid,
  IconHistory,
  IconShield,
  IconTag,
  IconUser,
} from '../components/ui/icons';
import {
  CRITICALITY_COLORS,
  CRITICALITY_LABELS,
  DELIVERY_TYPE_LABELS,
  SECURITY_COLORS,
  SECURITY_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  type AppStatus,
  type DeliveryType,
  type SecurityClass,
} from '../types';

/** Kolejność typów dostarczenia na pulpicie — jak w formularzu. */
const DELIVERY_TYPE_ORDER: DeliveryType[] = [
  'GENERAL_USE',
  'SELF_HOSTED',
  'SAAS',
  'VENDOR_MANAGED',
];

export function DashboardPage() {
  const { user, can } = useAuth();
  const { data, isLoading, error, refetch } = useStats();

  if (isLoading) return <Spinner label="Ładowanie pulpitu…" />;
  if (error) return <ErrorMessage error={error} onRetry={() => refetch()} />;
  if (!data) return null;

  const maxEnv = Math.max(...data.byEnvironment.map((e) => e.count), 1);
  const totalStatus = data.byStatus.reduce((sum, s) => sum + s.count, 0) || 1;

  return (
    <>
      <PageHeader
        title={`Cześć, ${user?.fullName.split(' ')[0] ?? ''}`}
        description="Przegląd rejestru oprogramowania"
      />

      {/* Kluczowe liczniki */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Aplikacje w rejestrze"
          value={data.total}
          icon={<IconGrid className="size-5" />}
          to="/aplikacje"
        />
        <StatCard
          label="Wycofywane w 90 dni"
          value={data.eol.soon}
          tone={data.eol.soon > 0 ? 'warn' : 'ok'}
          icon={<IconCalendar className="size-5" />}
          to={`/aplikacje?status=DEPRECATED`}
        />
        <StatCard
          label="Po terminie wycofania"
          value={data.eol.passed}
          tone={data.eol.passed > 0 ? 'danger' : 'ok'}
          icon={<IconAlert className="size-5" />}
          to="/aplikacje?sort=sunsetOn"
        />
        <StatCard
          label="Bez właściciela"
          value={data.incomplete.missingOwner}
          tone={data.incomplete.missingOwner > 0 ? 'warn' : 'ok'}
          icon={<IconUser className="size-5" />}
          to="/aplikacje?missingOwner=true"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Statusy */}
        <section className="card px-5 py-4">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-fg">
            <IconGauge className="size-4 text-brand-600 dark:text-brand-400" />
            Status wdrożenia
          </h2>

          {data.byStatus.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-muted">
              Brak danych
            </p>
          ) : (
            <ul className="space-y-2.5">
              {data.byStatus.map((entry) => (
                <li key={entry.key}>
                  <Link
                    to={`/aplikacje?status=${entry.key}`}
                    className="group block"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                      <span className="text-fg-muted group-hover:text-brand-600">
                        {STATUS_LABELS[entry.key as AppStatus]}
                      </span>
                      <span className="font-medium tabular-nums text-fg">
                        {entry.count}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className={`h-full rounded-full transition-all ${
                          entry.key === 'PROD' ? 'bg-accent-500' : 'bg-brand-500'
                        }`}
                        style={{
                          width: `${Math.round((entry.count / totalStatus) * 100)}%`,
                        }}
                      />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Środowiska */}
        <section className="card px-5 py-4">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-fg">
            <IconBox className="size-4 text-brand-600 dark:text-brand-400" />
            Środowiska
          </h2>

          {data.byEnvironment.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-muted">
              Brak danych
            </p>
          ) : (
            <ul className="space-y-2.5">
              {data.byEnvironment.map((env) => (
                <li key={env.id}>
                  <Link
                    to={`/aplikacje?environmentId=${env.id}`}
                    className="group block"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                      <span className="text-fg-muted group-hover:text-brand-600">
                        {env.name}
                      </span>
                      <span className="font-medium tabular-nums text-fg">
                        {env.count}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-fg-subtle transition-all"
                        style={{ width: `${Math.round((env.count / maxEnv) * 100)}%` }}
                      />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Klasyfikacja + krytyczność + kategorie */}
        <section className="space-y-5">
          <div className="card px-5 py-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
              <IconShield className="size-4 text-brand-600 dark:text-brand-400" />
              Klasyfikacja bezpieczeństwa
            </h2>
            <ul className="space-y-2">
              {data.bySecurityClass.map((entry) => (
                <li
                  key={entry.key}
                  className="flex items-center justify-between gap-2"
                >
                  <Badge color={SECURITY_COLORS[entry.key as SecurityClass]}>
                    {SECURITY_LABELS[entry.key as SecurityClass]}
                  </Badge>
                  <Link
                    to={`/aplikacje?securityClass=${entry.key}`}
                    className="text-xs font-medium tabular-nums text-fg-muted hover:text-brand-600"
                  >
                    {entry.count}
                  </Link>
                </li>
              ))}
              {data.bySecurityClass.length === 0 && (
                <li className="py-2 text-center text-sm text-fg-muted">
                  Brak danych
                </li>
              )}
            </ul>
          </div>

          <div className="card px-5 py-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
              <IconAlert className="size-4 text-brand-600 dark:text-brand-400" />
              Krytyczność biznesowa
            </h2>
            <ul className="space-y-2">
              {[4, 3, 2, 1].map((level) => {
                const entry = data.byCriticality.find(
                  (c) => c.key === level,
                );
                const count = entry?.count ?? 0;
                return (
                  <li
                    key={level}
                    className="flex items-center justify-between gap-2"
                  >
                    <Badge color={CRITICALITY_COLORS[level]}>
                      {CRITICALITY_LABELS[level]}
                    </Badge>
                    <Link
                      to={`/aplikacje?criticality=${level}`}
                      className={`text-xs font-medium tabular-nums hover:text-brand-600 ${
                        level === 4 && count > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-fg-muted'
                      }`}
                    >
                      {count}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </div>

      {/* Typ dostarczenia + ostatnie zmiany */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <section className="card px-5 py-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
            <IconTag className="size-4 text-brand-600 dark:text-brand-400" />
            Podział wg typu dostarczenia
          </h2>

          {data.byDeliveryType.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-muted">
              Brak danych
            </p>
          ) : (
            <ul className="space-y-1.5">
              {/* Stała kolejność zamiast kolejności w bazie: cztery typy
                  zawsze w tej samej kolejności, także gdy któryś ma zero. */}
              {DELIVERY_TYPE_ORDER.map((type) => {
                const count =
                  data.byDeliveryType.find((e) => e.key === type)?.count ?? 0;
                return (
                  <li key={type}>
                    <Link
                      to={`/aplikacje?deliveryType=${encodeURIComponent(type)}`}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm hover:bg-page"
                    >
                      <span className="truncate text-fg">
                        {DELIVERY_TYPE_LABELS[type]}
                      </span>
                      <span className="shrink-0 text-xs font-medium tabular-nums text-fg-muted">
                        {count}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {data.incomplete.missingDescription > 0 && (
            <p className="mt-4 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
              {data.incomplete.missingDescription} aplikacji nie ma opisu.
              Uzupełnij je, żeby rejestr był czytelny dla nowych osób.
            </p>
          )}
        </section>

        <section className="card lg:col-span-2">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <IconHistory className="size-4 text-brand-600 dark:text-brand-400" />
              Ostatnio zmienione
            </h2>
            <Link
              to="/aplikacje"
              className="text-xs font-medium text-brand-600 hover:text-brand-700"
            >
              Zobacz wszystkie
            </Link>
          </div>

          {data.recent.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-fg-muted">
              {can('app:write')
                ? 'Rejestr jest pusty — dodaj pierwszą aplikację.'
                : 'Rejestr jest pusty.'}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {data.recent.map((app) => (
                <li key={app.id}>
                  <Link
                    to={`/aplikacje/${app.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-page"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">
                        {app.name}{' '}
                        <span className="font-normal text-fg-muted">
                          {app.version}
                        </span>
                      </p>
                      <p className="truncate text-xs text-fg-muted">
                        {app.ownerEmail ?? 'Bez właściciela'}
                        {app.deliveryType !== 'GENERAL_USE'
                          ? ` · ${DELIVERY_TYPE_LABELS[app.deliveryType]}`
                          : ''}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <Badge color={STATUS_COLORS[app.status]}>
                        {STATUS_LABELS[app.status]}
                      </Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  tone = 'default',
  icon,
  to,
}: {
  label: string;
  value: number;
  tone?: 'default' | 'warn' | 'danger' | 'ok';
  icon?: ReactNode;
  to?: string;
}) {
  const toneClass =
    tone === 'danger'
      ? 'text-rose-600 dark:text-rose-400'
      : tone === 'warn'
        ? // amber-400 na białym tle miał ~2:1 — poniżej WCAG AA,
          // więc jasny motyw dostaje amber-600, ciemny jaśniejszy.
          'text-amber-600 dark:text-amber-400'
        : tone === 'ok'
          ? 'text-accent-600 dark:text-accent-400'
          : 'text-fg';

  const iconTone =
    tone === 'danger'
      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
      : tone === 'warn'
        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
        : tone === 'ok'
          ? 'bg-accent-500/10 text-accent-600 dark:text-accent-400'
          : 'bg-brand-500/10 text-brand-600 dark:text-brand-400';

  const content = (
    <div className="flex items-center gap-3">
      {icon && (
        <span
          aria-hidden="true"
          className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${iconTone}`}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-fg-muted">{label}</p>
        <p className={`mt-0.5 text-2xl font-semibold tabular-nums ${toneClass}`}>
          {value}
        </p>
      </div>
    </div>
  );

  if (!to) {
    return <div className="card px-4 py-3.5">{content}</div>;
  }

  return (
    <Link
      to={to}
      className="card px-4 py-3.5 transition-colors hover:border-brand-300/50 hover:bg-page dark:hover:border-brand-500/40"
    >
      {content}
    </Link>
  );
}
