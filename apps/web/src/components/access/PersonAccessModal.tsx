import { useEffect, useMemo, useState } from 'react';
import { useGrantAccess, usePersons } from '../../lib/queries';
import { Button } from '../ui/Button';
import { Field, Select, TextInput } from '../ui/Field';
import { ErrorMessage } from '../ui/Feedback';
import { Modal } from '../ui/Modal';
import { ACCESS_LEVEL_LABELS, type AccessLevel, type Person } from '../../types';

/** Poziomy w kolejności od najwyższego — formularz ma być czytelny bez tabelki. */
const POZIOMY: AccessLevel[] = ['OWNER', 'ADMIN', 'USER', 'READ_ONLY'];

/**
 * Dodanie osoby do macierzy aplikacji.
 *
 * Osoba nie musi mieć konta w panelu — wystarczy e-mail, a imię i nazwisko
 * są potrzebne tylko wtedy, gdy katalog jeszcze takiej osoby nie ma.
 * Dlatego najpierw szukamy w katalogu: podpowiedź pozwala dodać istniejącą
 * osobę jednym e-mailem, zamiast tworzyć drugi wpis z tymi samymi danymi.
 * Serwis i tak odrzuciłby duplikat — lepiej nie dochodzić do tego.
 */
export function PersonAccessModal({
  applicationId,
  onClose,
}: {
  applicationId: string;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [position, setPosition] = useState('');
  const [department, setDepartment] = useState('');
  const [level, setLevel] = useState<AccessLevel>('USER');
  const [expiresOn, setExpiresOn] = useState('');
  const [note, setNote] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const grant = useGrantAccess();
  const { data } = usePersons({ search: email.trim(), includeInactive: true });
  const existing = useMemo<Person | undefined>(
    () => data?.persons.find((p) => p.email.toLowerCase() === email.trim().toLowerCase()),
    [data, email],
  );

  // Błąd dotyczył poprzedniego adresu — przy nowym wyglądałby jak błąd
  // nowego wpisu, a to myli administratora w poszukiwaniu przyczyny.
  useEffect(() => setLocalError(null), [email]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    try {
      await grant.mutateAsync({
        applicationId,
        email: email.trim(),
        level,
        // Dane osoby wysyłamy tylko przy nowym wpisie; dla istniejącej
        // katalog jest już źródłem prawdy.
        ...(existing ? {} : { firstName, lastName }),
        ...(position ? { position } : {}),
        ...(department ? { department } : {}),
        ...(expiresOn ? { expiresOn } : {}),
        ...(note ? { note } : {}),
      });
      onClose();
    } catch (blad) {
      setLocalError(komunikat(blad));
    }
  };

  const brakujeDanych = !existing && (!firstName.trim() || !lastName.trim());

  return (
    <Modal
      open
      onClose={onClose}
      title="Dodaj osobę do macierzy"
      description="Osoba nie musi mieć konta w panelu — dostęp nadaje się poza systemem, a rejestr pokazuje, komu go nadano."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Anuluj
          </Button>
          <Button
            onClick={submit}
            loading={grant.isPending}
            disabled={!email.trim() || brakujeDanych}
          >
            Dodaj
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={submit}>
        {localError && <ErrorMessage error={new Error(localError)} />}

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
            value={department}
            disabled={Boolean(existing)}
            onChange={(e) => setDepartment(e.target.value)}
          />
        </div>

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
            <input {...props} className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          )}
        </Field>
      </form>
    </Modal>
  );
}

/** Tekst z błędu API — `ApiError` już ma gotową treść komunikatu. */
function komunikat(blad: unknown): string {
  if (blad && typeof blad === 'object' && 'message' in blad) {
    return String((blad as { message: unknown }).message);
  }
  return 'Nie udało się dodać osoby.';
}