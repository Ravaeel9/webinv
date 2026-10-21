/**
 * Rejestr aplikacji — zapytania i mutacje `/applications/*`,
 * włącznie z eksportem CSV (idzie fetchem, nie przez `api`).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, buildQuery, extractError } from './api';
import type {
  Application,
  ApplicationFilters,
  ApplicationListResponse,
  Environment,
  Person,
} from '../types';
import { qk } from './queries-keys';

export function useApplications(filters: ApplicationFilters) {
  return useQuery({
    queryKey: qk.applications(filters),
    queryFn: () =>
      api.get<ApplicationListResponse>(`/applications${buildQuery(toApiFilters(filters))}`),
    // Przy zmianie filtra chcemy widzieć poprzednie dania, aż wrócą nowe
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
}

/**
 * Wysyłka filtrów do API.
 *
 * Nazwy parametrów są takie same jak w filtrach interfejsu (`limit`,
 * `offset`), więc nie ma już żadnego mapowania — funkcja została
 * jako jedyne miejsce, w którym czyścimy `undefined`.
 *
 * `Object.fromEntries(Object.entries(...).filter(...))` zamiast `{...filters}`:
 * `JSON.stringify` pomija `undefined`, ale `buildQuery` tego nie robi —
 * bez tego filtrów w adresie byłyby parametry typu `?q=undefined`.
 *
 * Typ `Record<string, unknown>` dostajemy przez `Object.fromEntries`,
 * a nie przez rzutowanie: `ApplicationFilters` to interfejs bez
 * sygnatury indeksowej, więc przypisanie go do `Record` jest błędem
 * typu, nie tylko niedogodnością.
 */
function toApiFilters(filters: ApplicationFilters): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined),
  );
}

export function useApplication(id: string | undefined) {
  return useQuery({
    queryKey: qk.application(id ?? ''),
    queryFn: () => api.get<{ application: Application }>(`/applications/${id}`),
    enabled: Boolean(id),
  });
}

/**
 * Słowniki potrzebne formularzowi oraz filtrom na liście.
 *
 * Katalog osób idzie z formularzem zawsze (formularz jest za `app:write`,
 * więc sesja i tak istnieje); `includeInactive=true`, bo właścicielem albo
 * administratorem może być osoba wisząca po dezaktywacji — pominęłoby jej
 * treść i próbowało cicho zerwać relację.
 *
 * Adresy właścicieli do selecta na liście aplikacji znamy na aplikacji,
 * nie w katalogu — filtr pokazuje tylko realnie występujących.
 */
export function useApplicationFormOptions(includeUsers = true) {
  const environments = useQuery({
    queryKey: qk.environments,
    queryFn: () => api.get<{ environments: Environment[] }>('/applications/environments'),
    staleTime: 5 * 60_000,
  });

  const osoby = useQuery({
    queryKey: [...qk.persons, 'formularz'],
    queryFn: () =>
      api.get<{ persons: Person[] }>(
        `/access/persons${buildQuery({ includeInactive: 'true' })}`,
      ),
    staleTime: 5 * 60_000,
    enabled: includeUsers,
  });

  const owners = useQuery({
    queryKey: qk.ownerOptions,
    queryFn: () =>
      api.get<{ owners: { id: string; fullName: string; email: string }[] }>(
        '/applications/owner-options',
      ),
    staleTime: 5 * 60_000,
    enabled: includeUsers,
  });

  return { environments, osoby, owners };
}

function useInvalidateApplicationData() {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: ['applications'] });
    void queryClient.invalidateQueries({ queryKey: qk.stats });
  };
}

export function useCreateApplication() {
  const invalidate = useInvalidateApplicationData();

  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ application: Application }>('/applications', body),
    onSuccess: invalidate,
  });
}

export function useUpdateApplication(id: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateApplicationData();

  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch<{ application: Application }>(`/applications/${id}`, body),
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: qk.application(id) });
    },
  });
}

export function useDeleteApplication() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateApplicationData();

  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/applications/${id}`),
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['application'] });
    },
  });
}

export function useRestoreApplication() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateApplicationData();

  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ application: Application }>(`/applications/${id}/restore`),
    onSuccess: () => {
      invalidate();
      // Klucz pojedynczej aplikacji to `['application', id]`, a
      // `invalidate()` unieważnia tylko `['applications']`. Bez tego
      // karta po przywróceniu dalej pokazywała banner „usunięta" —
      // refetch wymuszają dopiero upływ `staleTime`.
      void queryClient.invalidateQueries({ queryKey: ['application'] });
    },
  });
}

/**
 * Eksport CSV. Nie idzie przez `api`, bo to odpowiedź binarna/tekstowa
 * z nagłówkiem Content-Disposition, a nie JSON — osobna ścieżka
 * pozwala też podejrzeć błąd tak samo jak w reszcie.
 */
export async function downloadApplicationsCsv(
  filters: ApplicationFilters,
): Promise<string> {
  const { limit, offset, ...rest } = filters;
  const query = buildQuery({
    ...rest,
    limit: limit ?? 10_000,
    offset: offset ?? 0,
  });

  const response = await fetch(`/api/applications/export${query}`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw await extractError(response);
  }

  return response.text();
}

