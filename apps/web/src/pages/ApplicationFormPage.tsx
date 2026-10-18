import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  useApplication,
  useApplicationFormOptions,
  useApplicationIpAddresses,
  useCreateApplication,
  useSetApplicationIpAddresses,
  useUpdateApplication,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { PageHeader } from '../components/layout/AppLayout';
import { IpAddressPicker } from '../components/ipam/IpAddressPicker';
import { useDirtyGuard } from '../components/ui/DirtyGuard';
import { Button, buttonClass } from '../components/ui/Button';
import { Checkbox, Select, Textarea, TextInput } from '../components/ui/Field';
import { ErrorMessage, Spinner } from '../components/ui/Feedback';
import { IconAlert, IconCheck } from '../components/ui/icons';
import { toDateInput } from '../lib/format';
import {
  DELIVERY_TYPE_DESCS,
  DELIVERY_TYPE_LABELS,
  SECURITY_LABELS,
  STATUS_LABELS,
  SUPPORT_CHANNEL_LABELS,
  SUPPORT_OWNER_LABELS,
  type AppStatus,
  type Application,
  type DeliveryType,
  type SecurityClass,
  type SupportChannel,
  type SupportOwnerType,
} from '../types';

/** Kolejność typów dostarczenia w formularzu — od najprostszego. */
const DELIVERY_TYPE_ORDER: DeliveryType[] = [
  'GENERAL_USE',
  'SELF_HOSTED',
  'SAAS',
  'VENDOR_MANAGED',
];

/** Pusty formularz — wartości domyślne zgodne z defaultami schematu Prisma. */
const EMPTY = {
  name: '',
  version: '',
  deliveryType: 'GENERAL_USE' as DeliveryType,
  baseUrl: '',
  hostingLocation: '',
  adminTeam: '',
  supportOwnerType: '' as '' | SupportOwnerType,
  supportOwnerName: '',
  supportEmail: '',
  supportUrl: '',
  supportChannel: '' as '' | SupportChannel,
  supportNotes: '',
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
  // Poza `toPayload`: przypisania nie lecą w DTO aplikacji, a osobnym
  // `PUT` po udanym zapisie — patrz `handleSubmit`.
  ipAddressIds: [] as string[],
};

type FormState = typeof EMPTY;

/** Klucz szkicu nowej aplikacji w `localStorage`. */
const SZKIC_KLUCZ = 'webinv.szkic.aplikacji';

/** Zamienia rekord API na stan formularza (daty w formacie RRRR-MM-DD). */
function fromApp(app: Application): FormState {
  return {
    name: app.name,
    version: app.version,
    deliveryType: app.deliveryType,
    baseUrl: app.baseUrl ?? '',
    hostingLocation: app.hostingLocation ?? '',
    adminTeam: app.adminTeam ?? '',
    supportOwnerType: app.supportOwnerType ?? '',
    supportOwnerName: app.supportOwnerName ?? '',
    supportEmail: app.supportEmail ?? '',
    supportUrl: app.supportUrl ?? '',
    supportChannel: app.supportChannel ?? '',
    supportNotes: app.supportNotes ?? '',
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
    // Karta aplikacji nie niesie adresów — to osobne zapytanie IPAM,
    // więc tu zostaje pusto, a efekt niżej zasieje prawdziwy zestaw.
    ipAddressIds: [],
  };
}

/**
 * Buduje payload. `forbidNonWhitelisted` w ValidationPipe odrzuca
 * nieznane pola, więc wysyłamy wyłącznie to, co jest w DTO —
 * puste wartości zamieniamy na `null`, a nie pusty string.
 *
 * Blok wsparcia wysyłamy **zawsze**, także gdy typ to `GENERAL_USE`
 * i pola nie są widoczne. Dzięki temu przełączenie typu w trakcie
 * edycji niczego nie gubi, a powrót do `SAAS` odsłania dane, które
 * nadal tam są. Serwer z kolei ich nie czyści — patrz `mapDto`.
 */
