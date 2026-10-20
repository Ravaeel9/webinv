/**
 * Uwierzytelnienie i sesje — żądania `/auth/*`.
 * Podział `queries.ts` na domeny: tablica obiektów `qk` i helpery
 * inwalidacji żyją w `queries-keys.ts`, a ten plik tylko je konsumuje.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { api, ApiError } from './api';
import type { AuthUser, SessionInfo } from '../types';
import { qk } from './queries-keys';

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

