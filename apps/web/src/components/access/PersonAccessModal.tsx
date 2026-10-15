import { useEffect, useMemo, useState } from 'react';
import {
  useApplicationAccess,
  useGrantAccess,
  usePersons,
} from '../../lib/queries';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Field, Select, TextInput } from '../ui/Field';
import { EmptyState, ErrorMessage, Spinner } from '../ui/Feedback';
import { Modal } from '../ui/Modal';
import { Table, Tbody, Td, Th, Thead } from '../ui/Table';
import { ACCESS_LEVEL_LABELS, type AccessLevel, type Person } from '../../types';

/** Poziomy w kolejności od najwyższego — formularz ma być czytelny bez tabelki. */
const POZIOMY: AccessLevel[] = ['OWNER', 'ADMIN', 'USER', 'READ_ONLY'];

type Tryb = 'lista' | 'nowa';

/**
 * Dodanie osób do macierzy aplikacji.
 *
 * Domyślny widok to wybór z katalogu osób (z wyszukiwaniem i filtrem działu)
 * oraz zaznaczaniem wielu osób naraz z jednym wspólnym poziomem dostępu.
 * Osoby, które już mają dostęp do tej aplikacji, oraz osoby nieaktywne
 * są widoczne na liście, ale mają wyłączony checkbox i odpowiednią etykietę.
 *
 * Dla przypadków, gdy kogoś nie ma jeszcze w katalogu, zachowany jest
 * awaryjny widok „Dodaj nową osobę" z formularzem.
 */
