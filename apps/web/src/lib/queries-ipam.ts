/**
 * IPAM — podsieci, adresy, przypisania aplikacji i import z XML.
 * Klucze są w `queries-keys.ts`; unieważnienia używają prefiksu
 * `['ipam']`, bo wiersze się kaskadowo spinały.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type {
  ApplicationIpAddressRef,
  ImportPreview,
  ImportSelection,
  IpAddress,
  Subnet,
  SubnetDetail,
  SubnetWithCounts,
} from '../types';
import { qk } from './queries-keys';

export function useSubnets() {
  return useQuery({
    queryKey: qk.subnets,
    queryFn: () =>
      api.get<{ subnets: SubnetWithCounts[]; total: number }>('/ipam/subnets'),
    staleTime: 30_000,
  });
}

export function useSubnet(id: string | undefined) {
  return useQuery({
    queryKey: qk.subnet(id ?? ''),
    queryFn: () => api.get<{ subnet: SubnetDetail }>(`/ipam/subnets/${id}`),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useSubnetAddresses(subnetId: string | undefined) {
  return useQuery({
    queryKey: qk.subnetAddresses(subnetId ?? ''),
    queryFn: () =>
      api.get<{ addresses: IpAddress[]; total: number }>(
        `/ipam/subnets/${subnetId}/addresses`,
      ),
    enabled: Boolean(subnetId),
    staleTime: 30_000,
  });
}

export function useCreateSubnet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ subnet: Subnet }>('/ipam/subnets', body),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: qk.subnets }),
  });
}

export function useUpdateSubnet(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch<{ subnet: Subnet }>(`/ipam/subnets/${id}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.subnets });
      void queryClient.invalidateQueries({ queryKey: qk.subnet(id) });
    },
  });
}

/**
 * Kasowanie podsieci jest kaskadowe: giną jej adresy, a wraz z nimi
 * przypisania aplikacji i ich statusy. Nie znamy z góry, które klucze
 * `ipam` dotyczy, więc unieważniamy cały prefiks.
 */
export function useDeleteSubnet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ ok: true }>(`/ipam/subnets/${id}`),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['ipam'] }),
  });
}

export function useCreateAddress(subnetId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ address: IpAddress }>(
        `/ipam/subnets/${subnetId}/addresses`,
        body,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: qk.subnetAddresses(subnetId),
      });
      // Nowy adres zmienia liczniki podsieci (również w liście katalogu),
      // a nie samą listę adresów.
      void queryClient.invalidateQueries({ queryKey: qk.subnet(subnetId) });
      void queryClient.invalidateQueries({ queryKey: qk.subnets });
    },
  });
}

/**
 * Zmiana statusu adresu przesuwa liczniki podsieci, więc klucza listy
 * adresów nie da się wyliczyć z samego identyfikatora — pobieramy cały
 * prefiks `ipam`.
 */
export function useUpdateAddress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      api.patch<{ address: IpAddress }>(`/ipam/addresses/${id}`, body),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['ipam'] }),
  });
}

/** Jak wyżej: kasowanie adresu zdejmuje jego przypisania aplikacji. */
export function useDeleteAddress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ ok: true }>(`/ipam/addresses/${id}`),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['ipam'] }),
  });
}

export function useApplicationIpAddresses(appId: string | undefined) {
  return useQuery({
    queryKey: qk.applicationIpAddresses(appId ?? ''),
    queryFn: () =>
      api.get<{ addresses: ApplicationIpAddressRef[] }>(
        `/ipam/applications/${appId}/ip-addresses`,
      ),
    enabled: Boolean(appId),
    staleTime: 30_000,
  });
}

/**
 * Zestaw przypisań jest pełną listą, nie patchem, więc zapis obejmuje
 * również zdejmowanie starych. Serwer NIE przestawia tu statusów adresów
 * — `setApplicationIpAddresses` to sama wymiana zbioru wierszy relacji;
 * statusy zmieniają CRUD adresu (`PATCH /ipam/addresses/:id`) i automat
 * zwalniający je przy soft delete aplikacji. Unieważniamy katalog IPAM
 * (licznik `applicationCount`) i kartę aplikacji — zmieniła się jej
 * sekcja z adresami.
 */
export function useSetApplicationIpAddresses(appId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ipAddressIds: string[]) =>
      api.put<{ ok: true }>(`/ipam/applications/${appId}/ip-addresses`, {
        ipAddressIds,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ipam'] });
      void queryClient.invalidateQueries({ queryKey: qk.application(appId) });
    },
  });
}

export function useImportPreview() {
  return useMutation({
    mutationKey: qk.importPreview,
    mutationFn: (xml: string) =>
      api.post<ImportPreview>('/ipam/import/preview', { xml }),
  });
}

export function useApplyImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: qk.importApply,
    mutationFn: (selections: ImportSelection[]) =>
      api.post<{ imported: number }>('/ipam/import/apply', { selections }),
    onSuccess: (_data, selections) => {
      void queryClient.invalidateQueries({ queryKey: qk.subnets });
      const subnetIds = new Set(selections.map((s) => s.subnetId));
      for (const subnetId of subnetIds) {
        void queryClient.invalidateQueries({
          queryKey: qk.subnetAddresses(subnetId),
        });
        void queryClient.invalidateQueries({
          queryKey: qk.subnet(subnetId),
        });
      }
      void queryClient.invalidateQueries({ queryKey: ['ipam'] });
    },
  });
}

