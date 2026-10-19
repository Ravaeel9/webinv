import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGlpiImportApply,
  useGlpiImportPreview,
} from '../../lib/queries';
import {
  GLPI_POWODY,
  type GlpiImportPreview,
  type GlpiSekcja,
} from '../../types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Field';
import { ErrorMessage } from '../ui/Feedback';
import { Table, Thead, Tbody, Th, Td } from '../ui/Table';
import { useToast } from '../ui/Toast';

/**
 * Import z GLPI — trzy sekcje do wyboru i podgląd przed zapisem.
 *
 * Ten sam dwustopniowy przepływ co import osób z CSV i import nmap:
 * najpierw **podgląd** (API z GLPI jest pobierane i klasyfikowane, nic
 * nie zapisuje), potem **zatwierdzenie**. Checkboxy decydują, które
 * sekcje są w ogóle pobierane — odznaczenie „Osób" przy zaznaczonych
 * „Dostępach" nie psuje importu: dostęp dla osoby, której nie ma
 * w katalogu, zostanie pominięty z czytelnym powodem (widocznym
 * już w podglądzie).
 */

const SEKCJE: Array<{ klucz: GlpiSekcja; label: string; hint: string }> = [
  {
    klucz: 'persons',
    label: 'Osoby',
    hint: 'Użytkownicy GLPI wchodzą do katalogu osób (dopasowanie po e-mailu).',
  },
  {
    klucz: 'software',
    label: 'Oprogramowanie',
    hint: 'Programy z GLPI stają się szkicami aplikacji w rejestrze.',
  },
  {
    klucz: 'access',
    label: 'Dostępy (grupy)',
    hint: 'Podrzędne grupy grupy nadrzędnej stają się aplikacjami, a ich członkowie — wierszami macierzy uprawnień.',
  },
];

