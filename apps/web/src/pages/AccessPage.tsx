import { useState } from 'react';
import { Link } from 'react-router';
import { useAccessMatrix, usePersons } from '../lib/queries';
import { accessMatrixCsv } from '../lib/queries';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/layout/AppLayout';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Checkbox, Select, TextInput } from '../components/ui/Field';
import { EmptyState, ErrorMessage, Spinner } from '../components/ui/Feedback';
import { Th } from '../components/ui/Table';
import { IconDownload, IconPlus } from '../components/ui/icons';
import { formatDate } from '../lib/format';
import { ImportPersonsModal } from '../components/access/ImportPersonsModal';
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

      <div className="mb-4 flex gap-1 rounded-lg bg-surface-2 p-1">
        {(
          [
            ['osoby', 'Osoby'],
            ['macierz', 'Macierz uprawnień'],
          ] as const
        ).map(([klucz, etykieta]) => (
          <button
            key={klucz}
            type="button"
            onClick={() => setZakladka(klucz)}
            aria-pressed={zakladka === klucz}
            className={[
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              zakladka === klucz ? 'bg-surface text-fg' : 'text-fg-muted hover:text-fg',
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
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <Th>Imię i nazwisko</Th>
                <Th>Stanowisko</Th>
                <Th>Dział</Th>
                <Th>E-mail</Th>
                <Th>Aplikacje</Th>
                <Th>Stan</Th>
              </tr>
            </thead>
            <tbody>
              {osoby.map((osoba) => (
                <tr key={osoba.id}>
                  <td className="py-2 pr-3">
                    <Link
                      to={`/uprawnienia/osoby/${osoba.id}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {osoba.firstName} {osoba.lastName}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-fg-muted">{osoba.position ?? '—'}</td>
                  <td className="py-2 pr-3 text-fg-muted">{osoba.department ?? '—'}</td>
                  <td className="py-2 pr-3 text-fg-muted">{osoba.email}</td>
                  <td className="py-2 pr-3 text-fg-muted">{osoba.accessCount}</td>
                  <td className="py-2">
                    <Badge tone={osoba.isActive ? 'ok' : 'neutral'}>
                      {osoba.isActive ? 'aktywna' : 'nieaktywna'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Macierz zbiorcza: osoba × aplikacja × poziom, plus eksport CSV. */
function MatrixTab() {
  const [filters, setFilters] = useState<AccessMatrixFilters>({});
  const { data, isLoading, error } = useAccessMatrix(filters);

  const rows = data?.rows ?? [];

  const eksportuj = () => {
    const csv = accessMatrixCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const adres = URL.createObjectURL(blob);
    const kotwica = document.createElement('a');
    kotwica.href = adres;
    kotwica.download = `uprawnienia-${dzis()}.csv`;
    kotwica.click();
    // Adres obiektu trzymamy w pamięci przeglądarki, więc trzeba go zwolnić
    // po kliknięciu — inaczej plik zostaje w pamięci do odświeżenia strony.
    URL.revokeObjectURL(adres);
  };

  return (
    <>
      <div className="card mb-4 flex flex-wrap items-end gap-3 px-4 py-3">
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
        <Button variant="secondary" onClick={eksportuj} disabled={rows.length === 0}>
          <IconDownload className="size-4" />
          Eksportuj CSV
        </Button>
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
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <Th>Osoba</Th>
                <Th>Stanowisko</Th>
                <Th>Dział</Th>
                <Th>Aplikacja</Th>
                <Th>Poziom</Th>
                <Th>Nadano</Th>
                <Th>Wygasa</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((wiersz) => (
                <tr key={`${wiersz.application.id}:${wiersz.person.id}`}>
                  <td className="py-2 pr-3">
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
                  </td>
                  <td className="py-2 pr-3 text-fg-muted">{wiersz.person.position ?? '—'}</td>
                  <td className="py-2 pr-3 text-fg-muted">{wiersz.person.department ?? '—'}</td>
                  <td className="py-2 pr-3">{wiersz.application.name}</td>
                  <td className="py-2 pr-3">
                    <Badge tone={wiersz.level === 'OWNER' ? 'violet' : 'neutral'}>
                      {ACCESS_LEVEL_LABELS[wiersz.level]}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3 text-fg-muted">{formatDate(wiersz.grantedOn)}</td>
                  <td className="py-2 text-fg-muted">
                    {wiersz.expiresOn ? formatDate(wiersz.expiresOn) : 'bezterminowo'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Data w nazwie pliku — `RRRR-MM-DD`. */
function dzis(): string {
  return new Date().toISOString().slice(0, 10);
}