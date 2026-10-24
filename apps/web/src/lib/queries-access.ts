/**
 * Macierz uprawnień do aplikacji i katalog osób — `/access/*`.
 * Klucze są w `queries-keys.ts`; prefiks `['access']` załatwia
 * unieważnienie trzech widoków naraz.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, buildQuery, extractError } from './api';
import {
  type AccessLevel,
  type AccessMatrixFilters,
  type AccessMatrixRow,
  type ApplicationGrant,
  type HeaderMapping,
  type MatrixImportPreview,
  type MatrixImportResult,
  type Person,
  type PersonFilters,
  type PersonsCount,
  type PersonsImportPreview,
  type PersonsImportResult,
} from '../types';
import { qk } from './queries-keys';

export function usePersons(filters: PersonFilters = {}) {
  return useQuery({
    queryKey: [...qk.persons, filters],
    queryFn: () =>
      api.get<{ persons: Person[] }>(
        `/access/persons${buildQuery({
          search: filters.search,
          department: filters.department,
          includeInactive: filters.includeInactive === false ? 'false' : undefined,
          sort: filters.sort,
        })}`,
      ),
    staleTime: 30_000,
  });
}

export function usePersonsCount() {
  return useQuery({
    queryKey: qk.personsCount,
    queryFn: () => api.get<{ count: PersonsCount }>('/access/persons/count'),
    staleTime: 30_000,
  });
}

export function usePersonGrants(personId: string) {
  return useQuery({
    queryKey: qk.person(personId),
    queryFn: () =>
      api.get<{ person: Person; grants: AccessMatrixRow[] }>(`/access/persons/${personId}`),
    enabled: Boolean(personId),
  });
}

export function useApplicationAccess(applicationId: string) {
  return useQuery({
    queryKey: qk.applicationAccess(applicationId),
    queryFn: () =>
      api.get<{ grants: ApplicationGrant[] }>(`/access/applications/${applicationId}`),
    enabled: Boolean(applicationId),
  });
}

export function useAccessMatrix(filters: AccessMatrixFilters = {}) {
  return useQuery({
    queryKey: [...qk.accessMatrix, filters],
    queryFn: () => api.get<{ rows: AccessMatrixRow[] }>(
        `/access/matrix${buildQuery({ ...filters })}`,
      ),
    staleTime: 30_000,
  });
}

/** Po każdej zmianie macierzy odświeżamy trzy miejsca naraz. */
function useAccessInvalidate() {
  const queryClient = useQueryClient();
  return (applicationId?: string, personId?: string) => {
    void queryClient.invalidateQueries({ queryKey: ['access'] });
    if (personId) void queryClient.invalidateQueries({ queryKey: qk.person(personId) });
    if (applicationId) {
      void queryClient.invalidateQueries({ queryKey: qk.applicationAccess(applicationId) });
    }
  };
}

export function useGrantAccess() {
  const invalidate = useAccessInvalidate();
  return useMutation({
    mutationFn: ({ applicationId, ...body }: { applicationId: string; [key: string]: unknown }) =>
      api.post<{ grant: ApplicationGrant }>(`/access/applications/${applicationId}`, body),
    onSuccess: (_wynik, wejscie) => invalidate(wejscie.applicationId),
  });
}

export function useUpdateGrant() {
  const invalidate = useAccessInvalidate();
  return useMutation({
    mutationFn: (wejscie: {
      applicationId: string;
      personId: string;
      level?: AccessLevel;
      expiresOn?: string | null;
      note?: string | null;
    }) =>
      api.patch<{ grant: ApplicationGrant }>(
        `/access/applications/${wejscie.applicationId}/${wejscie.personId}`,
        wejscie,
      ),
    onSuccess: (_wynik, wejscie) => invalidate(wejscie.applicationId, wejscie.personId),
  });
}

export function useRevokeGrant() {
  const invalidate = useAccessInvalidate();
  return useMutation({
    mutationFn: (wejscie: { applicationId: string; personId: string }) =>
      api.delete<{ ok: true }>(
        `/access/applications/${wejscie.applicationId}/${wejscie.personId}`,
      ),
    onSuccess: (_wynik, wejscie) => invalidate(wejscie.applicationId, wejscie.personId),
  });
}

export function useCreatePerson() {
  const invalidate = useAccessInvalidate();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ person: Person }>('/access/persons', body),
    onSuccess: () => invalidate(),
  });
}

