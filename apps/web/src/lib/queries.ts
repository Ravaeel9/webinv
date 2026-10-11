import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  api,
  buildQuery,
  extractError,
  ApiError,
} from './api';
import type {
  Application,
  ApplicationFilters,
  ApplicationListResponse,
  AuditListResponse,
  AuditMeta,
  AuthUser,
  DemoModeState,
  Environment,
  SessionInfo,
  Stats,
  UserListItem,
  UserOption,
} from '../types';

/**
 * Klucze zapytań w jednym miejscu — dzięki temu invalidacja
 * po zapisie nie rozjedzie się z faktycznymi kluczami.
 */
export const qk = {
  me: ['me'] as const,
  applications: (filters: ApplicationFilters) =>
    ['applications', filters] as const,
  application: (id: string) => ['application', id] as const,
  stats: ['stats'] as const,
  environments: ['environments'] as const,
  users: ['users'] as const,
  userOptions: ['user-options'] as const,
  ownerOptions: ['owner-options'] as const,
  audit: (params: Record<string, unknown>) => ['audit', params] as const,
  auditMeta: ['audit-meta'] as const,
  sessions: ['sessions'] as const,
  demoMode: ['settings-demo'] as const,
};

// ─── Uwierzytelnienie ─────────────────────────────────────────

export function useMe(): UseQueryResult<{ user: AuthUser }> {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => api.get<{ user: AuthUser }>('/auth/me'),
    // Nie ponawiamy zapytania — 401 oznacza wylogowanie, nie awarię
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.isUnauthorized) return false;
      return failureCount < 2;
    },
    staleTime: 60_000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (credentials: { username: string; password: string }) =>
      api.post<{ user: AuthUser }>('/auth/login', credentials),
    onSuccess: () => {
      // Po zalogowaniu wszystkie wcześniejsze dane są nieaktualne
      queryClient.clear();
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<{ ok: true }>('/auth/logout'),
    onSettled: () => queryClient.clear(),
  });
}

export function useChangePassword() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api.post<{ ok: true }>('/auth/change-password', body),
    onSuccess: () => {
      // Serwer unieważnia wszystkie sesje i wystawia nową,
      // więc odświeżamy stan użytkownika
      void queryClient.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export function useSessions() {
  return useQuery({
    queryKey: qk.sessions,
    queryFn: () => api.get<{ sessions: SessionInfo[] }>('/auth/sessions'),
    staleTime: 30_000,
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<{ ok: true }>('/auth/sessions/revoke', { sessionId }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: qk.sessions }),
  });
}

// ─── Ustawienia: tryb demonstracyjny ──────────────────────────

export function useDemoMode() {
  return useQuery({
    queryKey: qk.demoMode,
    queryFn: () => api.get<DemoModeState>('/settings/demo'),
    staleTime: 10_000,
  });
}

export function useSetDemoMode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (enabled: boolean) =>
      api.put<DemoModeState>('/settings/demo', { enabled }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: qk.demoMode }),
  });
}

/**
 * Kasowanie danych demonstracyjnych.
 *
 * Unieważniamy **całą listę aplikacji i statystyki**, nie tylko stan
 * trybu demo: rekordy znikają z bazy, więc lista, pulpit i liczniki
 * pokazywałyby dane, których już nie ma, dopóki ktoś nie odświeży
 * strony ręcznie.
 */
export function useDeleteDemoData() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.delete<{ deleted: number }>('/settings/demo/data'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.demoMode });
      void queryClient.invalidateQueries({ queryKey: ['applications'] });
      void queryClient.invalidateQueries({ queryKey: qk.stats });
      void queryClient.invalidateQueries({ queryKey: qk.auditMeta });
    },
  });
}

// ─── Aplikacje ────────────────────────────────────────────────

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
 * `includeUsers` steruje zapytaniem o użytkowników: `/users/options`
 * wymaga sesji, a lista aplikacji jest publiczna. Bez tego wyłącznika
 * gość dostawałby 401 przy każdym wejściu na `/aplikacje`.
 */
export function useApplicationFormOptions(includeUsers = true) {
  const environments = useQuery({
    queryKey: qk.environments,
    queryFn: () => api.get<{ environments: Environment[] }>('/applications/environments'),
    staleTime: 5 * 60_000,
  });

  const users = useQuery({
    queryKey: qk.userOptions,
    queryFn: () => api.get<{ users: UserOption[] }>('/users/options'),
    staleTime: 5 * 60_000,
    enabled: includeUsers,
  });

  // Adresy właścicieli do selecta na liście aplikacji. Zdobywamy je
  // z aplikacji, nie z `users` — właściciel nie musi mieć konta.
  const owners = useQuery({
    queryKey: qk.ownerOptions,
    queryFn: () => api.get<{ owners: string[] }>('/applications/owner-options'),
    staleTime: 5 * 60_000,
    enabled: includeUsers,
  });

  return { environments, users, owners };
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

// ─── Dashboard ────────────────────────────────────────────────

export function useStats() {
  return useQuery({
    queryKey: qk.stats,
    queryFn: () => api.get<Stats>('/applications/stats'),
    staleTime: 60_000,
  });
}

// ─── Użytkownicy ──────────────────────────────────────────────

export function useUsers(includeInactive = true) {
  return useQuery({
    queryKey: [...qk.users, includeInactive],
    queryFn: () =>
      api.get<{ users: UserListItem[] }>(
        `/users${buildQuery({ includeInactive })}`,
      ),
    staleTime: 30_000,
  });
}

function useInvalidateUsers() {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: ['users'] });
    void queryClient.invalidateQueries({ queryKey: qk.userOptions });
  };
}

export function useCreateUser() {
  const invalidate = useInvalidateUsers();

  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ user: UserListItem }>('/users', body),
    onSuccess: invalidate,
  });
}

export function useUpdateUser() {
  const invalidate = useInvalidateUsers();

  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      api.patch<{ user: UserListItem }>(`/users/${id}`, body),
    onSuccess: invalidate,
  });
}

export function useDeleteUser() {
  const invalidate = useInvalidateUsers();

  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/users/${id}`),
    onSuccess: invalidate,
  });
}

export function useResetPassword() {
  const invalidate = useInvalidateUsers();

  return useMutation({
    mutationFn: ({ id, newPassword }: { id: string; newPassword: string }) =>
      api.post<{ ok: true }>(`/users/${id}/reset-password`, { newPassword }),
    onSuccess: invalidate,
  });
}

// ─── Audyt ────────────────────────────────────────────────────

export function useAudit(params: Record<string, unknown>) {
  return useQuery({
    queryKey: qk.audit(params),
    queryFn: () => api.get<AuditListResponse>(`/audit${buildQuery(params)}`),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
}

/**
 * Historia jednego rekordu. API filtruje po `entity` + `entityId`,
 * a po stronie klienta dociągamy resztę parametrów.
 */
export function useAuditForEntity(
  entity: string,
  entityId: string | undefined,
  limit = 20,
  enabled = true,
) {
  return useQuery({
    queryKey: qk.audit({ entity, entityId, limit }),
    queryFn: () =>
      api.get<AuditListResponse>(
        `/audit${buildQuery({ entity, entityId, limit })}`,
      ),
    enabled: Boolean(entityId) && enabled,
    staleTime: 15_000,
  });
}

export function useAuditMeta() {
  return useQuery({
    queryKey: qk.auditMeta,
    queryFn: () => api.get<AuditMeta>('/audit/meta'),
    staleTime: 5 * 60_000,
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
