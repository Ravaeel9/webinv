import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Th } from '../ui/Table';
import { IconTrash } from '../ui/icons';
import { formatDateTime } from '../../lib/format';
import { IP_STATUS_LABELS, IP_STATUS_TONES, type IpAddress } from '../../types';

/**
 * Wiersz tabeli adresów — `IpAddress` plus opcjonalne dane podsieci.
 *
 * `subnet` jest dokładane przez rodzica, nie przez API: samo
 * `IpAddress` niesie tylko `subnetId`, a nazwa i zakres trafiają do
 * kolumny tylko wtedy, gdy tabela nie stoi w kontekście jednej
 * podsieci (czyli wtedy, gdy `showSubnet` jest włączone).
 */
export interface AddressRow extends IpAddress {
  subnet?: { id: string; name: string; cidr: string };
}

/**
 * Tabela adresów IP — wspólna dla katalogu (drill-down w wierszu
 * podsieci) i karty podsieci.
 *
 * Komponent nie wie, skąd przychodzą adresy ani kto może zapisywać.
 * Jedyne co mówi mu o uprawnieniach, to **brak `onDelete`**: wołający
 * przekazuje go tylko przy `can('ipam:write')`, a gość wtedy dostaje
 * tę samą tabelę bez kolumny akcji. Dzięki temu nie ma dwóch wersji
 * komponentu, które trzeba utrzymywać równolegle.
 *
 * Kolumny: adres, podsieć (opcjonalnie), status, opis, ostatni skan.
 * **Brakuje tu kolumny „przypisane aplikacje"** — świadomie: adres
 * zwracany przez API nie niesie listy przypisań, a pobranie jej
 * osobnym zapytaniem na każdy wiersz to jedna prośba o HTTP na adres.
 * Kto do jakiej aplikacji jest przypisany, widać na karcie aplikacji.
 */
export function AddressTable({
  addresses,
  onDelete,
  showSubnet = false,
  busyId,
}: {
  addresses: AddressRow[];
  /** Brak = brak akcji (VIEWER). */
  onDelete?: (address: IpAddress) => void;
  showSubnet?: boolean;
  /** Adres w trakcie usuwania — jego przycisk pokazuje wtedy „usuwanie”. */
  busyId?: string | null;
}) {
  return (
    <div className="scroll-thin overflow-x-auto">
      {/*
        Pustej tabeli nie rysujemy w ogóle. Nagłówek bez wierszy wygląda
        jak błąd wczytywania, a stan pusty ma własny komunikat — i tak
        oba miejsca użycia (drill-down i karta podsieci) pokazują go
        swoim `EmptyState`, więc ta linia jest zabezpieczeniem dla
        rodzica, który poda pustą listę.
      */}
      {addresses.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-fg-muted">
          Brak adresów.
        </p>
      ) : (
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-line bg-page">
            <tr>
              <Th>Adres</Th>
              {showSubnet && <Th>Podsieć</Th>}
              <Th>Status</Th>
              <Th>Opis</Th>
              <Th className="w-44">Ostatni skan</Th>
              {onDelete && (
                <Th className="w-16">
                  <span className="sr-only">Akcje</span>
                </Th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {addresses.map((address) => (
              <tr key={address.id} className="hover:bg-page">
                <td className="px-4 py-2.5 font-mono text-fg">{address.address}</td>

                {showSubnet && (
                  <td className="px-4 py-2.5 text-fg-muted">
                    {address.subnet?.name ?? '—'}
                  </td>
                )}

                <td className="px-4 py-2.5">
                  <Badge tone={IP_STATUS_TONES[address.status]}>
                    {IP_STATUS_LABELS[address.status]}
                  </Badge>
                </td>

                <td className="px-4 py-2.5 text-fg-muted">
                  {address.description ?? <span className="text-fg-subtle">—</span>}
                </td>

                <td className="px-4 py-2.5 meta-text">
                  {address.lastSeenAt
                    ? formatDateTime(address.lastSeenAt)
                    : 'nie skanowany'}
                </td>

                {onDelete && (
                  <td className="px-4 py-2.5 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={busyId === address.id}
                      onClick={() => onDelete(address)}
                      aria-label={`Usuń adres ${address.address}`}
                      title="Usuń adres"
                    >
                      <IconTrash className="size-4" />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
