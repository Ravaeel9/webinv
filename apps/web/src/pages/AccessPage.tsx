import { useState } from 'react';
import { Link } from 'react-router';
import { useAccessMatrix, useApplicationOptions, usePersons, usePersonsCount } from '../lib/queries';
import { downloadAccessExport, nazwaPlikuRaportu } from '../lib/queries';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { PageHeader } from '../components/layout/AppLayout';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Checkbox, Select, TextInput } from '../components/ui/Field';
import { EmptyState, ErrorMessage, Spinner } from '../components/ui/Feedback';
import { Table, Tbody, Td, Th, Thead } from '../components/ui/Table';
import { IconDownload, IconPlus } from '../components/ui/icons';
import { formatDate } from '../lib/format';
import { ImportPersonsModal } from '../components/access/ImportPersonsModal';
import { ImportMatrixModal } from '../components/access/ImportMatrixModal';
import { NewPersonModal } from '../components/access/NewPersonModal';
import {
  ACCESS_LEVEL_LABELS,
  type AccessLevel,
  type AccessMatrixFilters,
} from '../types';

const POZIOMY: AccessLevel[] = ['OWNER', 'ADMIN', 'USER', 'READ_ONLY'];

/**
 * Strona „Uprawnienia": katalog osób i macierz zbiorcza.
 *
 * Jedna strona z dwiema zakładkami, bo to dwa widoki na tę samą
 * macierz: „kto jest" i „kto do czego ma dostęp”. Osobne trasy dawałyby
 * dwa adresy do tej samej listy, których nikt nie odróżni.
 */
export function AccessPage() {
  const [zakladka, setZakladka] = useState<'osoby' | 'macierz'>('osoby');
  const [importOtwarty, setImportOtwarty] = useState(false);
  const [nowaOsoba, setNowaOsoba] = useState(false);
  const { can } = useAuth();
  const edytowac = can('access:write');

  return (
    <>
      <PageHeader
        title="Uprawnienia do aplikacji"
        description="Ewidencja osób mających dostęp do aplikacji. Dostęp nadaje się poza systemem — tu tylko zapisujemy, komu go nadano."
        actions={
          edytowac && (
            <>
              <Button variant="secondary" onClick={() => setNowaOsoba(true)}>
                <IconPlus className="size-4" />
                Dodaj osobę
              </Button>
              <Button onClick={() => setImportOtwarty(true)}>
                <IconDownload className="size-4" />
                Importuj z CSV
              </Button>
            </>
          )
        }
      />

      {/* Zakładki jako kafelki, nie szary pasek: `bg-surface-2` w panelu
          zarezerwowany jest dla pasm nagłówków (`thead`, `.card-section-header`),
          a duże tło pod kontrolką wychodziło poza resztę stron. Wzorzec
          przejęty ze środowisk w formularzu aplikacji — dwa kafelki obok siebie
          wyglądają jak dwa elementy, a nie jak jeden szary blok. Stan aktywny
          to `.tab-active` (tint + krawędź), a nie wypełnienie `brand-600`:
          wypełnienie akcentem to wygląd przycisku, a zakładka stoi na stronie
          cały czas i w trybie jasnym dominowała nad treścią. */}
      <div
        className="mb-4 flex flex-wrap gap-2"
        role="tablist"
        aria-label="Widoki uprawnień"
      >
        {(
          [
            ['osoby', 'Osoby'],
            ['macierz', 'Macierz uprawnień'],
          ] as const
        ).map(([klucz, etykieta]) => (
          <button
            key={klucz}
            type="button"
            role="tab"
            onClick={() => setZakladka(klucz)}
            aria-selected={zakladka === klucz}
            className={[
              'rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition',
              zakladka === klucz
                ? 'tab-active'
                : 'bg-surface text-fg-muted ring-line-strong hover:bg-page',
            ].join(' ')}
          >
            {etykieta}
          </button>
        ))}
      </div>

      {zakladka === 'osoby' ? <PersonsTab /> : <MatrixTab />}

      {importOtwarty && <ImportPersonsModal onClose={() => setImportOtwarty(false)} />}
      {nowaOsoba && <NewPersonModal onClose={() => setNowaOsoba(false)} />}
    </>
  );
}

