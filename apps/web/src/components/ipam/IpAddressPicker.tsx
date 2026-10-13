import { useState } from 'react';
import { useSubnetAddresses, useSubnets } from '../../lib/queries';
import { Badge } from '../ui/Badge';
import { IconChevronRight, IconSearch } from '../ui/icons';
import {
  IP_STATUS_LABELS,
  IP_STATUS_TONES,
  SUBNET_COLORS,
  type SubnetWithCounts,
} from '../../types';

/**
 * Wyszukiwarka adresów IP dla formularza aplikacji — grupa na podsieć,
 * checkbox na adres.
 *
 * Propsy są sterowane: komponent nie wie nic o zapisie, tylko zgłasza
 * rodzicowi nową listę identyfikatorów. Rodzic decyduje, kiedy leci
 * `PUT` — dzięki temu przypisania można dołożyć po udanym zapisie
 * aplikacji, a nie w tym samym żądaniu, którego walidator i tak by
 * nie przyjął (klucz obcy: aplikacja musi istnieć, zanim cokolwiek
 * zostanie do niej przypisane).
 *
 * Strategia ładowania: przy montowaniu idzie **jedno** żądanie po listę
 * podsieci, a adresy pobierane są osobno — i to tylko dla podsieci
 * otwartych. Katalog ma urość z miesiącami, a formularz nie może go
 * wczytać z góry każdy-każdej podsieci dla każdego `SELF_HOSTED`.
 * Wyjątek jest jeden i celowy: **aktywne wyszukiwanie otwiera wszystkie
 * grupy**. Wyszukiwarka po adresie i opisie może rzetelnie filtrować
 * tylko załadowane dane — pokazywanie wyników „tylko z rozwiniętych
 * podsieci" byłoby udawaniem, że szukanie działa.
 *
 * Przy każdym adresie widać status, opis i żywe przypisania —
 * administrator zaznacza VIP-a świadomie: odróżni adres wolny od
 * oznaczonego jako zajęty i zobaczy, czyje to już IP, przed zapisem,
 * nie po nim.
 */
export function IpAddressPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { data, isLoading } = useSubnets();
  const [query, setQuery] = useState('');
  const [openIds, setOpenIds] = useState<string[]>([]);

  const subnets = data?.subnets ?? [];
  const search = query.trim().toLowerCase();

  const toggle = (id: string) =>
    setOpenIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const pick = (id: string) =>
    onChange(
      value.includes(id)
        ? value.filter((x) => x !== id)
        : [...value, id],
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
          <input
            type="search"
            className="input pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Szukaj po adresie lub opisie…"
            aria-label="Szukaj adresu IP"
          />
        </div>
        <span className="shrink-0 tabular-nums text-sm text-fg-muted">
          Zaznaczono: {value.length}
        </span>
      </div>

      {isLoading ? (
        <p className="text-sm text-fg-muted">Ładowanie podsieci…</p>
      ) : subnets.length === 0 ? (
        <p className="text-sm text-fg-muted">
          Katalog podsieci jest pusty — najpierw dodaj podsieć i adresy
          w sekcji „Adresy IP", potem przypisz je tutaj.
        </p>
      ) : (
        <div className="scroll-thin max-h-80 overflow-y-auto rounded-lg border border-line">
          <ul className="divide-y divide-line">
            {subnets.map((subnet) => (
              <SubnetGroup
                key={subnet.id}
                subnet={subnet}
                // Wyszukiwanie otwiera wszystko — patrz komentarz na górze.
                open={search !== '' || openIds.includes(subnet.id)}
                search={search}
                selected={value}
                onToggle={() => toggle(subnet.id)}
                onPick={pick}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Nagłówek podsieci + jej adresy, pobierane tylko gdy grupa jest
 * otwarta (`enabled` w haku liczy się z `open`).
 */
function SubnetGroup({
  subnet,
  open,
  search,
  selected,
  onToggle,
  onPick,
}: {
  subnet: SubnetWithCounts;
  open: boolean;
  /** Mały litera; pusty = brak filtra. */
  search: string;
  selected: string[];
  onToggle: () => void;
  onPick: (id: string) => void;
}) {
  const { data, isLoading } = useSubnetAddresses(open ? subnet.id : undefined);
  const addresses = data?.addresses ?? [];

  const visible = search
    ? addresses.filter(
        (a) =>
          a.address.toLowerCase().includes(search) ||
          (a.description ?? '').toLowerCase().includes(search),
      )
    : addresses;

  // Licznik zaznaczeń ma sens tylko na załadowanej liście — zamknięta
  // grupa nie wie, które z jej adresów siedzą w `selected`.
  const zaznaczone = open
    ? addresses.filter((a) => selected.includes(a.id)).length
    : 0;

  const color = SUBNET_COLORS[subnet.color] ?? SUBNET_COLORS.slate!;

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-page"
      >
        <IconChevronRight
          className={`size-4 shrink-0 text-fg-subtle transition-transform ${
            open ? 'rotate-90' : ''
          }`}
        />
        <span
          className="inline-block size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
        <span className="min-w-0 truncate font-medium text-fg">
          {subnet.name}
        </span>
        <span className="shrink-0 font-mono text-xs text-fg-muted">
          {subnet.cidr}
        </span>
        {zaznaczone > 0 && (
          <Badge tone="info" dot={false} className="ml-auto text-[11px]">
            zaznaczone: {zaznaczone}
          </Badge>
        )}
      </button>

      {open &&
        (isLoading ? (
          <p className="px-3 pb-2 text-sm text-fg-muted">Ładowanie adresów…</p>
        ) : visible.length === 0 ? (
          <p className="px-3 pb-2 text-sm text-fg-muted">
            {search ? 'Brak pasujących adresów w tej podsieci.' : 'Podsieć nie ma jeszcze adresów.'}
          </p>
        ) : (
          <ul className="pb-1.5">
            {visible.map((address) => (
              <li key={address.id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-1.5 hover:bg-page">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 rounded border-line-strong text-brand-600"
                    checked={selected.includes(address.id)}
                    onChange={() => onPick(address.id)}
                  />
                  <span className="shrink-0 font-mono text-sm text-fg">
                    {address.address}
                  </span>
                  <Badge
                    tone={IP_STATUS_TONES[address.status]}
                    dot={false}
                    className="shrink-0 text-[11px]"
                  >
                    {IP_STATUS_LABELS[address.status]}
                  </Badge>
                  <span
                    className="min-w-0 flex-1 truncate text-sm text-fg-muted"
                    title={address.description ?? undefined}
                  >
                    {address.description ?? '—'}
                  </span>
                  {/* Lista adresów niesie żywe przypisania w wierszu —
                      widać więc, czyj to już adres, jeszcze przed zapisem. */}
                  {address.applications.length > 0 && (
                    <span
                      className="max-w-40 shrink-0 truncate text-xs text-fg-subtle"
                      title={address.applications.map((a) => a.name).join(', ')}
                    >
                      {address.applications.map((a) => a.name).join(', ')}
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        ))}
    </li>
  );
}