export function useUpdatePerson() {
  const invalidate = useAccessInvalidate();
  return useMutation({
    mutationFn: (wejscie: { id: string } & Record<string, unknown>) =>
      api.patch<{ person: Person }>(`/access/persons/${wejscie.id}`, wejscie),
    onSuccess: (_wynik, wejscie) => invalidate(undefined, wejscie.id),
  });
}

export function useDeactivatePerson() {
  const invalidate = useAccessInvalidate();
  // Dezaktywacja idzie PATCH-em (`isActive: false`): DELETE osób to już
  // twarde usunięcie, które zabiera przypisania razem z osobą.
  return useMutation({
    mutationFn: (id: string) =>
      api.patch<{ person: Person }>(`/access/persons/${id}`, { isActive: false }),
    onSuccess: (_wynik, id) => invalidate(undefined, id),
  });
}

/**
 * Twarde usunięcie osoby — tylko dla błędnie wprowadzonych wpisów.
 * Razem z osobą kasują się jej przypisania w macierzach (kaskada
 * w bazie), więc unikalny adres e-mail znowu można użyć przy tworzeniu.
 */
export function useDeletePerson() {
  const invalidate = useAccessInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/access/persons/${id}`),
    onSuccess: () => invalidate(),
  });
}

export function usePreviewPersonsImport() {
  return useMutation({
    mutationFn: (body: { csv: string; mapping?: HeaderMapping }) =>
      api.post<PersonsImportPreview>('/access/import/preview', body),
  });
}

export function useApplyPersonsImport() {
  const invalidate = useAccessInvalidate();
  return useMutation({
    mutationFn: (rows: Record<string, unknown>[]) =>
      api.post<PersonsImportResult>('/access/import/apply', { rows }),
    onSuccess: () => invalidate(),
  });
}

/** Podgląd importu macierzy — plik w formacie eksportu, nic nie zapisuje. */
export function useMatrixImportPreview() {
  return useMutation({
    mutationFn: (body: { csv: string; applicationId?: string }) =>
      api.post<MatrixImportPreview>('/access/import/matrix/preview', body),
  });
}

/** Zapis importu macierzy (upsert grantów) — odświeża macierz po sukcesie. */
export function useMatrixImportApply() {
  const invalidate = useAccessInvalidate();
  return useMutation({
    mutationFn: (body: { rows: Record<string, unknown>[]; applicationId?: string }) =>
      api.post<MatrixImportResult>('/access/import/matrix/apply', body),
    onSuccess: () => invalidate(),
  });
}

/**
 * Raport macierzy uprawnień — pobranie CSV z serwera.
 *
 * Nie idzie przez `api`, bo to odpowiedź tekstowa z nagłówkiem
 * Content-Disposition, nie JSON — tak samo jak eksport rejestru
 * (`downloadApplicationsCsv`). Raport buduje serwer: ma pełne metadane
 * aplikacji (status, klasyfikacja, krytyczność, właściciel), wiersze
 * „(brak pozycji)" dla pustych macierzy i datę wygenerowania w pliku,
 * więc lokalne składanie CSV z wierszy ekranu tylko zubałoby raport.
 */
export async function downloadAccessExport(
  applicationId?: string,
): Promise<string> {
  const sciezka = applicationId
    ? `/access/applications/${applicationId}/export`
    : '/access/matrix/export';

  const response = await fetch(`/api${sciezka}`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw await extractError(response);
  }

  return response.text();
}

/** Mapowanie polskich liter do sluga — `ł` nie rozwija się przy NFD. */
const POLSKIE_LITERY: Record<string, string> = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ź: 'z',
  ż: 'z',
};

/**
 * Nazwa pliku raportu: pełny `macierz-uprawnien-RRRR-MM-DD.csv`,
 * dla jednej aplikacji `raport-uprawnien-<slug>-RRRR-MM-DD.csv`.
 * Slug liczymy tak samo jak na serwerze, bo pobieranie i tak idzie
 * przez blob w przeglądarce.
 */
export function nazwaPlikuRaportu(nazwaAplikacji?: string): string {
  const dzisiaj = new Date().toISOString().slice(0, 10);
  if (!nazwaAplikacji) return `macierz-uprawnien-${dzisiaj}.csv`;
  const slug =
    nazwaAplikacji
      .toLowerCase()
      .replace(/[ąćęłńóśźż]/g, (znak) => POLSKIE_LITERY[znak] ?? znak)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'aplikacja';
  return `raport-uprawnien-${slug}-${dzisiaj}.csv`;
}
