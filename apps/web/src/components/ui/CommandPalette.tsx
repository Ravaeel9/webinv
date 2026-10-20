import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApplications, usePersons, useSubnets } from '../../lib/queries';
import { useAuth } from '../../lib/auth';
import { Modal } from './Modal';
import { Spinner } from './Feedback';
import { IconSearch } from './icons';

type Wynik = {
  id: string;
  grupa: 'Aplikacje' | 'Osoby (macierz)' | 'Podsieci';
  etykieta: string;
  opis?: string;
  do: string;
};

const MIN_ZNAKOW = 2;

/**
 * Globalne wyszukiwanie (Ctrl/Cmd+K) — jedna kontrolka zamiast trzech
 * różnych filtrów po trzech stronach. Szuka w aplikacjach (rejestr),
 * osobach z macierzy uprawnień i podsieciach IPAM; grupy, do których rola
 * nie ma dostępu, nie są nawet odpytywane.
 *
 * Zapytanie idzie do API dopiero od `MIN_ZNAKOW` znaków — krótsze frazy
 * zwróciłyby pół katalogu, a koszt lista pod Cursorem i tak jest stały.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [fraza, setFraza] = useState('');
  const [aktywny, setAktywny] = useState(0);
  const listaRef = useRef<HTMLUListElement>(null);

  const szukaj = fraza.trim().length >= MIN_ZNAKOW ? fraza.trim() : '';

  const { data: aplikacjeData, isFetching: szukamAplikacji } = useApplications({
    q: szukaj,
    limit: 5,
    offset: 0,
  });
  const { data: osobyData, isFetching: szukamOsob } = usePersons({
    search: can('access:read') ? szukaj : undefined,
    includeInactive: true,
  });
  const { data: podsieciData } = useSubnets();

  const wyniki = useMemo<Wynik[]>(() => {
    const lista: Wynik[] = [];
    const f = fraza.trim().toLowerCase();

    for (const a of aplikacjeData?.items ?? []) {
      lista.push({
        id: `app:${a.id}`,
        grupa: 'Aplikacje',
        etykieta: a.name,
        opis: a.version ? `wersja ${a.version}` : undefined,
        do: `/aplikacje/${a.id}`,
      });
    }

    if (can('access:read')) {
      for (const o of (osobyData?.persons ?? []).slice(0, 5)) {
        lista.push({
          id: `osoba:${o.id}`,
          grupa: 'Osoby (macierz)',
          etykieta: `${o.firstName} ${o.lastName}`,
          opis: o.email,
          do: `/uprawnienia/osoby/${o.id}`,
        });
      }
    }

    if (can('ipam:read')) {
      for (const s of podsieciData?.subnets ?? []) {
        if (
          f.length >= MIN_ZNAKOW &&
          !s.name.toLowerCase().includes(f) &&
          !s.cidr.includes(f)
        ) {
          continue;
        }
        lista.push({
          id: `podsiec:${s.id}`,
          grupa: 'Podsieci',
          etykieta: s.name,
          opis: s.cidr,
          do: `/ipam/${s.id}`,
        });
      }
    }

    return lista.slice(0, 12);
  }, [aplikacjeData, osobyData, podsieciData, fraza, can]);

  // Reset stanu przy zmianie propa — wzorzec „dostosowania stanu podczas
  // renderu" (react.dev: You Might Not Need an Effect). Reaguje o jeden
  // wyświetlany kadr wcześniej niż odpowiednie `useEffect`, a stan
  // poprzedniego renderu trzymamy w osobnym `useState`, nie w refie.
  const [poprzednieOpen, setPoprzednieOpen] = useState(open);
  if (open !== poprzednieOpen) {
    setPoprzednieOpen(open);
    // Przy otwarciu: czysta fraza, fokus na wynik zero.
    if (open) {
      setFraza('');
      setAktywny(0);
    }
  }

  const [poprzedniSzukaj, setPoprzedniSzukaj] = useState(szukaj);
  if (szukaj !== poprzedniSzukaj) {
    setPoprzedniSzukaj(szukaj);
    setAktywny(0);
  }

  const otworz = (wynik: Wynik) => {
    onClose();
    navigate(wynik.do);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setAktywny((p) => Math.min(p + 1, wyniki.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setAktywny((p) => Math.max(p - 1, 0));
    } else if (event.key === 'Enter' && wyniki[aktywny]) {
      event.preventDefault();
      otworz(wyniki[aktywny]!);
    }
  };

  // Aktywny wiersz zawsze w widoku — bez tego strzałki przewijałyby
  // „w ciemno” pod krawędź listy.
  useEffect(() => {
    listaRef.current
      ?.querySelector('[data-aktywny="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [aktywny, wyniki]);

  const szukam = szukamAplikacji || szukamOsob;
  // Grupy w kolejności, z tylko niepustymi — nagłówek grupy jest etykietą
  // semantyczną, nie dekoracją.
  const grupy = useMemo(() => {
    const mapa = new Map<string, Wynik[]>();
    for (const w of wyniki) {
      mapa.set(w.grupa, [...(mapa.get(w.grupa) ?? []), w]);
    }
    return [...mapa.entries()];
  }, [wyniki]);

  return (
    <Modal open={open} onClose={onClose} title="Szukaj" size="md">
      <div onKeyDown={onKeyDown}>
        <div className="relative">
          <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
          <input
            autoFocus
            type="search"
            className="input pl-9"
            placeholder="Aplikacje, osoby, podsieci…"
            value={fraza}
            onChange={(e) => setFraza(e.target.value)}
            aria-label="Fraza do wyszukania"
          />
        </div>

        <ul ref={listaRef} className="mt-3 max-h-80 overflow-y-auto" role="listbox">
          {szukaj.length < MIN_ZNAKOW && (
            <li className="px-3 py-6 text-center text-sm text-fg-muted">
              Wpisz co najmniej {MIN_ZNAKOW} znaki.
            </li>
          )}

          {szukaj.length >= MIN_ZNAKOW && szukam && wyniki.length === 0 && (
            <li className="flex justify-center py-6">
              <Spinner label="Szukam…" />
            </li>
          )}

          {szukaj.length >= MIN_ZNAKOW && !szukam && wyniki.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-fg-muted">
              Brak wyników dla „{fraza.trim()}”.
            </li>
          )}

          {grupy.map(([grupa, pozycje]) => (
            <li key={grupa}>
              <p className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
                {grupa}
              </p>
              <ul>
                {pozycje.map((w) => {
                  const indeks = wyniki.indexOf(w);
                  const aktywnyWiersz = indeks === aktywny;
                  return (
                    <li key={w.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={aktywnyWiersz}
                        data-aktywny={aktywnyWiersz || undefined}
                        onMouseEnter={() => setAktywny(indeks)}
                        onClick={() => otworz(w)}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                          aktywnyWiersz
                            ? 'bg-surface-2 text-fg'
                            : 'text-fg-muted hover:bg-surface-2/60'
                        }`}
                      >
                        <span className="min-w-0 truncate font-medium text-fg">
                          {w.etykieta}
                        </span>
                        {w.opis && (
                          <span className="max-w-[45%] truncate text-xs text-fg-subtle">
                            {w.opis}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