export function PersonAccessModal({
  applicationId,
  onClose,
}: {
  applicationId: string;
  onClose: () => void;
}) {
  const [tryb, setTryb] = useState<Tryb>('lista');
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [wybraneIds, setWybraneIds] = useState<Record<string, boolean>>({});

  // Pola dla awaryjnego formularza nowej osoby
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [position, setPosition] = useState('');
  const [newDepartment, setNewDepartment] = useState('');

  // Wspólne parametry nadania dostępu
  const [level, setLevel] = useState<AccessLevel>('USER');
  const [expiresOn, setExpiresOn] = useState('');
  const [note, setNote] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [zapisywanieListy, setZapisywanieListy] = useState(false);

  const grant = useGrantAccess();
  const { data: accessData } = useApplicationAccess(applicationId);
  const { data: personsData, isLoading: ladowanieOsob } = usePersons({
    search: tryb === 'lista' ? search.trim() : email.trim(),
    department: tryb === 'lista' ? department.trim() : undefined,
    includeInactive: true,
  });

  const maJuzDostep = useMemo(() => {
    const zbior = new Set<string>();
    for (const g of accessData?.grants ?? []) {
      zbior.add(g.personId);
    }
    return zbior;
  }, [accessData]);

  const osoby = personsData?.persons ?? [];

  const dostepneDoWyboru = useMemo(
    () => osoby.filter((osoba) => osoba.isActive && !maJuzDostep.has(osoba.id)),
    [osoby, maJuzDostep],
  );

  const zaznaczoneOsoby = useMemo(
    () =>
      osoby.filter(
        (osoba) =>
          Boolean(wybraneIds[osoba.id]) && osoba.isActive && !maJuzDostep.has(osoba.id),
      ),
    [osoby, wybraneIds, maJuzDostep],
  );

  const existing = useMemo<Person | undefined>(
    () =>
      personsData?.persons.find(
        (p) => p.email.toLowerCase() === email.trim().toLowerCase(),
      ),
    [personsData, email],
  );

  useEffect(() => setLocalError(null), [email, tryb, wybraneIds]);

  const przelaczWszystkieWidoczne = (zaznacz: boolean) => {
    setWybraneIds((poprzednie) => {
      const nowe = { ...poprzednie };
      for (const osoba of dostepneDoWyboru) {
        nowe[osoba.id] = zaznacz;
      }
      return nowe;
    });
  };

  const submitLista = async (event: React.FormEvent) => {
    event.preventDefault();
    if (zaznaczoneOsoby.length === 0) return;
    setLocalError(null);
    setZapisywanieListy(true);
    try {
      for (const osoba of zaznaczoneOsoby) {
        await grant.mutateAsync({
          applicationId,
          email: osoba.email,
          level,
          ...(expiresOn ? { expiresOn } : {}),
          ...(note ? { note } : {}),
        });
      }
      onClose();
    } catch (blad) {
      setLocalError(komunikat(blad));
    } finally {
      setZapisywanieListy(false);
    }
  };

  const submitNowa = async (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    try {
      await grant.mutateAsync({
        applicationId,
        email: email.trim(),
        level,
        ...(existing ? {} : { firstName, lastName }),
        ...(position ? { position } : {}),
        ...(newDepartment ? { department: newDepartment } : {}),
        ...(expiresOn ? { expiresOn } : {}),
        ...(note ? { note } : {}),
      });
      onClose();
    } catch (blad) {
      setLocalError(komunikat(blad));
    }
  };

  const brakujeDanychNowej = !existing && (!firstName.trim() || !lastName.trim());

  return (
    <Modal
      open
      onClose={onClose}
      title={
        tryb === 'lista'
          ? 'Wybierz osoby z katalogu'
          : 'Dodaj nową osobę do macierzy'
      }
      description="Osoba nie musi mieć konta w panelu — dostęp nadaje się poza systemem, a rejestr pokazuje, komu go nadano."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Anuluj
          </Button>
          {tryb === 'lista' ? (
            <Button
              onClick={submitLista}
              loading={zapisywanieListy || grant.isPending}
              disabled={zaznaczoneOsoby.length === 0}
            >
              {zaznaczoneOsoby.length > 0
                ? `Nadaj dostęp (${zaznaczoneOsoby.length})`
                : 'Nadaj dostęp'}
            </Button>
          ) : (
            <Button
              onClick={submitNowa}
              loading={grant.isPending}
              disabled={!email.trim() || brakujeDanychNowej}
            >
              Dodaj
            </Button>
          )}
        </>
      }
    >
      {tryb === 'lista' ? (
        <form className="space-y-4" onSubmit={submitLista}>
          {localError && <ErrorMessage error={new Error(localError)} />}

          <div className="flex flex-wrap items-end gap-3">
            <TextInput
              label="Szukaj"
              value={search}
              placeholder="nazwisko, imię lub e-mail"
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-[200px]"
            />
            <TextInput
              label="Dział"
              value={department}
              placeholder="np. IT"
              onChange={(e) => setDepartment(e.target.value)}
              className="w-40"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
            <span>
              Zaznaczono: <strong className="text-fg">{zaznaczoneOsoby.length}</strong>
            </span>
            <div className="flex items-center gap-2">
              {dostepneDoWyboru.length > 0 && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => przelaczWszystkieWidoczne(true)}
                  >
                    Zaznacz dostępne
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => przelaczWszystkieWidoczne(false)}
                  >
                    Odznacz
                  </Button>
                </>
              )}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setTryb('nowa')}
              >
                Dodaj nową osobę
              </Button>
            </div>
          </div>

          {ladowanieOsob && <Spinner label="Wczytuję katalog osób…" />}

          {!ladowanieOsob && osoby.length === 0 && (
            <EmptyState
              title="Brak osób spełniających kryteria"
              description="Zmień filtr wyszukiwania albo dodaj nową osobę spoza katalogu."
              action={
                <Button type="button" size="sm" onClick={() => setTryb('nowa')}>
                  Dodaj nową osobę
                </Button>
              }
            />
          )}

          {osoby.length > 0 && (
            <div className="card max-h-72 overflow-y-auto">
              <Table className="min-w-[560px]">
                <Thead>
                  <tr>
                    <Th className="w-8" />
                    <Th>Imię i nazwisko</Th>
                    <Th>Dział / Stanowisko</Th>
                    <Th>E-mail</Th>
                    <Th>Status</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {osoby.map((osoba) => {
                    const juzMa = maJuzDostep.has(osoba.id);
                    const zablokowana = juzMa || !osoba.isActive;
                    const zaznaczona = Boolean(wybraneIds[osoba.id]) && !zablokowana;

                    return (
                      <tr
                        key={osoba.id}
                        className={`table-row-hover ${zablokowana ? 'opacity-60' : ''}`}
                      >
                        <Td>
                          <input
                            type="checkbox"
                            aria-label={`Zaznacz ${osoba.firstName} ${osoba.lastName}`}
                            disabled={zablokowana}
                            checked={zaznaczona}
                            onChange={(e) =>
                              setWybraneIds((poprzednie) => ({
                                ...poprzednie,
                                [osoba.id]: e.target.checked,
                              }))
                            }
                          />
                        </Td>
                        <Td className="font-medium text-fg">
                          {osoba.firstName} {osoba.lastName}
                        </Td>
                        <Td className="text-fg-muted">
                          {[osoba.department, osoba.position].filter(Boolean).join(' · ') || '—'}
                        </Td>
                        <Td className="text-fg-muted">{osoba.email}</Td>
                        <Td>
                          {juzMa ? (
                            <Badge tone="neutral">Ma już dostęp</Badge>
                          ) : !osoba.isActive ? (
                            <Badge tone="warn">Osoba nieaktywna</Badge>
                          ) : (
                            <span className="text-xs text-fg-subtle">dostępna</span>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </Tbody>
              </Table>
            </div>
          )}

          <ParametryNadania
            level={level}
            setLevel={setLevel}
            expiresOn={expiresOn}
            setExpiresOn={setExpiresOn}
            note={note}
            setNote={setNote}
          />
        </form>
      ) : (
        <form className="space-y-4" onSubmit={submitNowa}>
          {localError && <ErrorMessage error={new Error(localError)} />}

          <div className="flex items-center justify-between">
            <span className="text-xs text-fg-muted">
              Nie znalazłeś osoby na liście? Uzupełnij jej dane poniżej.
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setTryb('lista')}
            >
              ← Wróć do listy osób
            </Button>
          </div>

          <TextInput
            label="Adres e-mail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jan.kowalski@firma.pl"
          />

          {existing && (
            <p className="alert alert-warn px-3 py-2 text-xs">
              Ta osoba już jest w katalogu ({existing.firstName} {existing.lastName}).
              Dodanie nie utworzy nowego wpisu — tylko przypisanie do aplikacji.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Imię"
              value={firstName}
              disabled={Boolean(existing)}
              onChange={(e) => setFirstName(e.target.value)}
            />
            <TextInput
              label="Nazwisko"
              value={lastName}
              disabled={Boolean(existing)}
              onChange={(e) => setLastName(e.target.value)}
            />
            <TextInput
              label="Stanowisko"
              value={position}
              disabled={Boolean(existing)}
              onChange={(e) => setPosition(e.target.value)}
            />
            <TextInput
              label="Dział"
              value={newDepartment}
              disabled={Boolean(existing)}
              onChange={(e) => setNewDepartment(e.target.value)}
            />
          </div>

          <ParametryNadania
            level={level}
            setLevel={setLevel}
            expiresOn={expiresOn}
            setExpiresOn={setExpiresOn}
            note={note}
            setNote={setNote}
          />
        </form>
      )}
    </Modal>
  );
}

function ParametryNadania({
  level,
  setLevel,
  expiresOn,
  setExpiresOn,
  note,
  setNote,
}: {
  level: AccessLevel;
  setLevel: (v: AccessLevel) => void;
  expiresOn: string;
  setExpiresOn: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Poziom dostępu"
          value={level}
          onChange={(e) => setLevel(e.target.value as AccessLevel)}
        >
          {POZIOMY.map((poziom) => (
            <option key={poziom} value={poziom}>
              {ACCESS_LEVEL_LABELS[poziom]}
            </option>
          ))}
        </Select>
        <TextInput
          label="Data wygaśnięcia"
          hint="Puste = dostęp bezterminowy."
          type="date"
          value={expiresOn}
          onChange={(e) => setExpiresOn(e.target.value)}
        />
      </div>

      <Field label="Notatka" hint="Np. dostęp tymczasowy do końca projektu.">
        {(props) => (
          <input
            {...props}
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </Field>
    </>
  );
}

/** Tekst z błędu API — `ApiError` już ma gotową treść komunikatu. */
function komunikat(blad: unknown): string {
  if (blad && typeof blad === 'object' && 'message' in blad) {
    return String((blad as { message: unknown }).message);
  }
  return 'Nie udało się dodać osoby.';
}
