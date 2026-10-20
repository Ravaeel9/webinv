/**
 * Formularz aplikacji — tworzenie i edycja.
 *
 * Po rozbiciu „goda" tu zostaje orkiestracja zapisu w dwóch krokach
 * (zapis aplikacji, potem osobny `PUT` przypisań IPAM), bramka
 * niezapisanych zmian i szkic nowej aplikacji. Walidacja, mapowanie
 * rekordu API i szkic leżą w `lib/application-form.ts`, stan pól
 * w `use-application-form.ts`, sekcje `fieldset` — w
 * `FormSections.tsx`.
 *
 * Struktura dwóch komponentów nie jest ozdobna: formularz startuje
 * raz, z gotowymi wartościami (inicjalizacja przez `useState`),
 * więc kontener montuje ciało dopiero, gdy danych nie brakuje.
 * Dzięki temu nie potrzeba efektu „wczytaj raz", który synchronicznie
 * ustawiałby stan w efekcie.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
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
import { Button, buttonClass } from '../components/ui/Button';
import { ErrorMessage, Spinner } from '../components/ui/Feedback';
import { IconAlert, IconCheck } from '../components/ui/icons';
import {
  EMPTY,
  fromApp,
  toPayload,
  type FormState,
} from '../lib/application-form';
import { useApplicationFormState } from '../components/application/use-application-form';
import {
  DatySection,
  HostingSection,
  IdentyfikacjaSection,
  KlasyfikacjaSection,
  LicencjaSection,
  LinkiSection,
  OdpowiedzialniSection,
  OpisSection,
  SrodowiskaSection,
  WsparcieSection,
} from '../components/application/FormSections';

/** Identyfikatory przypisane aplikacji w IPAM lub pusta lista. */
function assignedId(assigned: {
  addresses: { id: string }[];
} | undefined): string[] {
  return assigned?.addresses.map((a) => a.id) ?? [];
}

export function ApplicationFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const { can } = useAuth();

  const { data, isLoading, error: loadError } = useApplication(id);
  const { environments, users } = useApplicationFormOptions();
  // `users` zostało potrzebne dla administratorów — właściciel to
  // teraz zwykły adres, więc formularz nie potrzebuje słownika kont.

  // Wejście i punkt odniesienia przypisań: w trybie edycji formularz
  // montuje się dopiero po tej odpowiedzi (także po porażce — wtedy
  // zaznaczenie startuje z pustką, jak dotychczas przy braku danych).
  const { data: assigned, isSuccess: assignedOk, isError: assignedFail } =
    useApplicationIpAddresses(id);

  const canWrite = can('app:write');
  const dokumentGotowy = isEdit && Boolean(data?.application) && !loadError;
  const montować = isEdit
    ? dokumentGotowy && (assignedOk || assignedFail)
    : true;

  if (!canWrite) {
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

  if (!montować) return <Spinner label="Dopasowywanie przypisań…" />;

  // Komplet jest: wartości startowe liczone raz, bez efektu.
  // `ipAddressIds` z karty aplikacji to zawsze pusto — rekord API
  // nie niesie adresów; prawdziwe idki przychodzą z zapytania IPAM.
  const wartości: FormState = dokumentGotowy
    ? { ...fromApp(data!.application), ipAddressIds: assignedId(assigned) }
    : EMPTY;

  return (
    <ApplicationFormBody
      id={id}
      tryb={isEdit ? 'edit' : 'create'}
      tytuł={data?.application.name ?? ''}
      wartości={wartości}
      assignedId={() => assignedId(assigned)}
      environments={environments}
      users={users}
    />
  );
}

/**
 * Ciało formularza — jedno życie sesji edycji/stworzenia: stan pól,
 * brud, szkic, oba kroki zapisu.
 */
function ApplicationFormBody({
  id,
  tryb,
  tytuł,
  wartości,
  assignedId: assignedIdTeraz,
  environments,
  users,
}: {
  /** Id z routingu lub brak — wtedy tworzymy. */
  id?: string;
  tryb: 'create' | 'edit';
  tytuł: string;
  wartości: FormState;
  /** Baseline przypisań z bazy — odrośnięte nie wysyłamy ponownie. */
  assignedId: () => string[];
  environments: {
    isLoading: boolean;
    data?: { environments: { id: string; name: string }[] };
  };
  users: {
    isLoading: boolean;
    data?: { users: { id: string; username: string; fullName: string }[] };
  };
}) {
  const isEdit = tryb === 'edit';
  const navigate = useNavigate();

  // Id aplikacji zapisanej w tej sesji, której przypisań nie udało się
  // dopiąć (drugi krok poniżej). Od tej chwili formularz edytuje ten
  // wpis PATCH-em — drugie kliknięcie „Zapisz" nie może POST-ować
  // duplikatu aplikacji, która już w bazie leży.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const effectiveId = id ?? createdId ?? '';

  const update = useUpdateApplication(effectiveId);
  const create = useCreateApplication();
  const mutation = effectiveId ? update : create;

  const {
    form,
    errors,
    dirtyGuard,
    szkicPrzywrócony,
    odrzućSzkic,
    set,
    toggle,
    validate,
    oczyszczPoZapisie,
  } = useApplicationFormState({ tryb, wartości });

  const ctx = { form, errors, set, toggle };

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

  /** Niezmienione zaznaczenie odpuszczamy całkiem — mniej audytu. */
  const sameAsAssigned = (ids: string[]) => {
    const baseline = assignedIdTeraz();
    if (ids.length !== baseline.length) return false;
    const znane = new Set(baseline);
    return ids.every((x) => znane.has(x));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    // Przypisania z poprzedniej próby jeszcze lecą — nie dublujemy.
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
      oczyszczPoZapisie();

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
    } catch {
      // Błędy walidacji z serwera trafiają do error message;
      // scroll do góry, bo komunikat jest nad formularzem.
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <>
      <PageHeader
        title={isEdit ? `Edycja: ${tytuł}` : 'Nowa aplikacja'}
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
          nie. Nie kasujemy wpisu — usunięcie zaraz po udanym
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
        <IdentyfikacjaSection ctx={ctx} />

        {/* Hosting i wsparcie — tylko dla typów innych niż `GENERAL_USE`.
            Ukrycie jest tylko wizualne: wartości zostają w stanie
            formularza i lecą do serwera, więc zmiana typu tam i z
            powrotem niczego nie gubi. */}
        {form.deliveryType !== 'GENERAL_USE' && (
          <>
            <HostingSection ctx={ctx} />
            <WsparcieSection ctx={ctx} />
          </>
        )}

        <OpisSection ctx={ctx} />
        <OdpowiedzialniSection ctx={ctx} users={users} />
        <DatySection ctx={ctx} />
        <KlasyfikacjaSection ctx={ctx} />
        <SrodowiskaSection ctx={ctx} environments={environments} />
        <LicencjaSection ctx={ctx} />
        <LinkiSection ctx={ctx} />

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return assign.isPending ? (
    <Spinner label="Przypisywanie adresów IP…" />
  ) : null;
}
