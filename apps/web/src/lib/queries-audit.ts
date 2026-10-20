/**
 * Dziennik zdarzeń — `/audit/*`.
 */
import { useQuery } from '@tanstack/react-query';
import { api, buildQuery } from './api';
import type { AuditListResponse, AuditMeta } from '../types';
import { qk } from './queries-keys';

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

