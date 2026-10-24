import { useMemo, useState } from 'react';
import {
  useApplyPersonsImport,
  usePreviewPersonsImport,
} from '../../lib/queries';
import { odczytajPlik } from '../../lib/csvPlik';
import { Button } from '../ui/Button';
import { Select } from '../ui/Field';
import { ErrorMessage, Spinner } from '../ui/Feedback';
import { Modal } from '../ui/Modal';
import { Table, Tbody, Td, Th, Thead } from '../ui/Table';
import type { HeaderMapping, ImportRowStatus } from '../../types';

const ETYKIETY: Array<[keyof HeaderMapping, string]> = [
  ['email', 'Adres e-mail'],
  ['firstName', 'Imię'],
  ['lastName', 'Nazwisko'],
  ['position', 'Stanowisko'],
  ['department', 'Dział'],
  ['isActive', 'Aktywność'],
];

/** Komunikaty dla kodów błędów z serwera — te same, które pokazuje podgląd. */
const POWODY: Record<string, string> = {
  MISSING_EMAIL: 'brak adresu e-mail',
  MISSING_FIRST_NAME: 'brak imienia',
  MISSING_LAST_NAME: 'brak nazwiska',
  DUPLICATE_IN_FILE: 'ten sam e-mail wcześniej w pliku',
};

/**
 * Import osób z CSV w trzech krokach: plik → podgląd → zapis.
 *
 * Kroki są rozdzielone celowo. Podgląd pozwala administratorowi zobaczyć,
 * które wiersze utworzą nowe osoby, które zaktualizują istniejące i które
 * są błędne — i dopiero wtedy decyduje, co zapisać. Bez podglądu import
 * byłby jednym przyciskiem, po którym nie ma odwrotu.
 *
 * Dekodowanie pliku dzieje się tu, w przeglądarce: plik z polskiego
 * eksportu często jest w Windows-1250, a `TextDecoder('utf-8', {fatal:true})`
 * rozpoznaje ten przypadek po błędzie i pozwala odczytać go właściwie.
 * Bez tego polskie znaki w nazwiskach zamieniłyby się w znaki zapytania.
 */
