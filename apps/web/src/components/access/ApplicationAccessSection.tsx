import { useState } from 'react';
import {
  downloadAccessExport,
  nazwaPlikuRaportu,
  useApplicationAccess,
  useCreateVerification,
  useRevokeGrant,
  useUpdateGrant,
} from '../../lib/queries';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate } from '../../lib/format';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Select, TextInput } from '../ui/Field';
import { EmptyState, ErrorMessage, Spinner } from '../ui/Feedback';
import { useToast } from '../ui/Toast';
import { Table, Tbody, Td, Th, Thead } from '../ui/Table';
import { IconDownload, IconPlus, IconShield, IconTrash } from '../ui/icons';
import { ACCESS_LEVEL_LABELS, type AccessLevel } from '../../types';
import { PersonAccessModal } from './PersonAccessModal';
import { ImportMatrixModal } from './ImportMatrixModal';

const POZIOMY: AccessLevel[] = ['OWNER', 'ADMIN', 'USER', 'READ_ONLY'];

/**
 * Macierz uprawnień w karcie aplikacji.
 *
 * Ewidencja, nie mechanizm nadania: system nie umawia nikomu dostępu,
 * tylko zapisuje, komu go nadano poza nim. Dlatego przy każdym wierszu
 * pokazujemy datę nadania i wygaśnięcia — to jedyne miejsce, gdzie
 * widać, kiedy kto dostał dostęp.
 *
 * Wygasłe przypisania i osoby nieaktywne **zostają** w tabeli z ostrzeżeniem:
 * to historia nadania, a nie stan bieżący. Usunięcie wiersza z oczu
 * administratora dawałoby fałszywe poczucie, że tych osób tu nigdy nie było.
 */
export function ApplicationAccessSection({
  applicationId,
  nazwaAplikacji,
}: {
  applicationId: string;
  nazwaAplikacji: string;
}) {
  const { can } = useAuth();
  const { data, isLoading, error } = useApplicationAccess(applicationId);
  const [dodawanie, setDodawanie] = useState(false);
  // Import macierzy tej aplikacji: poprawki właściciela z eksportu karty
  // wracają do ewidencji w tej samej aplikacji, której dotyczyły.
  const [importMacierzy, setImportMacierzy] = useState(false);
  const canWrite = can('access:write');

  const grants = data?.grants ?? [];

  return (
    <section className="card-section">
      <div className="card-section-header">
        <span className="section-icon tone-info">
          <IconShield />
        </span>
        <h2 className="section-title">Uprawnienia do aplikacji</h2>
        <RaportAplikacjiButton
          applicationId={applicationId}
          nazwaAplikacji={nazwaAplikacji}
          className="ml-auto"
        />
        {canWrite && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setImportMacierzy(true)}
            title="Okrężny import: plik raportu tej aplikacji po poprawkach wraca do ewidencji"
          >
            <IconDownload className="size-4" />
            Importuj macierz
          </Button>
        )}
        {canWrite && (
          <Button size="sm" variant="secondary" onClick={() => setDodawanie(true)}>
            <IconPlus className="size-4" />
            Wybierz osoby
          </Button>
        )}
      </div>

      <div className="card-section-body">
        <ErrorMessage error={error} className="mb-3" />

        {isLoading && <Spinner label="Wczytywanie macierzy…" />}

        {!isLoading && grants.length === 0 && (
          <EmptyState
            title="Nikt nie ma tu jeszcze dostępu"
            description="Wybierz z katalogu osoby mające dostęp do tej aplikacji — ich dane są ewidencją, a nie kontem do panelu."
            action={
              canWrite ? (
                <Button onClick={() => setDodawanie(true)}>
                  <IconPlus className="size-4" />
                  Wybierz osoby
                </Button>
              ) : undefined
            }
          />
        )}

        {grants.length > 0 && (
          <Table className="min-w-[760px]">
            <Thead>
              <tr>
                <Th className="w-[22%]">Imię i nazwisko</Th>
                <Th>Stanowisko</Th>
                <Th>Dział</Th>
                <Th>Poziom</Th>
                <Th>Nadano</Th>
                <Th>Wygasa</Th>
                <Th>Zweryfikowano</Th>
                {canWrite && (
                  <Th className="w-10 text-right">
                    <span className="sr-only">Akcje</span>
                  </Th>
                )}
              </tr>
            </Thead>
            <Tbody>
              {grants.map((grant) => (
                <GrantRow
                  key={grant.personId}
                  grant={grant}
                  canWrite={canWrite}
                  applicationId={applicationId}
                />
              ))}
            </Tbody>
          </Table>
        )}

        <p className="mt-3 text-xs text-fg-subtle">
          Macierz to ewidencja: dostęp nadaje się w narzędziu poza tym
          systemem, a rejestr pokazuje, komu go nadano.
        </p>
      </div>

      {importMacierzy && (
        <ImportMatrixModal
          onClose={() => setImportMacierzy(false)}
          applicationId={applicationId}
          nazwaAplikacji={nazwaAplikacji}
        />
      )}

      {dodawanie && (
        <PersonAccessModal applicationId={applicationId} onClose={() => setDodawanie(false)} />
      )}
    </section>
  );
}

