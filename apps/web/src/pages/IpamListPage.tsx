import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  useDeleteAddress,
  useSubnets,
  useSubnetAddresses,
  useUpdateAddress,
} from '../lib/queries';
import { liczba } from '../lib/format';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/layout/AppLayout';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState, ErrorMessage, Spinner } from '../components/ui/Feedback';
import { Th } from '../components/ui/Table';
import { IconChevronRight, IconNetwork, IconPlus } from '../components/ui/icons';
import { AddressDeleteModal } from '../components/ipam/AddressDeleteModal';
import { AddressEditModal } from '../components/ipam/AddressEditModal';
import { AddressTable } from '../components/ipam/AddressTable';
import { SUBNET_COLORS, type IpAddress, type SubnetWithCounts } from '../types';

/**
 * Katalog podsieci — lista z rozwijanymi adresami.
 *
 * Wiersz ma dwa niezależne wejścia: kliknięcie wiersza rozwija go
 * w miejscu (drill-down, bez nawigacji — chcesz porównać adresy
 * kilku podsieci obok siebie), a nazwa i przycisk „Szczegóły” prowadzą
 * do pełnej karty podsieci.
 */
export function IpamListPage() {
  const { can } = useAuth();
  const { data, isLoading, error, refetch } = useSubnets();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const subnets = data?.subnets ?? [];

  // Trzy liczniki z **tej samej** listy, co tabela. Osobne zapytanie
  // o statystyki rozjechałoby się z wierszami w trakcie ładowania
  // i po każdej zmianie, dopóki jedno z dwóch zapytań nie wróci.
  const counts = useMemo(
    () => ({
      subnets: subnets.length,
      addresses: subnets.reduce((sum, s) => sum + s.addressCount, 0),
      free: subnets.reduce((sum, s) => sum + s.freeCount, 0),
    }),
    [subnets],
  );

  return (
    <>
      <PageHeader
        title="Adresy IP"
        description={
          // Przy błędzie liczniki liczone z pustej listy („0 podsieci ·
          // 0 adresów") wyglądałyby jak fakty obok banera błędu — chowamy je.
          isLoading || error
            ? undefined
            : `${liczba(counts.subnets, 'podsieć', 'podsieci', 'podsieci')} · ` +
              `${liczba(counts.addresses, 'adres', 'adresy', 'adresów')}, ` +
              `w tym ${liczba(counts.free, 'wolny', 'wolne', 'wolnych')}`
        }
        actions={
          can('ipam:write') && (
            <div className="flex items-center gap-2">
              <Link to="/ipam/import">
                <Button variant="secondary">Importuj z nmap</Button>
              </Link>
              <Link to="/ipam/nowa">
                <Button>
                  <IconPlus className="size-4" />
                  Dodaj podsieć
                </Button>
              </Link>
            </div>
          )
        }
      />

      <ErrorMessage error={error} onRetry={() => refetch()} className="mb-4" />

      <div className="card overflow-hidden">
        {isLoading ? (
          <Spinner label="Ładowanie katalogu podsieci…" />
        ) : subnets.length === 0 ? (
          <EmptyState
            title="Katalog podsieci jest pusty"
            description="Dodaj pierwszą podsieć, żeby zacząć rejestrować adresy IP."
            action={
              can('ipam:write') && (
                <Link to="/ipam/nowa">
                  <Button>
                    <IconPlus className="size-4" />
                    Dodaj podsieć
                  </Button>
                </Link>
              )
            }
          />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-line-strong bg-surface-2">
                <tr>
                  <Th className="w-8">
                    <span className="sr-only">Rozwiń</span>
                  </Th>
                  <Th className="w-[24%]">Nazwa</Th>
                  <Th>Zakres</Th>
                  <Th className="w-24">VLAN</Th>
                  <Th className="w-48">Adresy</Th>
                  <Th className="w-40">Aplikacje</Th>
                  <Th className="w-20">
                    <span className="sr-only">Szczegóły</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {subnets.map((subnet) => (
                  <SubnetRow
                    key={subnet.id}
                    subnet={subnet}
                    expanded={expandedId === subnet.id}
                    onToggle={() =>
                      setExpandedId((prev) => (prev === subnet.id ? null : subnet.id))
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function SubnetRow({
  subnet,
  expanded,
  onToggle,
}: {
  subnet: SubnetWithCounts;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { can } = useAuth();
  // Zapytanie o adresy leci tylko dla rozwiniętego wiersza — dzięki
  // `enabled` w haku nie odpytujemy API o katalog, którego nikt nie otworzył.
  const { data, isLoading } = useSubnetAddresses(expanded ? subnet.id : undefined);
  const addresses = data?.addresses ?? [];

  const remove = useDeleteAddress();
  const [doUsuniecia, setDoUsuniecia] = useState<IpAddress | null>(null);
  const update = useUpdateAddress();
  const [doEdycji, setDoEdycji] = useState<IpAddress | null>(null);

  const zajete = subnet.addressCount - subnet.freeCount;
  const color = SUBNET_COLORS[subnet.color] ?? SUBNET_COLORS.slate!;

  return (
    <>
      <tr className="cursor-pointer align-middle transition-colors hover:bg-surface-2/70" onClick={onToggle}>
        <td className="px-2 py-2.5">
          {/* Prawdziwy przycisk, nie sam klik w wiersz: klawiatura i czytniki
              ekranu dostają stan (`aria-expanded`) i wskazanie rozwijanego
              rejonu (`aria-controls`); klik wiersza zostaje dla myszy. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-expanded={expanded}
            aria-controls={`adresy-${subnet.id}`}
            aria-label={
              expanded
                ? `Ukryj adresy podsieci ${subnet.name}`
                : `Pokaż adresy podsieci ${subnet.name}`
            }
            className="flex size-6 items-center justify-center rounded-md text-fg-subtle hover:bg-page"
          >
            <IconChevronRight
              className={`size-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
          </button>
        </td>

        <td className="px-4 py-2.5">
          <span
            className="mr-2 inline-block size-2.5 shrink-0 rounded-full align-middle"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
          <span className="font-medium text-fg">{subnet.name}</span>
          {subnet.location && (
            <span className="ml-2 meta-text">{subnet.location}</span>
          )}
        </td>

        <td className="px-4 py-2.5 font-mono text-fg-muted">{subnet.cidr}</td>

        <td className="px-4 py-2.5 tabular-nums text-fg-muted">
          {subnet.vlan ?? <span className="text-fg-subtle">—</span>}
        </td>

        <td className="px-4 py-2.5">
          <span className="tabular-nums text-fg">{liczba(zajete, 'zajęty', 'zajęte', 'zajętych')}</span>
          <span className="mx-1 text-fg-subtle">/</span>
          <span className="tabular-nums text-fg-muted">{liczba(subnet.addressCount, 'adres', 'adresy', 'adresów')}</span>
          {subnet.freeCount > 0 && (
            <Badge tone="neutral" dot={false} className="ml-2 text-[11px]">
              {liczba(subnet.freeCount, 'wolny', 'wolne', 'wolnych')}
            </Badge>
          )}
        </td>

        <td className="px-4 py-2.5">
          {subnet.applicationCount > 0 ? (
            <Badge tone="info" dot={false}>
              {liczba(subnet.applicationCount, 'aplikacja', 'aplikacje', 'aplikacji')}
            </Badge>
          ) : (
            <span className="meta-text">brak przypisań</span>
          )}
        </td>

        <td className="px-4 py-2.5 text-right">
          {/* Link osobno od kliknięcia wiersza — inaczej każde wejście
              do karty podsieci rozwijałoby wiersz i od razu go zwijało. */}
          <Link
            to={`/ipam/${subnet.id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            Szczegóły
          </Link>
        </td>
      </tr>

      {expanded && (
        <tr id={`adresy-${subnet.id}`}>
          <td colSpan={7} className="bg-page px-4 py-3">
            {isLoading ? (
              <Spinner label="Ładowanie adresów…" />
            ) : (
              <div className="card overflow-hidden">
                <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                  <IconNetwork className="size-4 text-fg-subtle" />
                  <span className="text-sm font-medium text-fg">
                    Adresy podsieci {subnet.name}
                  </span>
                  <span className="meta-text">{subnet.cidr}</span>
                  <Link
                    to={`/ipam/${subnet.id}`}
                    className="ml-auto text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                  >
                    Otwórz kartę podsieci
                  </Link>
                </div>

                <AddressTable
                  addresses={addresses}
                  // Gość nie edytuje i nie usuwa, więc nie dostaje kolumny akcji.
                  onEdit={can('ipam:write') ? (a) => setDoEdycji(a) : undefined}
                  onDelete={can('ipam:write') ? (a) => setDoUsuniecia(a) : undefined}
                  busyId={remove.isPending ? (doUsuniecia?.id ?? null) : null}
                />
              </div>
            )}
          </td>
        </tr>
      )}

      <AddressDeleteModal
        address={doUsuniecia}
        subnetName={subnet.name}
        pending={remove.isPending}
        error={remove.error}
        // `reset()` w domykaniu: bez niego powtórne otwarcie pokazuje
        // błąd poprzedniej próby, którego już dawno nie ma.
        onClose={() => {
          setDoUsuniecia(null);
          remove.reset();
        }}
        onConfirm={async () => {
          if (!doUsuniecia) return;
          await remove.mutateAsync(doUsuniecia.id);
          setDoUsuniecia(null);
        }}
      />

      <AddressEditModal
        address={doEdycji}
        subnetName={`${subnet.name} (${subnet.cidr})`}
        pending={update.isPending}
        error={update.error}
        onClose={() => {
          setDoEdycji(null);
          update.reset();
        }}
        onConfirm={async (payload) => {
          if (!doEdycji) return;
          await update.mutateAsync({ id: doEdycji.id, ...payload });
          setDoEdycji(null);
        }}
      />
    </>
  );
}
