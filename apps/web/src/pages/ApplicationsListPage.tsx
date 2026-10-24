import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  useApplicationFormOptions,
  useApplications,
  useBulkUpdateApplications,
  useDeleteApplication,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/layout/AppLayout';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Checkbox, Select } from '../components/ui/Field';
import { EmptyState, ErrorMessage, TableSkeleton } from '../components/ui/Feedback';
import { Modal } from '../components/ui/Modal';
import { useToast } from '../components/ui/Toast';
import { Th } from '../components/ui/Table';
import { SortableTh } from '../components/ui/SortableTh';
import { Pagination } from '../components/ui/Pagination';
import {
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
  CRITICALITY_TONES,
  CRITICALITY_LABELS,
  DELIVERY_TYPE_TONES,
  DELIVERY_TYPE_LABELS,
  SECURITY_TONES,
  SECURITY_LABELS,
  STATUS_TONES,
  STATUS_LABELS,
  type AppStatus,
  type Application,
  type ApplicationFilters,
  type BulkUpdatePayload,
  type DeliveryType,
  type Environment,
  type SecurityClass,
} from '../types';
import { ApiError } from '../lib/api';

const PAGE_SIZE = 25;

/**
 * Kolejność kolumn w tabeli — **musi odpowiadać kolejności `<td>` w
 * `ApplicationRow`**. Te dwa miejsca są jedynym kontraktem: nagłówek
 * renderuje ta lista, a komórki pisze ręcznie jedna po drugiej.
 * Rozjazd między nimi nie przeszkadza w kompilacji ani w testach — tabela
 * po prostu pokazuje inną etykietę niż dane pod nią. Pilnuje tego
 * `apps/api/test/sort-kolumn.test.ts`.
 *
 * Nazwy pól sortowalnych muszą pokrywać się z białą listą `SORTABLE`
 * w API — API ignoruje nieznane pole po cichu: strzałek by się nie
 * ruszyła, a użytkownik nie miałby pojęcia, dlaczego.
 *
 * Wpis bez `sortBy` to kolumna niesortowalna: `SortableTh` renderuje
 * wtedy zwykły `<Th>`, a `<th>` dostaje tę samą klasę `.table-head`, więc
 * wygląda identycznie jak sortowalne.
 *
 * `guestHidden` = kolumna znika u gościa razem ze strzałką. Pola
 * bezpieczeństwa, krytyczności i właściciela nie są w jego widoku, więc
 * kolejność wierszy zdradziłaby ukrytą wartość — API i tak odrzuca takie
 * sortowanie (`GUEST_SORTABLE`).
 */
type Kolumna = { label: string; sortBy?: string; guestHidden?: boolean };

const SORT_COLUMNS: Kolumna[] = [
  { label: 'Nazwa', sortBy: 'name' },
  { label: 'Dostarczanie', sortBy: 'deliveryType' },
  { label: 'Status', sortBy: 'status' },
  // Niesortowalna: pola nie ma w modelu, a „Wniosek o dostęp" ma własny,
  // niezależny mechanizm. Stoi tu, a nie na końcu listy, bo stoi tak
  // w wierszu — czwarte miejsce, między statusem a klasyfikacjami.
  { label: 'Wniosek o dostęp' },
  { label: 'Bezpieczeństwo', sortBy: 'securityClass', guestHidden: true },
  { label: 'Krytyczność', sortBy: 'criticality', guestHidden: true },
  { label: 'Właściciel', sortBy: 'ownerEmail', guestHidden: true },
];

/**
 * Kolejność typów dostarczenia w filtrze — ta sama co w formularzu,
 * żeby czytelnik nie musiał szukać „SaaS" wśród losowych wpisów.
 */
const DELIVERY_TYPE_ORDER: DeliveryType[] = [
  'GENERAL_USE',
  'SELF_HOSTED',
  'SAAS',
  'VENDOR_MANAGED',
];