/**
 * Przycisk raportu jednej aplikacji — CSV do wręczenia właścicielowi.
 * Treść i nazwę pliku buduje serwer; panel tylko zapisuje pobraną treść.
 */
function RaportAplikacjiButton({
  applicationId,
  nazwaAplikacji,
  className,
}: {
  applicationId: string;
  nazwaAplikacji: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const pobierz = async () => {
    setBusy(true);
    setError(null);
    try {
      const csv = await downloadAccessExport(applicationId);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const adres = URL.createObjectURL(blob);
      const kotwica = document.createElement('a');
      kotwica.href = adres;
      kotwica.download = nazwaPlikuRaportu(nazwaAplikacji);
      kotwica.click();
      // Zwolnienie adresu nie natychmiast: w części przeglądarek
      // anuluje pobieranie, które dopiero co wystartowało.
      setTimeout(() => URL.revokeObjectURL(adres), 1000);
    } catch (blad) {
      setError(blad);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={className}>
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        onClick={pobierz}
        title="CSV z uprawnieniami tej aplikacji — dla właściciela"
      >
        <IconDownload className="size-4" />
        Raport aplikacji
      </Button>
      {error instanceof ApiError && (
        <ErrorMessage error={error} className="mt-2" />
      )}
    </span>
  );
}

/** Wiersz macierzy; przy `canWrite` pozwala zmienić poziom, datę i notatkę. */
function GrantRow({
  grant,
  canWrite,
  applicationId,
}: {
  grant: {
    applicationId: string;
    personId: string;
    level: AccessLevel;
    grantedOn: string;
    expiresOn: string | null;
    verifiedOn: string | null;
    note: string | null;
    person: {
      id: string;
      firstName: string;
      lastName: string;
      position: string | null;
      department: string | null;
      isActive: boolean;
    };
  };
  canWrite: boolean;
  applicationId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [level, setLevel] = useState<AccessLevel>(grant.level);
  const [expiresOn, setExpiresOn] = useState(grant.expiresOn ?? '');
  const [note, setNote] = useState(grant.note ?? '');
  const update = useUpdateGrant();
  const revoke = useRevokeGrant();
  const weryfikuj = useCreateVerification();
  const toast = useToast();

  const wygaslo = Boolean(grant.expiresOn && grant.expiresOn < dzis());
  const ostrzezenie = !grant.person.isActive ? 'nieaktywna' : wygaslo ? 'wygasł' : null;

  const zapisz = async () => {
    await update.mutateAsync({
      applicationId,
      personId: grant.personId,
      level,
      expiresOn: expiresOn || null,
      note: note || null,
    });
    setEditing(false);
  };

  /** Potwierdzenie wiersza; blokada 24 h wraca jako toast (popup) —
   *  nie jako inline w komórce, bo użytkownik nie czyta tabeli w kolankę,
   *  a cicha porażka zachęcałaby do dalszego klikania. */
  const zweryfikujGrant = async () => {
    try {
      await weryfikuj.mutateAsync({
        scope: 'GRANT',
        applicationId,
        personId: grant.personId,
      });
    } catch (blad) {
      if (blad instanceof ApiError) toast.pokaz(blad.message, 'blad');
      else throw blad;
    }
  };

  return (
    <tr className="table-row-hover">
      <Td>
        <div className="font-medium text-fg">
          {grant.person.firstName} {grant.person.lastName}
        </div>
        {ostrzezenie && (
          <Badge tone="warn" className="mt-1">
            {ostrzezenie === 'wygasł' ? 'Dostęp wygasł' : 'Osoba nieaktywna'}
          </Badge>
        )}
      </Td>
      <Td className="text-fg-muted">{grant.person.position ?? '—'}</Td>
      <Td className="text-fg-muted">{grant.person.department ?? '—'}</Td>
      <Td>
        {editing ? (
          <Select
            label="Poziom"
            value={level}
            onChange={(e) => setLevel(e.target.value as AccessLevel)}
          >
            {POZIOMY.map((poziom) => (
              <option key={poziom} value={poziom}>
                {ACCESS_LEVEL_LABELS[poziom]}
              </option>
            ))}
          </Select>
        ) : (
          <Badge tone={grant.level === 'OWNER' ? 'violet' : 'neutral'}>
            {ACCESS_LEVEL_LABELS[grant.level]}
          </Badge>
        )}
      </Td>
      <Td className="whitespace-nowrap text-fg-muted">{formatDate(grant.grantedOn)}</Td>
      <Td>
        {editing ? (
          <TextInput
            label="Wygasa"
            type="date"
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
          />
        ) : (
          // Wygasły dostęp dostaje ostrzeżenie w komórce, a nie szary tekst —
          // szary byłby nieodróżnialny od „bezterminowo".
          <span className={wygaslo ? 'alert alert-warn px-2 py-1 text-xs' : 'text-fg-muted'}>
            {grant.expiresOn ? formatDate(grant.expiresOn) : 'bezterminowo'}
          </span>
        )}
      </Td>
      <Td className="whitespace-nowrap text-fg-muted">
        {/* „—" jest tu informacje-bearing: weryfikacja przy wierszu
            potwierdza konkretny stan dostępu, więc brak daty znaczy
            „nigdy nie przeglądano". */}
        {grant.verifiedOn ? formatDate(grant.verifiedOn) : '—'}
      </Td>
      {canWrite && (
        <Td className="text-right">
          {editing ? (
            <span className="flex items-center justify-end gap-2">
              <TextInput
                label="Notatka"
                value={note}
                placeholder="Notatka"
                onChange={(e) => setNote(e.target.value)}
              />
              <Button size="sm" onClick={zapisz} loading={update.isPending}>
                Zapisz
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Anuluj
              </Button>
            </span>
          ) : (
            <span className="flex items-center justify-end gap-1">
              <Button
                size="sm"
                variant="ghost"
                title="Potwierdź, że ten dostęp jest aktualny"
                loading={weryfikuj.isPending}
                onClick={zweryfikujGrant}
              >
                Zweryfikuj
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Zmień
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="Odebranie dostępu usuwa przypisanie, nie osobę"
                onClick={() =>
                  revoke.mutate({
                    applicationId,
                    personId: grant.personId,
                  })
                }
              >
                <IconTrash className="size-4" />
              </Button>
            </span>
          )}
        </Td>
      )}
    </tr>
  );
}

/** Dzisiejsza data w formacie `RRRR-MM-DD` — porównanie jest tekstowe. */
function dzis(): string {
  return new Date().toISOString().slice(0, 10);
}