/** Katalog osób: kto jest w ewidencji i do ilu aplikacji ma dostęp. */
function PersonsTab() {
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [includeInactive, setIncludeInactive] = useState(true);
  const { data, isLoading, error } = usePersons({ search, department, includeInactive });
  // Licznik z bazy, nie z listy: lista jest przefiltrowana, a pasek ma
  // odpowiadać na pytanie „ile osób w ogóle mamy w katalogu".
  const { data: licznik } = usePersonsCount();
  const podsumowanie = licznik?.count;

  const osoby = data?.persons ?? [];

  return (
    <>
      <div className="card mb-4 flex flex-wrap items-end gap-3 px-4 py-3">
        <TextInput
          label="Szukaj"
          value={search}
          placeholder="nazwisko, imię lub e-mail"
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
        <TextInput
          label="Dział"
          value={department}
          placeholder="np. IT"
          onChange={(e) => setDepartment(e.target.value)}
          className="w-48"
        />
        <Checkbox
          label="Pokaż nieaktywne"
          checked={includeInactive}
          onChange={(e) => setIncludeInactive(e.target.checked)}
        />
        {podsumowanie && (
          <div className="ml-auto pb-1 text-sm text-fg-muted">
            W katalogu:{' '}
            <strong className="text-fg tabular-nums">{podsumowanie.total}</strong>{' '}
            {podsumowanie.total === 1 ? 'osoba' : 'osób'} (
            {podsumowanie.active} aktywnych, {podsumowanie.inactive} nieaktywnych)
          </div>
        )}
      </div>

      <ErrorMessage error={error} className="mb-3" />

      {isLoading && <Spinner label="Wczytuję katalog osób…" />}

      {!isLoading && osoby.length === 0 && (
        <EmptyState
          title="Katalog osób jest pusty"
          description="Dodaj osoby ręcznie przy aplikacji albo zaimportuj plik CSV, np. eksport z Google Workspace."
          icon={undefined}
        />
      )}

      {osoby.length > 0 && (
        <div className="card overflow-hidden">
          <Table className="min-w-[760px]">
            <Thead>
              <tr>
                <Th className="w-[22%]">Imię i nazwisko</Th>
                <Th>Stanowisko</Th>
                <Th>Dział</Th>
                <Th>E-mail</Th>
                <Th>Aplikacje</Th>
                <Th>Stan</Th>
              </tr>
            </Thead>
            <Tbody>
              {osoby.map((osoba) => (
                <tr key={osoba.id} className="table-row-hover">
                  <Td>
                    <Link
                      to={`/uprawnienia/osoby/${osoba.id}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {osoba.firstName} {osoba.lastName}
                    </Link>
                  </Td>
                  <Td className="text-fg-muted">{osoba.position ?? '—'}</Td>
                  <Td className="text-fg-muted">{osoba.department ?? '—'}</Td>
                  <Td className="text-fg-muted">{osoba.email}</Td>
                  <Td className="tabular-nums text-fg-muted">{osoba.accessCount}</Td>
                  <Td>
                    <Badge tone={osoba.isActive ? 'ok' : 'neutral'}>
                      {osoba.isActive ? 'aktywna' : 'nieaktywna'}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}
    </>
  );
}

/**
 * Macierz zbiorcza: osoba × aplikacja × poziom, plus eksport CSV.
 *
 * Filtr aplikacji jest listą rozwijaną zasilaną z rejestru, a nie wolnym
 * tekstem na identyfikator — pytanie brzmi „dostęp do czego", nie „jaki UUID".
 */
function MatrixTab() {
  const [filters, setFilters] = useState<AccessMatrixFilters>({});
  // Import macierzy: okrężny z eksportem — plik raportu wraca do ewidencji.
  const [importMacierzy, setImportMacierzy] = useState(false);
  const { can } = useAuth();
  const edytowac = can('access:write');
  const { data, isLoading, error } = useAccessMatrix(filters);
  // Słownik aplikacji z dedykowanego endpointu: stronicowany rejestr ma
  // `@Max(200)` na limicie, a select prosił o 500 — bierze 400 i zostaje
  // na zawsze pusty. Serwer sam odsiewa usunięte i GENERAL_USE.
  const { data: aplikacje } = useApplicationOptions();

  const rows = data?.rows ?? [];

  return (
    <>
      <div className="card mb-4 flex flex-wrap items-end gap-3 px-4 py-3">
        <Select
          label="Aplikacja"
          value={filters.applicationId ?? ''}
          onChange={(e) =>
            setFilters((f) => ({ ...f, applicationId: e.target.value || undefined }))
          }
        >
          <option value="">wszystkie</option>
          {(aplikacje?.options ?? []).map((aplikacja) => (
            <option key={aplikacja.id} value={aplikacja.id}>
              {aplikacja.name}
            </option>
          ))}
        </Select>
        <TextInput
          label="Dział"
          value={filters.department ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, department: e.target.value }))}
          className="w-48"
        />
        <Select
          label="Poziom dostępu"
          value={filters.level ?? ''}
          onChange={(e) =>
            setFilters((f) => ({
              ...f,
              level: (e.target.value || undefined) as AccessLevel | undefined,
            }))
          }
        >
          <option value="">wszystkie</option>
          {POZIOMY.map((poziom) => (
            <option key={poziom} value={poziom}>
              {ACCESS_LEVEL_LABELS[poziom]}
            </option>
          ))}
        </Select>
        <EksportRaportuButton />
        {/* Import obok eksportu: eksport wręcza się właścicielowi, import
            zwraca jego poprawki z powrotem do ewidencji. */}
        {edytowac && (
          <Button onClick={() => setImportMacierzy(true)}>
            <IconDownload className="size-4" />
            Importuj macierz
          </Button>
        )}
        {edytowac && importMacierzy && (
          <ImportMatrixModal onClose={() => setImportMacierzy(false)} />
        )}
      </div>

      <ErrorMessage error={error} className="mb-3" />

      {isLoading && <Spinner label="Wczytuję macierz…" />}

      {!isLoading && rows.length === 0 && (
        <EmptyState
          title="Brak uprawnień do pokazania"
          description="Zmień filtry albo dodaj osoby przy aplikacji."
          tone="muted"
        />
      )}

      {rows.length > 0 && (
        <div className="card overflow-hidden">
          <Table className="min-w-[900px]">
            <Thead>
              <tr>
                <Th className="w-[20%]">Osoba</Th>
                <Th>Stanowisko</Th>
                <Th>Dział</Th>
                <Th>Aplikacja</Th>
                <Th>Poziom</Th>
                <Th>Nadano</Th>
                <Th>Wygasa</Th>
              </tr>
            </Thead>
            <Tbody>
              {rows.map((wiersz) => (
                <tr key={`${wiersz.application.id}:${wiersz.person.id}`} className="table-row-hover">
                  <Td>
                    <Link
                      to={`/uprawnienia/osoby/${wiersz.person.id}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {wiersz.person.firstName} {wiersz.person.lastName}
                    </Link>
                    {!wiersz.person.isActive && (
                      <Badge tone="neutral" className="ml-2">
                        nieaktywna
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-fg-muted">{wiersz.person.position ?? '—'}</Td>
                  <Td className="text-fg-muted">{wiersz.person.department ?? '—'}</Td>
                  <Td>{wiersz.application.name}</Td>
                  <Td>
                    <Badge tone={wiersz.level === 'OWNER' ? 'violet' : 'neutral'}>
                      {ACCESS_LEVEL_LABELS[wiersz.level]}
                    </Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-fg-muted">
                    {formatDate(wiersz.grantedOn)}
                  </Td>
                  <Td className="whitespace-nowrap text-fg-muted">
                    {wiersz.expiresOn ? formatDate(wiersz.expiresOn) : 'bezterminowo'}
                  </Td>
                </tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}
    </>
  );
}

/**
 * Przycisk serwerowego raportu całej macierzy — dowód przeglądu.
 *
 * Zawsze aktywny: raport obejmuje także aplikacje bez grantów
 * (wiersze „(brak pozycji)"), więc ma sens nawet przy pustym ekranie.
 * Plik i jego nazwa pochodzą z serwera — panel tylko zapisuje treść.
 */
function EksportRaportuButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const pobierz = async () => {
    setBusy(true);
    setError(null);
    try {
      const csv = await downloadAccessExport();
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const adres = URL.createObjectURL(blob);
      const kotwica = document.createElement('a');
      kotwica.href = adres;
      kotwica.download = nazwaPlikuRaportu();
      kotwica.click();
      // Zwolnienie adresu nie natychmiast: w części przeglądarek
      // anuluje pobieranie, które dopiero co wystartowało.
      setTimeout(() => URL.revokeObjectURL(adres), 1000);
    } catch (blad) {
      setError(blad);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Button
        variant="secondary"
        loading={busy}
        onClick={pobierz}
        title="Serwerowy raport całej macierzy — dowód przeglądu"
      >
        <IconDownload className="size-4" />
        Eksport całkowity
      </Button>
      {error instanceof ApiError && (
        <ErrorMessage error={error} className="mt-2" />
      )}
    </div>
  );
}
