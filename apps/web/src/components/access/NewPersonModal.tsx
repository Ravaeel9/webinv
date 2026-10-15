import { useState } from 'react';
import { useCreatePerson } from '../../lib/queries';
import { Button } from '../ui/Button';
import { TextInput } from '../ui/Field';
import { ErrorMessage } from '../ui/Feedback';
import { Modal } from '../ui/Modal';

/**
 * Dodanie osoby do katalogu, bez przypisania do aplikacji.
 *
 * Osobę najczęściej dodaje się przy karcie aplikacji — tam od razu widać,
 * po co ktoś w katalogu jest. Ten formularz zostaje dla sytuacji, gdy katalog
 * uzupełnia się z wyprzedzeniem (np. przy wdrożeniu), a dostęp nada się później.
 */
export function NewPersonModal({ onClose }: { onClose: () => void }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [position, setPosition] = useState('');
  const [department, setDepartment] = useState('');

  const create = useCreatePerson();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await create.mutateAsync({
        firstName,
        lastName,
        email,
        ...(position ? { position } : {}),
        ...(department ? { department } : {}),
      });
      onClose();
    } catch {
      // Błąd zostaje na `create.error` i pokazuje go `ErrorMessage` poniżej —
      // nie duplikujemy go w lokalnym stanie.
    }
  };

  const gotowe = firstName.trim() !== '' && lastName.trim() !== '' && email.trim() !== '';

  return (
    <Modal
      open
      onClose={onClose}
      title="Dodaj osobę do katalogu"
      description="Dane osoby mającej dostęp do aplikacji. Konto w panelu nie jest potrzebne."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Anuluj
          </Button>
          <Button onClick={submit} loading={create.isPending} disabled={!gotowe}>
            Dodaj
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={submit}>
        <ErrorMessage error={create.error} />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            label="Imię"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
          <TextInput
            label="Nazwisko"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
          <TextInput
            label="Stanowisko"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
          />
          <TextInput
            label="Dział"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          />
        </div>

        <TextInput
          label="Adres e-mail"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          hint="Tożsamość osoby w katalogu — ta sama osoba nie wejdzie drugi raz."
        />
      </form>
    </Modal>
  );
}