function toPayload(form: FormState) {
  const text = (v: string) => (v.trim() === '' ? null : v.trim());

  return {
    name: form.name.trim(),
    version: form.version.trim(),
    deliveryType: form.deliveryType,
    baseUrl: text(form.baseUrl),
    hostingLocation: text(form.hostingLocation),
    adminTeam: text(form.adminTeam),
    supportOwnerType: form.supportOwnerType || null,
    supportOwnerName: text(form.supportOwnerName),
    supportEmail: text(form.supportEmail),
    supportUrl: text(form.supportUrl),
    supportChannel: form.supportChannel || null,
    supportNotes: text(form.supportNotes),
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
  // Id aplikacji zapisanej w tej sesji, której przypisań nie udało się
  // dopiąć (drugi krok poniżej). Od tamtej chwili formularz edytuje
  // ten wpis przez PATCH — drugie kliknięcie „Zapisz" nie może POST-ować
  // duplikatu aplikacji, która już w bazie leży.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const effectiveId = id ?? createdId ?? '';
  const update = useUpdateApplication(effectiveId);

  // Zestaw przypisany w bazie — punkt odniesienia drugiego kroku:
  // niezmienione zaznaczenie nie wysyłamy w ogóle (backend zrobiłby
  // z niego no-op, ale po co rundy sieciowe i zbędny audyt).
  const { data: assigned } = useApplicationIpAddresses(id);
  const [assignedLoaded, setAssignedLoaded] = useState(!isEdit);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(!isEdit);

  // ─── Zabezpieczenie niezapisanych zmian ─────────────────────
  //
  // `brudny` staje się się prawdą przy pierwszej ręcznej zmianie pola
  // (`set`/`toggle`) i gaśnie po udanym zapisie. Efekty wczytujące dane
  // z serwera nie idą przez `set`, więc nie uruchamiają blokady.
  const [brudny, setBrudny] = useState(false);
  const dirtyGuard = useDirtyGuard(brudny);

  // ─── Szkic nowej aplikacji (localStorage) ───────────────────
  //
  // Tylko dla trybu tworzenia: przywrócenie szkicu w trybie edycji
  // nadpisałoby stan z bazy starszymi danymi i wyglądało jak błąd.
  const [szkicPrzywrócony, setSzkicPrzywrócony] = useState(false);

  useEffect(() => {
    if (isEdit) return;
    try {
      const surowy = localStorage.getItem(SZKIC_KLUCZ);
      if (!surowy) return;
      const zapisany = JSON.parse(surowy) as FormState;
      setForm((prev) => ({ ...zapisany, ipAddressIds: prev.ipAddressIds }));
      setSzkicPrzywrócony(true);
    } catch {
      // Uszkodzony szkic to nie powód, by nie otworzyć formularza.
      localStorage.removeItem(SZKIC_KLUCZ);
    }
    // Jednorazowo na montaż — kolejne zmiany formularza zapisuje efekt niżej.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isEdit || !loaded || !brudny) return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(SZKIC_KLUCZ, JSON.stringify(form));
      } catch {
        // Pełny localStorage nie może zabić formularza — brak szkicu
        // to tylko powrót do stanu sprzed tej poprawki.
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [form, isEdit, loaded, brudny]);

  const odrzućSzkic = () => {
    localStorage.removeItem(SZKIC_KLUCZ);
    setForm({ ...EMPTY });
    setSzkicPrzywrócony(false);
    setBrudny(false);
  };


  // Wczytujemy dane aplikacji do formularza tylko raz — potem
  // użytkownik edytuje lokalny stan, a nie ten z serwera.
  useEffect(() => {
    if (data?.application && !loaded) {
      // `ipAddressIds` zostawiamy nietknięte: zapytanie IPAM ma własny
      // cache i może opaść szybciej niż karta aplikacji.
      setForm((prev) => ({
        ...fromApp(data.application),
        ipAddressIds: prev.ipAddressIds,
      }));
      setLoaded(true);
    }
  }, [data, loaded]);

  useEffect(() => {
    if (assigned && !assignedLoaded) {
      setForm((prev) => ({
        ...prev,
        ipAddressIds: assigned.addresses.map((a) => a.id),
      }));
      setAssignedLoaded(true);
    }
  }, [assigned, assignedLoaded]);

  // Drugi krok zapisu: żyje jako osobny komponent z własnym hookiem —
  // patrz komentarz przy `AddressAssignStep`. `attempt` wymusza
  // re-montaż przy ponowieniu (klucz w JSX).
  const [assignJob, setAssignJob] = useState<{
    appId: string;
    ids: string[];
    attempt: number;
  } | null>(null);
  const [assignFailed, setAssignFailed] = useState(false);
  // Powód porażki drugiego kroku — administrator musi odróżnić 404
  // (adresy między czasem skasowane) od kiwnięcia sieci.
  const [assignError, setAssignError] = useState<string | null>(null);

  const mutation = effectiveId ? update : create;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setBrudny(true);
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
    setBrudny(true);
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

  const sameAsAssigned = (ids: string[]) => {
    const baseline = assigned?.addresses.map((a) => a.id) ?? [];
    if (ids.length !== baseline.length) return false;
    const set = new Set(baseline);
    return ids.every((x) => set.has(x));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    // Przypisania z poprzedniej próby jeszcze leci — nie dublujemy.
    if (assignJob && !assignFailed) return;
    setAssignFailed(false);
    setAssignError(null);

    if (!validate()) {
      // Przewijamy do pierwszego błędu, żeby formularz nie był „gubiony"
      const first = document.querySelector('[aria-invalid="true"]');
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const payload = toPayload(form);

    try {
      const result = effectiveId
        ? await update.mutateAsync(payload)
        : await create.mutateAsync(payload);

      const appId = result.application.id;
      setCreatedId(appId);
      // Zapis udany — blokada wyjścia i szkic przestają być aktualne.
      // Przed nawigacją, żeby przekierowanie nie wpadło we własną bramkę.
      setBrudny(false);
      localStorage.removeItem(SZKIC_KLUCZ);

      // Drugi krok dopiero teraz: do czasu tej odpowiedzi aplikacja
      // mogła nie istnieć w bazie, a klucz obcy przypisań odrzuciłby
      // PUT. Niezmienione zaznaczenie odpuszczamy całkiem.
      if (sameAsAssigned(form.ipAddressIds)) {
        navigate(`/aplikacje/${appId}`, { replace: true });
        return;
      }

      setAssignJob((prev) => ({
        appId,
        ids: [...form.ipAddressIds],
        attempt: (prev?.attempt ?? 0) + 1,
      }));
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
        back={{
          to: effectiveId ? `/aplikacje/${effectiveId}` : '/aplikacje',
          label: 'Anuluj',
        }}
      />

      <ErrorMessage error={mutation.error} className="mb-5" />

      {/* Przywrócony szkic — użytkownik musi wiedzieć, skąd te dane,
          i mieć jeden klik do odrzucenia. */}
      {szkicPrzywrócony && (
        <div role="status" className="alert alert-info mb-5">
          <div className="min-w-0 flex-1">
            <p className="font-medium">Przywrócono szkic formularza.</p>
            <p className="mt-1 text-fg-muted">
              Dane pochodzą z ostatniej sesji na tym urządzeniu.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={odrzućSzkic}>
            Odrzuć szkic
          </Button>
        </div>
      )}

      {/* Bramka niezapisanych zmian — modal + beforeunload. */}
      {dirtyGuard}

      {/* Zapis częściowy: aplikacja poszła do bazy, PUT przypisań
          nie. Nie wykasowujemy wpisu — usunięcie zaraz po udanym
          zapisie byłoby gorsze niż brak adresów. */}
      {assignFailed && assignJob && (
        <div role="alert" className="alert alert-warn mb-5">
          <IconAlert className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Aplikacja została zapisana, ale adresy IP już nie.
            </p>
            <p className="mt-1">
              Zapis danych aplikacji jest bezpieczny w bazie — nie powtórzy
              się przy ponowieniu. Możesz poprawić zaznaczenie i zapisać
              jeszcze raz albo spróbować ponownie samych przypisań.
            </p>
            {assignError && (
              <p className="mt-1 text-fg-muted">Powód: {assignError}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setAssignJob((prev) =>
                prev ? { ...prev, attempt: prev.attempt + 1 } : prev,
              );
              setAssignFailed(false);
              setAssignError(null);
            }}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium
                       underline-offset-2 hover:underline"
          >
            Ponów przypisanie
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {/* ─── Identyfikacja ─────────────────────────────────── */}
        <fieldset className="card px-5 py-4">
          <legend className="group-title">
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
            <Select
              label="Typ dostarczenia"
              value={form.deliveryType}
              onChange={(e) =>
                set('deliveryType', e.target.value as DeliveryType)
              }
              hint={DELIVERY_TYPE_DESCS[form.deliveryType]}
            >
              {DELIVERY_TYPE_ORDER.map((type) => (
                <option key={type} value={type}>
                  {DELIVERY_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
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

        {/* ─── Hosting i wsparcie ────────────────────────────── */}
        {/* Tylko dla typów innych niż `GENERAL_USE`. Ukrycie jest
            tylko wizualne — wartości zostają w stanie formularza
            i lecą do serwera, więc powrót do typu usługi niczego
            nie gubi. */}
        {form.deliveryType !== 'GENERAL_USE' && (
          <>
            <fieldset className="card px-5 py-4">
              <legend className="group-title">
                Dostęp i hosting
              </legend>

              <div className="grid gap-4 sm:grid-cols-2">
                <TextInput
                  label="Adres bazowy"
                  value={form.baseUrl}
                  onChange={(e) => set('baseUrl', e.target.value)}
                  error={errors.baseUrl}
                  maxLength={500}
                  placeholder="np. https://jira.firma.pl"
                  hint="Pod tym adresem aplikacja jest dostępna."
                />
                <TextInput
                  label="Gdzie hostowane"
                  value={form.hostingLocation}
                  onChange={(e) => set('hostingLocation', e.target.value)}
                  error={errors.hostingLocation}
                  maxLength={200}
                  placeholder="np. k8s-prod-eu, serwer FIL-01"
                  hint="Klaster, serwer lub cloud, w którym to działa."
                />
                <TextInput
                  label="Zespół administracyjny"
                  value={form.adminTeam}
                  onChange={(e) => set('adminTeam', e.target.value)}
                  error={errors.adminTeam}
                  maxLength={200}
                  placeholder="np. Zespół Platformy"
                  hint="Kto technicznie zarządza — nie helpdesk."
                />
              </div>

              {/* Adresy IP — wyłącznie dla `SELF_HOSTED`, czyli gdy
                  aplikacja stoi na naszym sprzęcie i adres w ogóle
                  istnieje. Bez dodatkowej checki uprawnień: formularz
                  siedzi za `app:write`, a każda rola z `app:write` ma
                  też `ipam:write` (patrz `PERMISSIONS`). Ukrycie pola
                  nie zeruje zaznaczenia — ta sama reguła co przy bloku
                  wsparcia: zmiana typu tam i z powrotem niczego nie gubi. */}
              {form.deliveryType === 'SELF_HOSTED' && (
                <fieldset className="mt-4 border-t border-line pt-4">
                  <legend className="label">Adresy IP</legend>
                  <p className="mb-3 meta-text">
                    Adresy z katalogu IPAM przypisane do tej aplikacji.
                    Zapis trafi do niej osobnym żądaniem po zachowaniu
                    pozostałych pól.
                  </p>
                  <IpAddressPicker
                    value={form.ipAddressIds}
                    onChange={(ids) => set('ipAddressIds', ids)}
                  />
                </fieldset>
              )}
            </fieldset>

            <fieldset className="card px-5 py-4">
              <legend className="group-title">
                Wsparcie
              </legend>

              <p className="mb-3 meta-text">
                Wszystkie pola są opcjonalne — uzupełnij to, co wiesz.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  label="Wsparcie prowadzi"
                  value={form.supportOwnerType}
                  onChange={(e) =>
                    set('supportOwnerType', e.target.value as SupportOwnerType | '')
                  }
                >
                  <option value="">— nie wiadomo —</option>
                  {Object.entries(SUPPORT_OWNER_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Główny kanał"
                  value={form.supportChannel}
                  onChange={(e) =>
                    set('supportChannel', e.target.value as SupportChannel | '')
                  }
                >
                  <option value="">— nie wiadomo —</option>
                  {Object.entries(SUPPORT_CHANNEL_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                <TextInput
                  label="Wsparcie — kto"
                  value={form.supportOwnerName}
                  onChange={(e) => set('supportOwnerName', e.target.value)}
                  error={errors.supportOwnerName}
                  maxLength={200}
                  placeholder="np. Atlassian albo Helpdesk IT"
                  hint="Dostawca albo zespół, do którego idzie zgłoszenie."
                />
                <TextInput
                  label="Wsparcie — e-mail"
                  type="email"
                  autoComplete="off"
                  value={form.supportEmail}
                  onChange={(e) => set('supportEmail', e.target.value)}
                  error={errors.supportEmail}
                  maxLength={320}
                  placeholder="support@firma.pl"
                />
                <TextInput
                  label="Wsparcie — adres zgłoszeń"
                  value={form.supportUrl}
                  onChange={(e) => set('supportUrl', e.target.value)}
                  error={errors.supportUrl}
                  maxLength={500}
                  placeholder="https://firma.atlassian.net"
                  hint="Portal, na którym zakłada się ticket."
                />
              </div>

              <Textarea
                label="Wsparcie — uwagi"
                value={form.supportNotes}
                onChange={(e) => set('supportNotes', e.target.value)}
                error={errors.supportNotes}
                hint="Jak wygląda zgłaszanie u nas — np. przez Jira IT."
                rows={3}
              />
            </fieldset>
          </>
        )}

        {/* ─── Opis ─────────────────────────────────────────── */}
        <fieldset className="card px-5 py-4">
          <legend className="group-title">
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
          <legend className="group-title">
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
              <p className="mb-2 meta-text">
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
                          <span className="field-value min-w-0 flex-1">
                            {user.fullName}
                            <span className="ml-1.5 meta-text">
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
          <legend className="group-title">
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
          <legend className="group-title">
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
          <legend className="group-title">
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
          <legend className="group-title">
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
          <legend className="group-title">
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
        {/* Drugi krok zapisu — widoczny tylko gdy trwa; jego porażka
            nie jest kasowana, bo rodzic trzyma `assignJob` do ponowienia. */}
        {assignJob && (
          <AddressAssignStep
            key={assignJob.attempt}
            appId={assignJob.appId}
            ids={assignJob.ids}
            onSaved={() =>
              navigate(`/aplikacje/${assignJob.appId}`, { replace: true })
            }
            onFailed={(error) => {
              // Ta sama konwencja co w `ErrorMessage`: z API polski komunikat
              // (np. 404 o skasowanym adresie), poza nim ogólne zdanie.
              setAssignError(
                error instanceof ApiError
                  ? error.message
                  : 'Coś poszło nie tak. Spróbuj ponownie.',
              );
              setAssignFailed(true);
            }}
          />
        )}

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-line bg-surface/95 py-3 backdrop-blur">
          {/* Link, nie `Button` — `<Link><Button/></Link>` to `<a><button>`,
              czyli HTML, którego nie da się dobrze obsłużyć klawiaturą.
              Wygląd bierze z `buttonClass`, żeby nie powtarzać wariantu
              `secondary` ręcznie. */}
          <Link
            to={effectiveId ? `/aplikacje/${effectiveId}` : '/aplikacje'}
            className={buttonClass('secondary')}
          >
            Anuluj
          </Link>
          {/* `assignJob && !assignFailed` — podczas drugiego kroku nie
              pozwalamy wysłać formularza ponownie; po porażce krok
              stoi w miejscu, a przycisk wraca do życia, bo następny
              submit rusza i PATCH, i nowe przypisanie. */}
          <Button
            type="submit"
            loading={
              mutation.isPending || (Boolean(assignJob) && !assignFailed)
            }
          >
            <IconCheck className="size-4" />
            {isEdit ? 'Zapisz zmiany' : 'Dodaj do rejestru'}
          </Button>
        </div>
      </form>
    </>
  );
}

/**
 * Drugi krok zapisu — `PUT` przypisujący adresy już zapisanej aplikacji.
 *
 * Osobny komponent, bo `useSetApplicationIpAddresses` zamyka identyfikator
 * aplikacji w chwili tworzenia hooka: przy edycji znamy go z routingu,
 * ale przy tworzeniu — dopiero z odpowiedzi POST. Hook renderowany
 * w rodzicu zamknąłby wtedy pusty string. Montowany z gotowym `appId`,
 * komponent domyka lukę bez kombinowania ze stanem.
 *
 * Efekt wystrzeliwuje dokładnie raz na montaż (straż `started` blokuje
 * drugi przebieg StrictMode w dev; produkcyjnie i tak idzie raz).
 * `key={attempt}` u rodzica to całe ponowienie. Porażka nie cofa nic:
 * aplikacja jest w bazie i zostaje w bazie — rodzic pokazuje ostrzeżenie.
 */
function AddressAssignStep({
  appId,
  ids,
  onSaved,
  onFailed,
}: {
  appId: string;
  ids: string[];
  onSaved: () => void;
  /** Dostaje błąd mutacji — rodzic pokazuje jego powód w banerze ostrzeżenia. */
  onFailed: (error: unknown) => void;
}) {
  const assign = useSetApplicationIpAddresses(appId);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    assign.mutateAsync(ids).then(onSaved, onFailed);
    // Puste zależności celowe: jedna próba na montaż. `assign`, `ids`,
    // `onSaved` i `onFailed` są zamknięte z rendera montującego — rodzic
    // nie zmienia `appId`/`ids` w trakcie życia tego egzemplarza.
  }, []);

  return assign.isPending ? (
    <Spinner label="Przypisywanie adresów IP…" />
  ) : null;
}
