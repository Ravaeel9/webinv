/**
 * Konta użytkowników panelu — `/users/*`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, buildQuery } from './api';
import type { UserListItem } from '../types';
import { qk } from './queries-keys';

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