export function GlpiImportModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [sekcje, setSekcje] = useState<Set<GlpiSekcja>>(
    new Set(['persons', 'software', 'access']),
  );
  const [podglad, setPodglad] = useState<GlpiImportPreview | null>(null);

  const pobieraj = useGlpiImportPreview();
  const zapisz = useGlpiImportApply();

  const zamknij = () => {
    setPodglad(null);
    onClose();
  };

  const przelacz = (klucz: GlpiSekcja) => {
    setSekcje((poprzednie) => {
      const nastepne = new Set(poprzednie);
      if (nastepne.has(klucz)) {
        nastepne.delete(klucz);
      } else {
        nastepne.add(klucz);
      }
      return nastepne;
    });
    // Zmiana zakresu unieważnia podgląd — migawka pochodziła
    // z innych ustawień niż zaznaczone teraz checkboxy.
    setPodglad(null);
  };

  const pokazPodglad = () => {
    const wybrane = SEKCJE.filter((s) => sekcje.has(s.klucz)).map((s) => s.klucz);
    pobieraj.mutate(wybrane, { onSuccess: (dane) => setPodglad(dane) });
  };

  const zatwierdz = () => {
    if (!podglad) return;

    const payload = {
      sections: SEKCJE.filter((s) => sekcje.has(s.klucz)).map((s) => s.klucz),
      ...(sekcje.has('persons')
        ? {
            persons: podglad.osoby.rows
              .filter((r) => r.status === 'NEW' && r.osoba)
              .map((r) => r.osoba!),
          }
        : {}),
      ...(sekcje.has('software')
        ? {
            software: podglad.oprogramowanie.rows
              .filter((r) => r.status === 'NEW')
              .map((r) => ({ name: r.name, version: r.version })),
          }
        : {}),
      ...(sekcje.has('access')
        ? {
            access: podglad.dostepy.pary
              .filter((r) => r.status === 'NEW')
              .map((r) => ({ personEmail: r.personEmail, applicationName: r.applicationName })),
          }
        : {}),
    };

    zapisz.mutate(payload, {
      onSuccess: (wynik) => {
        // Import tworzy osoby, aplikacje i dostępy — wszystkie widoki,
        // które je pokazują, muszą odświeżyć dane.
        void queryClient.invalidateQueries({ queryKey: ['applications'] });
        void queryClient.invalidateQueries({ queryKey: ['access'] });
        void queryClient.invalidateQueries({ queryKey: ['stats'] });
        void queryClient.invalidateQueries({ queryKey: ['ipam'] });
        toast.pokaz(
          `Import z GLPI zakończony: osób ${wynik.persons.created}, ` +
            `oprogramowania ${wynik.software.created}, dostępów ${wynik.access.created}.`,
        );
        zamknij();
      },
    });
  };

  const lacznieNowych = podglad
    ? podglad.osoby.summary.created +
      podglad.oprogramowanie.summary.created +
      podglad.dostepy.summary.created
    : 0;

  return (
    <Modal
      open={open}
      onClose={zamknij}
      title="Import z GLPI"
      description="Podgląd pokazuje, co zostanie utworzone. Import tworzy wyłącznie nowe rekordy — niczego nie nadpisuje."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={zamknij}>
            Anuluj
          </Button>
          {podglad ? (
            <Button
              loading={zapisz.isPending}
              disabled={lacznieNowych === 0}
              onClick={zatwierdz}
            >
              Zatwierdź i zapisz{lacznieNowych > 0 ? ` (${lacznieNowych})` : ''}
            </Button>
          ) : (
            <Button
              loading={pobieraj.isPending}
              disabled={sekcje.size === 0}
              onClick={pokazPodglad}
            >
              Pokaż podgląd
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {SEKCJE.map(({ klucz, label, hint }) => (
            <Checkbox
              key={klucz}
              label={label}
              hint={hint}
              checked={sekcje.has(klucz)}
              onChange={() => przelacz(klucz)}
            />
          ))}
        </div>

        <ErrorMessage error={pobieraj.error} />
        <ErrorMessage error={zapisz.error} />

        {podglad && <PodgladDanych podglad={podglad} sekcje={sekcje} />}
      </div>
    </Modal>
  );
}

/** Podgląd sekcji — tabele wierszy ze statusem i polskim powodem. */
function PodgladDanych({
  podglad,
  sekcje,
}: {
  podglad: GlpiImportPreview;
  sekcje: Set<GlpiSekcja>;
}) {
  return (
    <div className="space-y-4">
      {sekcje.has('persons') && (
        <SekcjaPreview
          tytul="Osoby"
          podsumowanie={podglad.osoby.summary}
          liczbaKolumn={4}
          naglowki={['Imię i nazwisko', 'E-mail', 'Stanowisko / dział', 'Status']}
          wiersze={podglad.osoby.rows.map((r) => (
            <tr key={r.glpiId} className="table-row-hover">
              <Td className="text-fg">
                {r.osoba ? `${r.osoba.firstName} ${r.osoba.lastName}` : '—'}
              </Td>
              <Td className="text-fg-muted">{r.osoba?.email ?? '—'}</Td>
              <Td className="text-fg-muted">
                {[r.osoba?.position, r.osoba?.department].filter(Boolean).join(' / ') || '—'}
              </Td>
              <Td>
                <StatusWiersza status={r.status} reason={r.reason} />
              </Td>
            </tr>
          ))}
        />
      )}

      {sekcje.has('software') && (
        <SekcjaPreview
          tytul="Oprogramowanie"
          podsumowanie={podglad.oprogramowanie.summary}
          liczbaKolumn={3}
          naglowki={['Nazwa', 'Wersja', 'Status']}
          wiersze={podglad.oprogramowanie.rows.map((r) => (
            <tr key={r.glpiId} className="table-row-hover">
              <Td className="text-fg">{r.name || '—'}</Td>
              <Td className="text-fg-muted">{r.version || '—'}</Td>
              <Td>
                <StatusWiersza status={r.status} reason={r.reason} />
              </Td>
            </tr>
          ))}
        />
      )}

      {sekcje.has('access') && (
        <>
          <SekcjaPreview
            tytul="Dostępy — aplikacje z grup"
            podsumowanie={podglad.dostepy.summary}
            liczbaKolumn={2}
            naglowki={['Aplikacja (z grupy GLPI)', 'Status']}
            wiersze={podglad.dostepy.aplikacje.map((r) => (
              <tr key={r.glpiId} className="table-row-hover">
                <Td className="text-fg">{r.name}</Td>
                <Td>
                  <StatusWiersza status={r.status} reason={r.reason} />
                </Td>
              </tr>
            ))}
          />
          {podglad.dostepy.pary.length > 0 && (
            <SekcjaPreview
              tytul="Dostępy — osoby × aplikacje"
              podsumowanie={podglad.dostepy.summary}
              liczbaKolumn={3}
              naglowki={['Osoba (e-mail)', 'Aplikacja', 'Status']}
              wiersze={podglad.dostepy.pary.map((r, i) => (
                <tr key={`${r.personEmail}-${r.applicationName}-${i}`} className="table-row-hover">
                  <Td className="text-fg-muted">{r.personEmail || '—'}</Td>
                  <Td className="text-fg">{r.applicationName}</Td>
                  <Td>
                    <StatusWiersza status={r.status} reason={r.reason} />
                  </Td>
                </tr>
              ))}
            />
          )}
        </>
      )}
    </div>
  );
}

function SekcjaPreview({
  tytul,
  podsumowanie,
  naglowki,
  liczbaKolumn,
  wiersze,
}: {
  tytul: string;
  podsumowanie: { created: number; skipped: number; errors: number };
  naglowki: string[];
  liczbaKolumn: number;
  wiersze: React.ReactNode[];
}) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-medium text-fg">{tytul}</h3>
        <span className="text-xs text-fg-muted">
          nowe: <strong className="text-fg">{podsumowanie.created}</strong>
          {' · '}pominięte: <strong className="text-fg">{podsumowanie.skipped}</strong>
          {' · '}błędne: <strong className="text-fg">{podsumowanie.errors}</strong>
        </span>
      </div>
      <div className="card max-h-72 overflow-y-auto">
        <Table className="min-w-[560px]">
          <Thead>
            <tr>
              {naglowki.map((n) => (
                <Th key={n}>{n}</Th>
              ))}
            </tr>
          </Thead>
          <Tbody>{wiersze}</Tbody>
        </Table>
      </div>
      {wiersze.length === 0 && (
        <p className="mt-2 text-xs text-fg-muted">
          Brak wierszy w tej sekcji (liczba kolumn: {liczbaKolumn}).
        </p>
      )}
    </div>
  );
}

function StatusWiersza({
  status,
  reason,
}: {
  status: 'NEW' | 'SKIP' | 'ERROR';
  reason: string | null;
}) {
  if (status === 'ERROR') {
    return (
      <span className="alert alert-danger px-2 py-1 text-xs">
        {GLPI_POWODY[reason ?? ''] ?? reason ?? 'Błąd'}
      </span>
    );
  }
  if (status === 'SKIP') {
    return (
      <span className="text-xs text-fg-muted">
        pominięte{reason ? ` — ${GLPI_POWODY[reason] ?? reason}` : ''}
      </span>
    );
  }
  return <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">nowy</span>;
}
