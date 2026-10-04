import {
  useEffect,
  useState,
  type FormEvent,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  useApplication,
  useApplicationFormOptions,
  useCreateApplication,
  useUpdateApplication,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/layout/AppLayout';
import { Button } from '../components/ui/Button';
import { Checkbox, Select, Textarea, TextInput } from '../components/ui/Field';
import { ErrorMessage, Spinner } from '../components/ui/Feedback';
import { IconCheck } from '../components/ui/icons';
import { toDateInput } from '../lib/format';
import {
  SECURITY_LABELS,
  STATUS_LABELS,
  type AppStatus,
  type Application,
  type SecurityClass,
} from '../types';

/** Pusty formularz — wartości domyślne zgodne z defaultami schematu Prisma. */
const EMPTY = {
  name: '',
  version: '',
  category: '',
  description: '',
  purpose: '',
  ownerEmail: '',
  adminIds: [] as string[],
  introducedOn: '',
  sunsetOn: '',
  securityClass: 'INTERNAL' as SecurityClass,
  criticality: 2,
  status: 'PROD' as AppStatus,
  accessRequestRequired: false,
  vendor: '',
  license: '',
  licenseCount: '',
  annualCost: '',
  websiteUrl: '',
  docsUrl: '',
  repoUrl: '',
  runbookUrl: '',
  integrations: '',
  environmentIds: [] as string[],
};

type FormState = typeof EMPTY;

/** Zamienia rekord API na stan formularza (daty w formacie RRRR-MM-DD). */
function fromApp(app: Application): FormState {
  return {
    name: app.name,
    version: app.version,
    category: app.category ?? '',
    description: app.description ?? '',
    purpose: app.purpose ?? '',
    ownerEmail: app.ownerEmail ?? '',
    adminIds: app.admins.map((a) => a.id),
    introducedOn: toDateInput(app.introducedOn),
    sunsetOn: toDateInput(app.sunsetOn),
    // Formularz jest za `app:write`, więc API zawsze zwraca te pola.
    // Wartości domyślne są tylko na wypadek odpowiedzi okrojonej.
    securityClass: app.securityClass ?? 'INTERNAL',
    criticality: app.criticality ?? 2,
    status: app.status,
    accessRequestRequired: app.accessRequestRequired,
    vendor: app.vendor ?? '',
    license: app.license ?? '',
    licenseCount: app.licenseCount === null ? '' : String(app.licenseCount),
    annualCost: app.annualCost === null ? '' : String(app.annualCost),
    websiteUrl: app.websiteUrl ?? '',
    docsUrl: app.docsUrl ?? '',
    repoUrl: app.repoUrl ?? '',
    runbookUrl: app.runbookUrl ?? '',
    integrations: app.integrations ?? '',
    environmentIds: app.environments.map((e) => e.id),
  };
}

/**
 * Buduje payload. `forbidNonWhitelisted` w ValidationPipe odrzuca
 * nieznane pola, więc wysyłamy wyłącznie to, co jest w DTO —
 * puste wartości zamieniamy na `null`, a nie pusty string.
 */
function toPayload(form: FormState) {
  const text = (v: string) => (v.trim() === '' ? null : v.trim());

  return {
    name: form.name.trim(),
    version: form.version.trim(),
    category: text(form.category),
    description: text(form.description),
    purpose: text(form.purpose),
    ownerEmail: text(form.ownerEmail),
    adminIds: form.adminIds,
    introducedOn: text(form.introducedOn),
    sunsetOn: text(form.sunsetOn),
    securityClass: form.securityClass,
    criticality: Number(form.criticality),
    status: form.status,
    accessRequestRequired: form.accessRequestRequired,
    vendor: text(form.vendor),
    license: text(form.license),
    licenseCount:
      form.licenseCount.trim() === '' ? null : Number(form.licenseCount),
    annualCost: form.annualCost.trim() === '' ? null : Number(form.annualCost),
    websiteUrl: text(form.websiteUrl),
    docsUrl: text(form.docsUrl),
    repoUrl: text(form.repoUrl),
    runbookUrl: text(form.runbookUrl),
    integrations: text(form.integrations),
    environmentIds: form.environmentIds,
  };
}

export function ApplicationFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);

  const navigate = useNavigate();
  const { can } = useAuth();

  const { data, isLoading, error: loadError } = useApplication(id);
  const { environments, users } = useApplicationFormOptions();
  // `users` zostało potrzebne dla administratorów — właściciel to
  // teraz zwykły adres, więc formularz nie potrzebuje słownika kont.

  const create = useCreateApplication();
  const update = useUpdateApplication(id ?? '');

  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(!isEdit);

  // Wczytujemy dane aplikacji do formularza tylko raz — potem
  // użytkownik edytuje lokalny stan, a nie ten z serwera.
  useEffect(() => {
    if (data?.application && !loaded) {
      setForm(fromApp(data.application));
      setLoaded(true);
    }
  }, [data, loaded]);

  const mutation = isEdit ? update : create;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Błąd pola znika, gdy user zaczyna poprawiać
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const toggle = (key: 'adminIds' | 'environmentIds', value: string) => {
    setForm((prev) => {
      const list = prev[key];
      return {
        ...prev,
        [key]: list.includes(value)
          ? list.filter((v) => v !== value)
          : [...list, value],
      };
    });
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};

    if (!form.name.trim()) next.name = 'Nazwa jest wymagana.';
    if (!form.version.trim()) next.version = 'Wersja jest wymagana.';

    if (form.introducedOn && form.sunsetOn && form.sunsetOn < form.introducedOn) {
      next.sunsetOn = 'Data wycofania nie może być wcześniejsza niż data wprowadzenia.';
    }

    for (const [key, value] of Object.entries({
      licenseCount: form.licenseCount,
      annualCost: form.annualCost,
    })) {
      if (value.trim() !== '' && Number.isNaN(Number(value))) {
        next[key] = 'Podaj liczbę.';
      }
    }

    if (
      form.licenseCount.trim() !== '' &&
      Number(form.licenseCount) < 0
    ) {
      next.licenseCount = 'Liczba nie może być ujemna.';
    }

    if (form.annualCost.trim() !== '' && Number(form.annualCost) < 0) {
      next.annualCost = 'Koszt nie może być ujemny.';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validate()) {
      // Przewijamy do pierwszego błędu, żeby formularz nie był „gubiony"
      const first = document.querySelector('[aria-invalid="true"]');
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const payload = toPayload(form);

    try {
      const result = isEdit
        ? await update.mutateAsync(payload)
        : await create.mutateAsync(payload);

      navigate(`/aplikacje/${result.application.id}`, { replace: true });
    } catch (err) {
      // Błędy walidacji z serwera trafiają do error message;
      // scroll do góry, bo komunikat jest nad formularzem.
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  if (!can('app:write')) {
    return (
      <div className="card mx-auto max-w-lg px-6 py-12 text-center">
        <h1 className="text-base font-semibold text-fg">
          Brak uprawnień
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          Twoja rola pozwala tylko odczytywać rejestr.
        </p>
      </div>
    );
  }

  if (isEdit && isLoading) return <Spinner label="Ładowanie aplikacji…" />;

  if (isEdit && loadError) {
    return (
      <>
        <PageHeader title="Nie znaleziono aplikacji" back={{ to: '/aplikacje', label: 'Wróć do listy' }} />
        <ErrorMessage error={loadError} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={isEdit ? `Edycja: ${data?.application.name ?? ''}` : 'Nowa aplikacja'}
        description={
          isEdit
            ? 'Zmiany trafią do dziennika zdarzeń.'
            : 'Pola oznaczone * są wymagane. Resztę możesz uzupełnić później.'
        }
        back={{ to: isEdit ? `/aplikacje/${id}` : '/aplikacje', label: 'Anuluj' }}
      />

      <ErrorMessage error={mutation.error} className="mb-5" />

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {/* ─── Identyfikacja ─────────────────────────────────── */}
        <fieldset className="card px-5 py-4">
          <legend className="px-1 text-sm font-semibold text-fg">
            Identyfikacja
          </legend>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Nazwa"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              error={errors.name}
              maxLength={200}
              placeholder="np. System Płacowy"
            />
            <TextInput
              label="Wersja"
              required
              value={form.version}
              onChange={(e) => set('version', e.target.value)}
              error={errors.version}
              maxLength={100}
              placeholder="np. 4.2.1"
            />
            <TextInput
              label="Kategoria"
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              error={errors.category}
              maxLength={100}
              placeholder="np. Finanse, HR, Infrastruktura"
            />
            <TextInput
              label="Dostawca"
              value={form.vendor}
              onChange={(e) => set('vendor', e.target.value)}
              error={errors.vendor}
              maxLength={200}
              placeholder="np. dostawca zewnętrzny albo „wewnętrzne”"
            />
          </div>
        </fieldset>

        {/* ─── Opis ─────────────────────────────────────────── */}
        <fieldset className="card px-5 py-4">
          <legend className="px-1 text-sm font-semibold text-fg">
            Opis i przeznaczenie
          </legend>

          <div className="space-y-4">
            <Textarea
              label="Opis"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              error={errors.description}
              hint="Czym to jest, z czego korzysta organizacja."
            />
            <Textarea
              label="Cel / do czego służy"
              value={form.purpose}
              onChange={(e) => set('purpose', e.target.value)}
              error={errors.purpose}
              hint="Dlaczego wdrożyliśmy to oprogramowanie i jaki problem rozwiązuje."
            />
            <Textarea
              label="Integracje i API"
              value={form.integrations}
              onChange={(e) => set('integrations', e.target.value)}
              error={errors.integrations}
              hint="Z czym to się komunikuje — inne systemy, usługi, bazy."
              rows={3}
            />
          </div>
        </fieldset>

        {/* ─── Odpowiedzialni ────────────────────────────────── */}
        <fieldset className="card px-5 py-4">
          <legend className="px-1 text-sm font-semibold text-fg">
            Odpowiedzialni
          </legend>

          <div className="space-y-4">
            <TextInput
              label="Właściciel (e-mail)"
              type="email"
              autoComplete="off"
              value={form.ownerEmail}
              onChange={(e) => set('ownerEmail', e.target.value)}
              error={errors.ownerEmail}
              hint="Adres e-mail osoby odpowiedzialnej za aplikację — nie musi mieć konta w systemie."
            />

            <fieldset>
              <legend className="label">Administratorzy</legend>
              <p className="mb-2 text-xs text-fg-muted">
                Osoby z uprawnieniami administracyjnymi w tej aplikacji.
              </p>

              <div className="scroll-thin max-h-48 overflow-y-auto rounded-lg border border-line">
                {users.isLoading ? (
                  <p className="px-3 py-3 text-sm text-fg-muted">
                    Ładowanie…
                  </p>
                ) : users.data?.users.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-fg-muted">
                    Brak aktywnych użytkowników.
                  </p>
                ) : (
                  <ul className="divide-y divide-line">
                    {users.data?.users.map((user) => (
                      <li key={user.id}>
                        <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-page">
                          <input
                            type="checkbox"
                            className="size-4 rounded border-line-strong text-brand-600"
                            checked={form.adminIds.includes(user.id)}
                            onChange={() => toggle('adminIds', user.id)}
                          />
                          <span className="min-w-0 flex-1 text-sm text-fg">
                            {user.fullName}
                            <span className="ml-1.5 text-xs text-fg-muted">
                              {user.username}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </fieldset>
          </div>
        </fieldset>

        {/* ─── Daty ─────────────────────────────────────────── */}
        <fieldset className="card px-5 py-4">
          <legend className="px-1 text-sm font-semibold text-fg">
            Daty
          </legend>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Data wprowadzenia"
              type="date"
              value={form.introducedOn}
              onChange={(e) => set('introducedOn', e.target.value)}
              error={errors.introducedOn}
            />
            <TextInput
              label="Planowane wycofanie (EOL)"
              type="date"
              value={form.sunsetOn}
              onChange={(e) => set('sunsetOn', e.target.value)}
              error={errors.sunsetOn}
              hint="Pulpit ostrzega, gdy termin zbliża się albo minął."
            />
          </div>
        </fieldset>

        {/* ─── Klasyfikacja ─────────────────────────────────── */}
        <fieldset className="card px-5 py-4">
          <legend className="px-1 text-sm font-semibold text-fg">
            Klasyfikacja i status
          </legend>

          <div className="grid gap-4 sm:grid-cols-3">
            <Select
              label="Klasyfikacja bezpieczeństwa"
              value={form.securityClass}
              onChange={(e) => set('securityClass', e.target.value as SecurityClass)}
              error={errors.securityClass}
            >
              {Object.entries(SECURITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>

            <Select
              label="Krytyczność biznesowa"
              value={form.criticality}
              onChange={(e) => set('criticality', Number(e.target.value))}
              error={errors.criticality}
            >
              <option value={4}>4 — Krytyczna</option>
              <option value={3}>3 — Wysoka</option>
              <option value={2}>2 — Średnia</option>
              <option value={1}>1 — Niska</option>
            </Select>

            <Select
              label="Status"
              value={form.status}
              onChange={(e) => set('status', e.target.value as AppStatus)}
              error={errors.status}
            >
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>

          <div className="mt-4 border-t border-line pt-4">
            <Checkbox
              label="Wymagany wniosek o dostęp"
              hint="Zaznacz, jeśli uzyskanie dostępu do tej aplikacji wymaga złożenia formalnego wniosku."
              checked={form.accessRequestRequired}
              onChange={(e) => set('accessRequestRequired', e.target.checked)}
            />
          </div>
        </fieldset>

        {/* ─── Środowiska ───────────────────────────────────── */}
        <fieldset className="card px-5 py-4">
          <legend className="px-1 text-sm font-semibold text-fg">
            Środowiska
          </legend>

          {environments.isLoading ? (
            <p className="text-sm text-fg-muted">Ładowanie…</p>
          ) : environments.data?.environments.length === 0 ? (
            <p className="text-sm text-fg-muted">
              Brak zdefiniowanych środowisk.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {environments.data?.environments.map((env) => {
                const active = form.environmentIds.includes(env.id);
                return (
                  <button
                    key={env.id}
                    type="button"
                    onClick={() => toggle('environmentIds', env.id)}
                    aria-pressed={active}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium
                                ring-1 ring-inset transition ${
                                  active
                                    ? 'bg-brand-600 text-white ring-brand-600'
                                    : 'bg-surface text-fg-muted ring-line-strong hover:bg-page'
                                }`}
                  >
                    {env.name}
                  </button>
                );
              })}
            </div>
          )}
        </fieldset>

        {/* ─── Licencja i koszty ────────────────────────────── */}
        <fieldset className="card px-5 py-4">
          <legend className="px-1 text-sm font-semibold text-fg">
            Licencja i koszty
          </legend>

          <div className="grid gap-4 sm:grid-cols-3">
            <TextInput
              label="Rodzaj licencji"
              value={form.license}
              onChange={(e) => set('license', e.target.value)}
              error={errors.license}
              maxLength={200}
              placeholder="np. Enterprise, perpetualna"
            />
            <TextInput
              label="Liczba licencji"
              type="number"
              min={0}
              step={1}
              value={form.licenseCount}
              onChange={(e) => set('licenseCount', e.target.value)}
              error={errors.licenseCount}
            />
            <TextInput
              label="Koszt roczny (PLN)"
              type="number"
              min={0}
              step="0.01"
              value={form.annualCost}
              onChange={(e) => set('annualCost', e.target.value)}
              error={errors.annualCost}
            />
          </div>
        </fieldset>

        {/* ─── Linki ────────────────────────────────────────── */}
        <fieldset className="card px-5 py-4">
          <legend className="px-1 text-sm font-semibold text-fg">
            Linki
          </legend>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Strona WWW"
              type="url"
              value={form.websiteUrl}
              onChange={(e) => set('websiteUrl', e.target.value)}
              error={errors.websiteUrl}
              placeholder="https://…"
            />
            <TextInput
              label="Dokumentacja"
              type="url"
              value={form.docsUrl}
              onChange={(e) => set('docsUrl', e.target.value)}
              error={errors.docsUrl}
              placeholder="https://…"
            />
            <TextInput
              label="Repozytorium"
              type="url"
              value={form.repoUrl}
              onChange={(e) => set('repoUrl', e.target.value)}
              error={errors.repoUrl}
              placeholder="https://…"
            />
            <TextInput
              label="Runbook / instrukcja"
              type="url"
              value={form.runbookUrl}
              onChange={(e) => set('runbookUrl', e.target.value)}
              error={errors.runbookUrl}
              placeholder="https://…"
            />
          </div>
        </fieldset>

        {/* ─── Akcje ────────────────────────────────────────── */}
        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-line bg-surface/95 py-3 backdrop-blur">
          <Link
            to={isEdit ? `/aplikacje/${id}` : '/aplikacje'}
            className="inline-flex h-10 items-center rounded-lg border border-line-strong
                       bg-surface px-4 text-sm font-medium text-fg shadow-xs
                       hover:bg-page"
          >
            Anuluj
          </Link>
          <Button type="submit" loading={mutation.isPending}>
            <IconCheck className="size-4" />
            {isEdit ? 'Zapisz zmiany' : 'Dodaj do rejestru'}
          </Button>
        </div>
      </form>
    </>
  );
}
