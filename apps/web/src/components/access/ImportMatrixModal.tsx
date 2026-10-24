/**
 * Import macierzy uprawnień z CSV — okrężny z eksportem.
 *
 * Trzy kroki jak w `ImportPersonsModal`: plik → podgląd → zapis. Różnica
 * semantyczna: tu plik jest **żądanym stanem** grantów (pusty „Wygasa" czyści
 * datę), a nie uzupełnieniem katalogu, więc podgląd pokazuje różnice
 * (`od → do`), a nie pełne wiersze do zaznaczenia.
 *
 * Upsert: wiersz pliku nadaje albo aktualizuje grant; osoba nieobecna
 * w pliku zachowuje dostęp, więc "zapisz wszystko" nie może niczego
 * odebrać — wiersze ERRoR są odznaczone, a reszta domyślnie zaznaczona.
 */
import { useState } from 'react';
import {
  useMatrixImportApply,
  useMatrixImportPreview,
} from '../../lib/queries';
import { odczytajPlik } from '../../lib/csvPlik';
import { Button } from '../ui/Button';
import { ErrorMessage, Spinner } from '../ui/Feedback';
import { Modal } from '../ui/Modal';
import { Table, Tbody, Td, Th, Thead } from '../ui/Table';
import type {
  MatrixImportPreview,
  MatrixImportPreviewRow,
  MatrixImportResult,
  MatrixImportRowStatus,
} from '../../types';

/** Komunikaty dla kodów błędów wiersza — podgląd i wynik zapisu używają razem. */
const POWODY: Record<string, string> = {
  ROW_WIDTH: 'wiersz ma inną liczbę kolumn niż nagłówek (zbędny przecinek?)',
  MISSING_EMAIL: 'brak adresu e-mail',
  MISSING_NAME: 'nowa osoba bez imienia lub nazwiska',
  FIELD_TOO_LONG: 'pole ma ponad limit znaków (imię/nazwisko 100, dział i stanowisko 150)',
  PERSON_SAVE_FAILED: 'nie udało się zapisać osoby — spróbuj ponownie',
  INVALID_LEVEL: 'nieznany poziom dostępu (dopuszczalne: OWNER, ADMIN, USER, READ_ONLY)',
  INVALID_DATE: '„Wygasa" nie jest datą w formacie RRRR-MM-DD',
  NOTE_TOO_LONG: 'notatka ma ponad 2000 znaków',
  UNKNOWN_APP: 'nie znaleziono aplikacji o tej nazwie (zmieniła się po eksporcie?)',
  GENERAL_USE_APP: 'aplikacja ogólnego użytku nie ma macierzy uprawnień',
  APP_MISMATCH: 'wiersz wskazuje inną aplikację niż importowana',
  DUPLICATE_IN_FILE: 'ta sama osoba w tej samej aplikacji występuje drugi raz',
  PERSON_INACTIVE: 'osoba jest nieaktywna — najpierw aktywuj ją w katalogu osób',
  INVALID_EMAIL: 'adres e-mail nie wygląda na poprawny',
  EXPIRY_IN_PAST: 'wygasanie w przeszłości przy nowym grancie',
};

const STATUSY: Record<MatrixImportRowStatus, string> = {
  NEW: 'nowy dostęp',
  NEW_PERSON: 'nowa osoba + dostęp',
  UPDATE: 'aktualizacja',
  UNCHANGED: 'bez zmian',
  ERROR: 'błąd',
};

interface Props {
  onClose: () => void;
  /** Tryb pojedynczej aplikacji — eksport karty aplikacji importowany do niej samej. */
  applicationId?: string;
  nazwaAplikacji?: string;
}

