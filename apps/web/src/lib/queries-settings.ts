/**
 * Ustawienia panelu: tryb demo, statystyki pulpitu i integracja GLPI.
 * Klucze są w `queries-keys.ts`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type {
  DemoModeState,
  GlpiImportPayload,
  GlpiImportPreview,
  GlpiImportResult,
  GlpiSettingsInput,
  GlpiSettingsState,
  Stats,
} from '../types';
import { qk } from './queries-keys';

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

// ─── Integracja GLPI ──────────────────────────────────────────

/** Ustawienia GLPI — sekrety nigdy nie wracają, tylko flagi `has*`. */
export function useGlpiSettings() {
  return useQuery({
    queryKey: qk.glpiSettings,
    queryFn: () => api.get<GlpiSettingsState>('/glpi/settings'),
    staleTime: 10_000,
  });
}

export function useSetGlpiSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dane: GlpiSettingsInput) =>
      api.put<GlpiSettingsState>('/glpi/settings', dane),
    onSuccess: (stan) => {
      // Ustawiamy cache z odpowiedzi — sekrety i tak nie wróciły,
      // a flagi `has*` muszą od razu odzwierciedlać stan po zapisie.
      queryClient.setQueryData(qk.glpiSettings, stan);
    },
  });
}

export function useGlpiTest() {
  return useMutation({
    mutationFn: () =>
      api.post<{ ok: true; komunikat: string }>('/glpi/test'),
  });
}

export function useGlpiImportPreview() {
  return useMutation({
    mutationFn: (sections: GlpiImportPayload['sections']) =>
      api.post<GlpiImportPreview>('/glpi/import/preview', { sections }),
  });
}

export function useGlpiImportApply() {
  return useMutation({
    mutationFn: (payload: GlpiImportPayload) =>
      api.post<GlpiImportResult>('/glpi/import/apply', payload),
  });
}

export function useStats() {
  return useQuery({
    queryKey: qk.stats,
    queryFn: () => api.get<Stats>('/applications/stats'),
    staleTime: 60_000,
  });
}