export function ImportPersonsModal({ onClose }: { onClose: () => void }) {
  const [tekst, setTekst] = useState('');
  const [nazwa, setNazwa] = useState('');
  const [kodowanie, setKodowanie] = useState<'utf-8' | 'windows-1250' | null>(null);
  const [mapping, setMapping] = useState<HeaderMapping | null>(null);
  const [wybrane, setWybrane] = useState<Record<number, boolean>>({});
  const [localError, setLocalError] = useState<string | null>(null);

  const preview = usePreviewPersonsImport();
  const apply = useApplyPersonsImport();

  const podglad = preview.data;

  const doZapisy = useMemo(
    () =>
      (podglad?.rows ?? []).filter(
        (wiersz) => wiersz.status !== 'ERROR' && wybrane[wiersz.line],
      ),
    [podglad, wybrane],
  );

  const wybierzWszystkie = (zaznaczone: boolean) => {
    const nowe: Record<number, boolean> = {};
    for (const wiersz of podglad?.rows ?? []) {
      if (wiersz.status !== 'ERROR') nowe[wiersz.line] = zaznaczone;
    }
    setWybrane(nowe);
  };

  const przejrzyj = async (plik: File) => {
    setLocalError(null);
    setTekst('');
    setMapping(null);
    setWybrane({});
    try {
      const { tresc, tryb } = odczytajPlik(await plik.arrayBuffer());
      setTekst(tresc);
      setKodowanie(tryb);
      setNazwa(plik.name);
      const wynik = await preview.mutateAsync({ csv: tresc });
      // Mapowanie z odpowiedzi, nie tylko z DTO: bez niego nie mielibyśmy
      // czego poprawiać w razie nierozpoznanych kolumn.
      setMapping(wynik.mapping);
      setWybrane(Object.fromEntries(
        wynik.rows.filter((w) => w.status !== 'ERROR').map((w) => [w.line, true]),
      ));
    } catch (blad) {
      setLocalError(komunikat(blad));
    }
  };

  const poprawMapowanie = async (pole: keyof HeaderMapping, naglowek: string) => {
    if (!mapping) return;
    const nowe = { ...mapping, [pole]: naglowek };
    setLocalError(null);
    try {
      const wynik = await preview.mutateAsync({ csv: tekst, mapping: nowe });
      setMapping(wynik.mapping);
    } catch (blad) {
      setLocalError(komunikat(blad));
    }
  };

  const zapisz = async () => {
    setLocalError(null);
    try {
      await apply.mutateAsync(
        doZapisy.map((wiersz) => ({
          email: wiersz.email,
          firstName: wiersz.firstName,
          lastName: wiersz.lastName,
          ...(wiersz.position ? { position: wiersz.position } : {}),
          ...(wiersz.department ? { department: wiersz.department } : {}),
          ...(plikMaStatus ? { isActive: wiersz.isActive } : {}),
        })),
      );
      onClose();
    } catch (blad) {
      setLocalError(komunikat(blad));
    }
  };

  // Lista kolumn do ręcznego przypisania to **wszystkie** nagłówki pliku,
  // nie tylko rozpoznane: nierozpoznana kolumna jest dokładnie tą, którą
  // administrator chce przypisać do pola.
  const wszystkieNaglowki = useMemo(() => {
    const naglowki = podglad ? Object.values(podglad.mapping).filter(Boolean) : [];
    return [...new Set([...naglowki, ...(podglad?.unmapped ?? [])])];
  }, [podglad]);
  // `isActive` wysyłamy tylko wtedy, gdy plik ma kolumnę statusu. Bez tego
  // import pliku bez `Suspended` przywróciłby `isActive=true` osobom, które
  // administrator świadomie zdezaktywował.
  const plikMaStatus = Boolean(podglad?.mapping.isActive);

  return (
    <Modal
      open
      onClose={onClose}
      title="Import osób z pliku CSV"
      description="Np. eksport użytkowników z Google Workspace. Import wypełnia katalog osób — dostęp do aplikacji nadajesz potem w macierzy."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Anuluj
          </Button>
          <Button
            onClick={zapisz}
            loading={apply.isPending}
            disabled={doZapisy.length === 0}
          >
            Zapisz {doZapisy.length > 0 ? `${doZapisy.length} ` : ''}osób
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {localError && <ErrorMessage error={new Error(localError)} />}

        {/* 1. Plik */}
        <div>
          <label htmlFor="persons-csv-input" className="mb-2 block text-sm font-medium text-fg">
            Plik CSV
          </label>
          <input
            id="persons-csv-input"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const plik = e.target.files?.[0];
              if (plik) void przejrzyj(plik);
            }}
            className="input"
          />
          {nazwa && (
            <p className="mt-2 text-xs text-fg-muted">
              {nazwa} · {kodowanie === 'windows-1250'
                ? 'odczytano jako Windows-1250 (plik nie jest w UTF-8)'
                : 'odczytano jako UTF-8'}
            </p>
          )}
        </div>

        {preview.isPending && <Spinner label="Analizuję plik…" />}

        {/* 2. Podgląd i mapowanie kolumn */}
        {podglad && (
          <>
            {(podglad.unmapped.length > 0 || !podglad.mapping.email) && (
              <div className="alert alert-warn flex-col items-start gap-2">
                <span className="text-xs">
                  {podglad.unmapped.length > 0
                    ? `Nie rozpoznaję kolumn: ${podglad.unmapped.join(', ')}.`
                    : 'Nie wykryłem kolumny z adresem e-mail.'}{' '}
                  Przypisz je do pól poniżej — podgląd odświeży się.
                </span>
                {(Object.keys(ETYKIETY) as Array<keyof HeaderMapping>).map((pole) => (
                  <Select
                    key={pole}
                    label={etykietaPola(pole)}
                    value={podglad.mapping[pole] ?? ''}
                    onChange={(e) => void poprawMapowanie(pole, e.target.value)}
                  >
                    <option value="">— nie używaj —</option>
                    {wszystkieNaglowki.map((naglowek) => (
                      <option key={naglowek} value={naglowek}>
                        {naglowek}
                      </option>
                    ))}
                  </Select>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-fg-muted">
                Nowe: <strong className="text-fg">{podglad.summary.create}</strong>
              </span>
              <span className="text-fg-muted">
                Aktualizacje: <strong className="text-fg">{podglad.summary.update}</strong>
              </span>
              <span className="text-fg-muted">
                Błędne: <strong className="text-fg">{podglad.summary.invalid}</strong>
              </span>
              <Button size="sm" variant="ghost" onClick={() => wybierzWszystkie(true)}>
                Zaznacz wszystko
              </Button>
              <Button size="sm" variant="ghost" onClick={() => wybierzWszystkie(false)}>
                Odznacz wszystko
              </Button>
            </div>

            <div className="card max-h-80 overflow-y-auto">
              <Table className="min-w-[640px]">
                <Thead>
                  <tr>
                    <Th className="w-8" />
                    <Th>Wiersz</Th>
                    <Th>Imię i nazwisko</Th>
                    <Th>E-mail</Th>
                    <Th>Dział</Th>
                    <Th>Status</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {podglad.rows.map((wiersz) => (
                    <tr key={wiersz.line} className="table-row-hover">
                      <Td>
                        <input
                          type="checkbox"
                          aria-label={`Zaznacz wiersz ${wiersz.line}`}
                          disabled={wiersz.status === 'ERROR'}
                          checked={Boolean(wybrane[wiersz.line])}
                          onChange={(e) =>
                            setWybrane((poprzednie) => ({
                              ...poprzednie,
                              [wiersz.line]: e.target.checked,
                            }))
                          }
                        />
                      </Td>
                      <Td className="tabular-nums text-fg-subtle">{wiersz.line}</Td>
                      <Td className="text-fg">
                        {wiersz.firstName} {wiersz.lastName}
                      </Td>
                      <Td className="text-fg-muted">{wiersz.email || '—'}</Td>
                      <Td className="text-fg-muted">{wiersz.department ?? '—'}</Td>
                      <Td>
                        <StatusImportu status={wiersz.status} errors={wiersz.errors} />
                      </Td>
                    </tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Odznaka statusu wiersza — błędy wypisujemy słownikiem, nie kodem. */
function StatusImportu({ status, errors }: { status: ImportRowStatus; errors: string[] }) {
  if (status === 'ERROR') {
    return (
      <span className="alert alert-danger px-2 py-1 text-xs">
        {errors.map((kod) => POWODY[kod] ?? kod).join('; ')}
      </span>
    );
  }
  return (
    <span className={status === 'UPDATE' ? 'alert alert-warn px-2 py-1 text-xs' : 'text-xs text-fg-muted'}>
      {status === 'UPDATE' ? 'aktualizacja' : 'nowa osoba'}
    </span>
  );
}

function etykietaPola(pole: keyof HeaderMapping): string {
  return ETYKIETY.find(([klucz]) => klucz === pole)?.[1] ?? pole;
}

function komunikat(blad: unknown): string {
  if (blad && typeof blad === 'object' && 'message' in blad) {
    return String((blad as { message: unknown }).message);
  }
  return 'Nie udało się wczytać pliku.';
}