export function ImportMatrixModal({ onClose, applicationId, nazwaAplikacji }: Props) {
  const [nazwa, setNazwa] = useState('');
  const [kodowanie, setKodowanie] = useState<'utf-8' | 'windows-1250' | null>(null);
  const [podglad, setPodglad] = useState<MatrixImportPreview | null>(null);
  const [wybrane, setWybrane] = useState<Record<number, boolean>>({});
  const [wynik, setWynik] = useState<MatrixImportResult['result'] | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const preview = useMatrixImportPreview();
  const apply = useMatrixImportApply();

  const doZapisy = (podglad?.rows ?? []).filter((w) => wybrane[w.line]);

  const przejrzyj = async (plik: File) => {
    setLocalError(null);
    setPodglad(null);
    setWynik(null);
    setWybrane({});
    try {
      const { tresc, tryb } = odczytajPlik(await plik.arrayBuffer());
      setNazwa(plik.name);
      setKodowanie(tryb);
      const wynikPodgladu = await preview.mutateAsync({
        csv: tresc,
        ...(applicationId ? { applicationId } : {}),
      });
      setPodglad(wynikPodgladu);
      // Wiersze prawidłowe domyślnie zaznaczone; błędy nie do odznaczenia.
      setWybrane(Object.fromEntries(
        wynikPodgladu.rows.filter((w) => w.status !== 'ERROR').map((w) => [w.line, true]),
      ));
    } catch (blad) {
      setLocalError(komunikat(blad));
    }
  };

  const zapisz = async () => {
    if (!podglad) return;
    const zaznaczone = podglad.rows.filter((w) => wybrane[w.line]);
    setLocalError(null);
    try {
      const odpowiedz = await apply.mutateAsync({
        // Tylko dane wierszy — statusy i kody błędów zostają w podglądzie,
        // serwis i tak waliduje payload od nowa.
        rows: zaznaczone.map((wiersz) => ({
          email: wiersz.email,
          ...(wiersz.firstName ? { firstName: wiersz.firstName } : {}),
          ...(wiersz.lastName ? { lastName: wiersz.lastName } : {}),
          ...(wiersz.position ? { position: wiersz.position } : {}),
          ...(wiersz.department ? { department: wiersz.department } : {}),
          level: wiersz.level,
          ...(wiersz.expiresOn ? { expiresOn: wiersz.expiresOn } : {}),
          ...(wiersz.note ? { note: wiersz.note } : {}),
          ...(wiersz.aplikacja ? { applicationName: wiersz.aplikacja } : {}),
        })),
        ...(applicationId ? { applicationId } : {}),
      });
      setWynik(odpowiedz.result);
    } catch (blad) {
      setLocalError(komunikat(blad));
    }
  };

  const wybierzWszystkie = (zaznaczone: boolean) => {
    const nowe: Record<number, boolean> = {};
    for (const wiersz of podglad?.rows ?? []) {
      if (wiersz.status !== 'ERROR') nowe[wiersz.line] = zaznaczone;
    }
    setWybrane(nowe);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={
        applicationId
          ? `Import macierzy aplikacji „${nazwaAplikacji ?? applicationId}"`
          : 'Import macierzy uprawnień'
      }
      description="Plik w formacie eksportu raportu. Wiersz nadaje dostęp albo aktualizuje poziom, wygasanie i notatkę — osoby nieobecne w pliku zachowują dostęp."
      size="lg"
      footer={
        wynik ? (
          <Button onClick={onClose}>Zamknij</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Anuluj
            </Button>
            <Button
              onClick={zapisz}
              loading={apply.isPending}
              disabled={doZapisy.length === 0}
            >
              Zapisz {doZapisy.length > 0 ? `${doZapisy.length} ` : ''}wierszy
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {localError && <ErrorMessage error={new Error(localError)} />}

        {/* 1. Plik */}
        {!wynik && (
          <div>
            <label htmlFor="matrix-csv-input" className="mb-2 block text-sm font-medium text-fg">
              Plik CSV z eksportu raportu
            </label>
            <input
              id="matrix-csv-input"
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
        )}

        {preview.isPending && <Spinner label="Analizuję plik…" />}

        {/* 2. Podgląd klasyfikacji */}
        {podglad && !wynik && (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-fg-muted">
                Nowe: <strong className="text-fg">{podglad.summary.new + podglad.summary.newPerson}</strong>
              </span>
              <span className="text-fg-muted">
                Aktualizacje: <strong className="text-fg">{podglad.summary.update}</strong>
              </span>
              <span className="text-fg-muted">
                Bez zmian: <strong className="text-fg">{podglad.summary.unchanged}</strong>
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
                    <Th>Aplikacja</Th>
                    <Th>Osoba</Th>
                    <Th>E-mail</Th>
                    <Th>Poziom</Th>
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
                      <Td className="text-fg-muted">{wiersz.aplikacja ?? '—'}</Td>
                      <Td className="text-fg">
                        {wiersz.firstName} {wiersz.lastName}
                      </Td>
                      <Td className="text-fg-muted">{wiersz.email || '—'}</Td>
                      <Td className="text-fg">{wiersz.level}</Td>
                      <Td>
                        <StatusWiersza status={wiersz.status} wiersz={wiersz} />
                      </Td>
                    </tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          </>
        )}

        {/* 3. Wynik zapisu — liczniki i pominięte wiersze z powodami */}
        {wynik && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="text-fg-muted">
                Nadane granty: <strong className="text-fg">{wynik.createdGrants}</strong>
              </span>
              <span className="text-fg-muted">
                Zaktualizowane: <strong className="text-fg">{wynik.updatedGrants}</strong>
              </span>
              <span className="text-fg-muted">
                Nowe osoby: <strong className="text-fg">{wynik.createdPersons}</strong>
              </span>
              <span className="text-fg-muted">
                Bez zmian: <strong className="text-fg">{wynik.unchanged}</strong>
              </span>
              <span className="text-fg-muted">
                Pominięte: <strong className="text-fg">{wynik.skipped}</strong>
              </span>
            </div>

            {wynik.skippedRows.length > 0 && (
              <div className="alert alert-warn flex-col items-start gap-1">
                <span className="text-xs font-medium">
                  Pominięte wiersze — każdy z nich wymaga poprawy w pliku:
                </span>
                {wynik.skippedRows.map((wiersz, indeks) => (
                  <span key={`${wiersz.aplikacja}-${wiersz.email}-${indeks}`} className="text-xs">
                    {wiersz.aplikacja ? `${wiersz.aplikacja}: ` : ''}
                    {wiersz.email} — {wiersz.errors.map((kod) => POWODY[kod] ?? kod).join('; ')}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Odznaka statusu wiersza podglądu — błędy słownikiem POwodów, diff „od → do". */
function StatusWiersza({
  status,
  wiersz,
}: {
  status: MatrixImportRowStatus;
  wiersz: MatrixImportPreviewRow;
}) {
  if (status === 'ERROR') {
    return (
      <span className="alert alert-danger px-2 py-1 text-xs">
        {wiersz.errors.map((kod) => POWODY[kod] ?? kod).join('; ')}
      </span>
    );
  }
  if (status === 'UPDATE' && wiersz.diff.length > 0) {
    const szczegoly = wiersz.diff
      .map((zmiana) => `${etykietaZmiany(zmiana.pole)}: ${zmiana.od} → ${zmiana.do}`)
      .join(', ');
    return <span className="alert alert-warn px-2 py-1 text-xs">{szczegoly}</span>;
  }
  return <span className="text-xs text-fg-muted">{STATUSY[status]}</span>;
}

function etykietaZmiany(pole: string): string {
  if (pole === 'poziom') return 'poziom';
  if (pole === 'wygasa') return 'wygasanie';
  return 'notatka';
}

function komunikat(blad: unknown): string {
  if (blad && typeof blad === 'object' && 'message' in blad) {
    return String((blad as { message: unknown }).message);
  }
  return 'Nie udało się wczytać pliku.';
}