export function ApplicationsListPage() {
  const { can, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const toast = useToast();

  // ─── Filtry ────────────────────────────────────────────────
  // Trzymamy je w URL, żeby dało się linkować do widoku
  // (np. z pulpitu) i udostępnić go koledze.
  const filters: ApplicationFilters = useMemo(
    () => ({
      q: params.get('q') ?? undefined,
      status: params.get('status') ?? undefined,
      securityClass: params.get('securityClass') ?? undefined,
      ownerEmail: params.get('ownerEmail') ?? undefined,
      environmentId: params.get('environmentId') ?? undefined,
      deliveryType: params.get('deliveryType') ?? undefined,
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
  // Adresy właścicieli idą tylko do filtra „Właściciel", a
  // `/applications/owner-options` wymaga sesji — gość go nie pobiera.
  const { environments, owners } = useApplicationFormOptions(Boolean(user));

  // Pole wyszukiwania ma własny stan, żeby nie odpytywać API
  // na każdy znak — synchronizujemy je z URL przy zmianie filtra.
  // Wzorzec „dostosowania stanu podczas renderu" (react.dev) — efekt
  // dałby tę samą wartość o kadr później.
  const [search, setSearch] = useState<string>(filters.q ?? '');
  // Śledcą trzyma **dokładne** wejście, łącznie z `undefined` — wtedy
  // brak parametru w URL nie zapętla porównania z znormalizowanym `''`.
  const [poprzednieQ, setPoprzednieQ] = useState<string | undefined>(filters.q);
  if (filters.q !== poprzednieQ) {
    setPoprzednieQ(filters.q);
    setSearch(filters.q ?? '');
  }

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setFilter('q', search.trim());
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const offset = filters.offset ?? 0;

  // ─── Zaznaczenie do masowej aktualizacji ──────────────────
  // Zbiór identyfikatorów trzyma się między stronami — zaznaczenie
  // nie ginie przy przewijaniu wyników. Usunięte aplikacje nie mają
  // checkboxa, więc nigdy nie trafiają do zbioru.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const canWrite = can('app:write');
  const zaznaczoneWidoczne = items.filter((a) => !a.deletedAt);
  const wszystkieWidoczneZaznaczone =
    zaznaczoneWidoczne.length > 0 &&
    zaznaczoneWidoczne.every((a) => selected.has(a.id));

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** „Zaznacz wszystkie na stronie" — drugie kliknięcie usuwa zaznaczenie. */
  const toggleWszystkieWidoczne = () => {
    setSelected((prev) => {
      if (wszystkieWidoczneZaznaczone) {
        const next = new Set(prev);
        for (const a of zaznaczoneWidoczne) next.delete(a.id);
        return next;
      }
      return new Set([...prev, ...zaznaczoneWidoczne.map((a) => a.id)]);
    });
  };

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
    filters.ownerEmail && {
      key: 'ownerEmail',
      label: `Właściciel: ${filters.ownerEmail}`,
    },
    !isGuest && filters.criticality && {
      key: 'criticality',
      label: `Krytyczność: ${CRITICALITY_LABELS[filters.criticality]}`,
    },
    filters.deliveryType && {
      key: 'deliveryType',
      label: `Dostarczanie: ${DELIVERY_TYPE_LABELS[filters.deliveryType as DeliveryType]}`,
    },
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

          {/* Właściciel to osoba z ewidencji — lista pochodzi
          z aplikacji, więc obejmuje tylko realnie występujących wymienionych. */}
          {!isGuest && (
            <Select
              label="Właściciel"
              value={filters.ownerEmail ?? ''}
              onChange={(e) => setFilter('ownerEmail', e.target.value)}
              className="w-56"
            >
              <option value="">Wszystkie</option>
              {owners.data?.owners.map((w) => (
                <option key={w.id} value={w.email}>
                  {w.fullName} ({w.email})
                </option>
              ))}
            </Select>
          )}

          {/* Typ dostarczenia jest widoczny także dla gościa
              (pole `deliveryType` nie znika z odpowiedzi publicznej). */}
          <Select
            label="Dostarczanie"
            value={filters.deliveryType ?? ''}
            onChange={(e) => setFilter('deliveryType', e.target.value)}
            className="w-52"
          >
            <option value="">Wszystkie</option>
            {DELIVERY_TYPE_ORDER.map((type) => (
              <option key={type} value={type}>
                {DELIVERY_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>

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
                  className="badge tone-neutral hover:bg-surface-3"
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

      {/* Pasek zaznaczenia — pojawia się dopiero, gdy coś zaznaczono,
          więc zwykły odczyt listy niczym nie jest obciążony. */}
      {canWrite && selected.size > 0 && (
        <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm text-fg">
            Zaznaczono{' '}
            <strong className="font-semibold">
              {selected.size}{' '}
              {selected.size === 1
                ? 'aplikację'
                : selected.size < 5
                  ? 'aplikacje'
                  : 'aplikacji'}
            </strong>
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setSelected(new Set())}>
              <IconX className="size-4" />
              Wyczyść zaznaczenie
            </Button>
            <Button onClick={() => setBulkOpen(true)}>
              <IconPencil className="size-4" />
              Aktualizuj masowo
            </Button>
          </div>
        </div>
      )}

      {/* Tabela */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <TableSkeleton wierszy={8} kolumn={6} />
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
                  canWrite={canWrite}
                  showRestricted={!isGuest}
                  selected={selected.has(app.id)}
                  onToggle={() => toggleSelected(app.id)}
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
                <thead className="border-b border-line-strong bg-surface-2">
                  <tr>
                    {/* Checkbox zaznaczenia stoi przed listą kolumn
                        sortowalnych — nagłówek i wiersz dostają go razem. */}
                    {canWrite && (
                      <Th className="w-8 px-2">
                        <input
                          type="checkbox"
                          aria-label="Zaznacz wszystkie aplikacje na stronie"
                          className="size-4 cursor-pointer rounded border-line-strong text-brand-600 focus:ring-brand-500/30"
                          checked={wszystkieWidoczneZaznaczone}
                          onChange={toggleWszystkieWidoczne}
                        />
                      </Th>
                    )}
                    {SORT_COLUMNS.filter(
                      (k) => !isGuest || !('guestHidden' in k) || !k.guestHidden,
                    ).map((kolumna) => (
                      <SortableTh
                        key={kolumna.label}
                        label={kolumna.label}
                        sortBy={kolumna.sortBy}
                        currentSort={filters.sort}
                        onSort={(pole) => setFilter('sort', pole)}
                        className={kolumna.label === 'Nazwa' ? 'w-[24%]' : ''}
                      />
                    ))}
                    <Th className="w-8 px-2">
                      <span className="sr-only">Akcje</span>
                    </Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {items.map((app) => (
                    <ApplicationRow
                      key={app.id}
                      app={app}
                      canWrite={canWrite}
                      showRestricted={!isGuest}
                      selected={selected.has(app.id)}
                      onToggle={() => toggleSelected(app.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Paginacja — przy jednej stronie (albo pustej liście)
                komponent nie renderuje się w ogóle. „Aktualizuję…"
                tylko gdy dane dolewają w tle (placeholderData trzyma
                poprzednią stronę, więc lista nie miga). */}
            {total > 0 && (
              <div className="relative border-t border-line">
                {isFetching && (
                  <span
                    role="status"
                    className="pointer-events-none absolute top-2 left-4 text-xs text-fg-subtle"
                  >
                    aktualizuję…
                  </span>
                )}
                <Pagination
                  strona={Math.floor(offset / PAGE_SIZE) + 1}
                  ostatnia={Math.max(Math.ceil(total / PAGE_SIZE), 1)}
                  total={total}
                  onZmien={(s) => setFilter('offset', String((s - 1) * PAGE_SIZE))}
                  etykieta="Paginacja rejestru"
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Okno masowej aktualizacji — zaznaczenie czyścimy dopiero po
          udanym zapisie, żeby błąd nie odebrał użytkownikowi pracy. */}
      {bulkOpen && (
        <BulkUpdateModal
          ids={[...selected]}
          environments={environments.data?.environments ?? []}
          onClose={() => setBulkOpen(false)}
          onDone={(zaktualizowano, pominięto) => {
            toast.pokaz(
              pominięto > 0
                ? `Zaktualizowano ${liczebnikAplikacji(zaktualizowano)}, pominięto ${pominięto}.`
                : `Zaktualizowano ${liczebnikAplikacji(zaktualizowano)}.`,
            );
            setSelected(new Set());
            setBulkOpen(false);
          }}
        />
      )}
    </>
  );
}

/** Biernik dla liczby aplikacji — używa go pasek zaznaczenia i toast. */
function liczebnikAplikacji(n: number): string {
  return n === 1 ? '1 aplikację' : n < 5 ? `${n} aplikacje` : `${n} aplikacji`;
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
  selected,
  onToggle,
}: {
  app: Application;
  canWrite: boolean;
  showRestricted: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const remove = useDeleteApplication();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <li className={`px-4 py-3 ${app.deletedAt ? 'opacity-60' : ''}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            {/* Zaznaczenie do masowej aktualizacji — jak w tabeli:
                usunięte aplikacje nie dostają checkboxa. */}
            {canWrite && !app.deletedAt && (
              <input
                type="checkbox"
                aria-label={`Zaznacz ${app.name}`}
                className="mt-1 size-4 shrink-0 cursor-pointer rounded border-line-strong text-brand-600 focus:ring-brand-500/30"
                checked={selected}
                onChange={onToggle}
              />
            )}
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

              {app.deliveryType !== 'GENERAL_USE' && (
                <p className="mt-0.5 truncate meta-text">
                  {DELIVERY_TYPE_LABELS[app.deliveryType]}
                </p>
              )}

              {app.environments.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {app.environments.slice(0, 3).map((env) => (
                    <span
                      key={env.id}
                      className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-fg-muted ring-1 ring-inset ring-line"
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
          <Badge tone={STATUS_TONES[app.status]}>
            {STATUS_LABELS[app.status]}
          </Badge>
          <Badge
            dot={false}
            tone={app.accessRequestRequired ? ACCESS_REQUEST_YES : ACCESS_REQUEST_NO}
          >
            {app.accessRequestRequired ? 'wniosek' : 'bez wniosku'}
          </Badge>
          {showRestricted && app.securityClass && (
            <Badge tone={SECURITY_TONES[app.securityClass]}>
              {SECURITY_LABELS[app.securityClass]}
            </Badge>
          )}
          {app.deletedAt && (
            <Badge tone="danger" dot={false} className="text-[11px]">
              usunięta
            </Badge>
          )}
        </div>
      </li>

      {confirming && (
        <DeleteConfirmModal
          app={app}
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            await remove.mutateAsync(app.id);
            toast.pokaz(`Usunięto aplikację „${app.name}”.`);
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
  selected,
  onToggle,
}: {
  app: Application;
  canWrite: boolean;
  showRestricted: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const remove = useDeleteApplication();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  const handleDelete = async () => {
    await remove.mutateAsync(app.id);
    toast.pokaz(`Usunięto aplikację „${app.name}”.`);
    setConfirming(false);
  };

  return (
    <>
      <tr
        className={`group transition-colors hover:bg-surface-2/70 ${
          app.deletedAt ? 'opacity-60' : ''
        }`}
      >
        {canWrite && (
          <td className="px-2 py-2.5">
            {/* Usunięta aplikacja nie uczestniczy w masowej aktualizacji —
                jej akcje wiersza też są zablokowane. */}
            {!app.deletedAt && (
              <input
                type="checkbox"
                aria-label={`Zaznacz ${app.name}`}
                className="size-4 cursor-pointer rounded border-line-strong text-brand-600 focus:ring-brand-500/30"
                checked={selected}
                onChange={onToggle}
              />
            )}
          </td>
        )}

        <td className="w-[24%] max-w-0 px-3 py-2.5">
          <Link
            to={`/aplikacje/${app.id}`}
            title={`${app.name} ${app.version}`}
            className="block truncate font-semibold text-fg hover:text-brand-600"
          >
            {app.name}
            <span className="ml-1.5 font-normal text-fg-muted">{app.version}</span>
          </Link>

          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {app.environments.slice(0, 3).map((env) => (
              <span
                key={env.id}
                className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-fg-muted ring-1 ring-inset ring-line"
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
              <Badge tone="danger" dot={false} className="text-[11px]">
                usunięta
              </Badge>
            )}
          </div>
        </td>

        <td className="px-3 py-2.5">
          <Badge tone={DELIVERY_TYPE_TONES[app.deliveryType]}>
            {DELIVERY_TYPE_LABELS[app.deliveryType]}
          </Badge>
        </td>

        <td className="px-3 py-2.5">
          <Badge tone={STATUS_TONES[app.status]}>
            {STATUS_LABELS[app.status]}
          </Badge>
        </td>

        <td className="px-3 py-2.5">
          <Badge
            dot={false}
            tone={app.accessRequestRequired ? ACCESS_REQUEST_YES : ACCESS_REQUEST_NO}
          >
            {app.accessRequestRequired ? 'Tak' : 'Nie'}
          </Badge>
        </td>

        {showRestricted && (
          <td className="px-3 py-2.5">
            {app.securityClass && (
              <Badge tone={SECURITY_TONES[app.securityClass]}>
                {SECURITY_LABELS[app.securityClass]}
              </Badge>
            )}
          </td>
        )}

        {showRestricted && (
          <td className="px-3 py-2.5">
            {app.criticality !== undefined && (
              <Badge tone={CRITICALITY_TONES[app.criticality]}>
                {CRITICALITY_LABELS[app.criticality]}
              </Badge>
            )}
          </td>
        )}

        {showRestricted && (
          <td className="px-3 py-2.5 whitespace-nowrap">
            {app.owner ? (
              <a
                href={`mailto:${app.owner.email}`}
                className="text-brand-600 hover:underline dark:text-brand-400"
              >
                {app.owner.fullName}
              </a>
            ) : (
              <span className="meta-text text-amber-800 dark:text-amber-300">
                      nieprzypisana
                    </span>
            )}
          </td>
        )}

        <td className="px-2 py-2.5 text-right">
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
        className="rounded-md p-1.5 text-fg-subtle transition-colors
                   hover:bg-surface-2 hover:text-fg-muted"
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
            className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-xl
                       border border-line bg-surface py-1 shadow-lg shadow-brand-950/10"
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

/** Opcja „— nie zmieniaj —” — pusty select znaczy: pole zostaje nietknięte. */
const NIE_ZMIENIAJ = '';

/**
 * Okno masowej aktualizacji zaznaczonych aplikacji.
 *
 * Każde pole startuje na „nie zmieniaj”, a do żądania trafiają tylko
 * te, które użytkownik faktycznie ustawił — serwer (i tak) scalający
 * PATCH dostaje więc tylko świadome zmiany. Środowiska są jedynym
 * polem dwustopniowym: najpierw „nadpisz”, potem zestaw checkboxów,
 * bo to nadpisanie całej listy, nie dopisanie.
 */
function BulkUpdateModal({
  ids,
  environments,
  onClose,
  onDone,
}: {
  ids: string[];
  environments: Environment[];
  onClose: () => void;
  onDone: (updated: number, skipped: number) => void;
}) {
  const mutate = useBulkUpdateApplications();

  const [deliveryType, setDeliveryType] = useState(NIE_ZMIENIAJ);
  const [status, setStatus] = useState(NIE_ZMIENIAJ);
  const [accessRequest, setAccessRequest] = useState(NIE_ZMIENIAJ);
  const [securityClass, setSecurityClass] = useState(NIE_ZMIENIAJ);
  const [criticality, setCriticality] = useState(NIE_ZMIENIAJ);
  const [envMode, setEnvMode] = useState<'keep' | 'set'>('keep');
  const [envs, setEnvs] = useState<Set<string>>(new Set());

  const payload = useMemo<BulkUpdatePayload>(() => {
    const body: BulkUpdatePayload = { ids };
    if (deliveryType) body.deliveryType = deliveryType as DeliveryType;
    if (status) body.status = status as AppStatus;
    if (accessRequest) body.accessRequestRequired = accessRequest === 'true';
    if (securityClass) body.securityClass = securityClass as SecurityClass;
    if (criticality) body.criticality = Number(criticality);
    if (envMode === 'set') body.environmentIds = [...envs];
    return body;
  }, [ids, deliveryType, status, accessRequest, securityClass, criticality, envMode, envs]);

  // `ids` zawsze jest w ładunku, więc „coś wybrano” to więcej niż samo ids.
  const zmienionoCokolwiek = Object.keys(payload).length > 1;

  const toggleEnv = (id: string) => {
    setEnvs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async () => {
    const wynik = await mutate.mutateAsync(payload);
    onDone(wynik.updated, wynik.skipped.length);
  };

  return (
    <Modal
      open
      title="Masowa aktualizacja aplikacji"
      description={`Zmiany dotkną ${liczebnikAplikacji(ids.length)}. Pola „nie zmieniaj” zostawiają bieżące wartości.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Anuluj
          </Button>
          <Button
            loading={mutate.isPending}
            disabled={!zmienionoCokolwiek}
            onClick={handleSubmit}
          >
            Aktualizuj
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Typ dostarczenia"
          value={deliveryType}
          onChange={(e) => setDeliveryType(e.target.value)}
        >
          <option value={NIE_ZMIENIAJ}>— nie zmieniaj —</option>
          {DELIVERY_TYPE_ORDER.map((type) => (
            <option key={type} value={type}>
              {DELIVERY_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>

        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value={NIE_ZMIENIAJ}>— nie zmieniaj —</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        <Select
          label="Wniosek o dostęp"
          value={accessRequest}
          onChange={(e) => setAccessRequest(e.target.value)}
        >
          <option value={NIE_ZMIENIAJ}>— nie zmieniaj —</option>
          <option value="true">Wymagany</option>
          <option value="false">Niewymagany</option>
        </Select>

        <Select
          label="Bezpieczeństwo"
          value={securityClass}
          onChange={(e) => setSecurityClass(e.target.value)}
        >
          <option value={NIE_ZMIENIAJ}>— nie zmieniaj —</option>
          {Object.entries(SECURITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        <Select
          label="Krytyczność"
          value={criticality}
          onChange={(e) => setCriticality(e.target.value)}
          className="sm:col-span-1"
        >
          <option value={NIE_ZMIENIAJ}>— nie zmieniaj —</option>
          {[4, 3, 2, 1].map((level) => (
            <option key={level} value={level}>
              {CRITICALITY_LABELS[level]}
            </option>
          ))}
        </Select>

        <Select
          label="Środowiska"
          value={envMode}
          onChange={(e) => setEnvMode(e.target.value === 'set' ? 'set' : 'keep')}
        >
          <option value="keep">— nie zmieniaj —</option>
          <option value="set">Nadpisz wybranym zestawem</option>
        </Select>
      </div>

      {envMode === 'set' && (
        <div className="mt-3">
          <p className="label">
            Zestaw środowisk — każda zaznaczona aplikacja dostanie dokładnie ten
            zestaw, a jej obecne przypisania zostaną zastąpione.
          </p>
          <div className="mt-2 grid max-h-48 grid-cols-2 gap-2 overflow-y-auto rounded-xl border border-line p-3">
            {environments.map((env) => (
              <Checkbox
                key={env.id}
                label={env.name}
                checked={envs.has(env.id)}
                onChange={() => toggleEnv(env.id)}
              />
            ))}
            {environments.length === 0 && (
              <p className="meta-text">Brak zdefiniowanych środowisk.</p>
            )}
          </div>
        </div>
      )}

      <ErrorMessage error={mutate.error} className="mt-3" />
    </Modal>
  );
}
