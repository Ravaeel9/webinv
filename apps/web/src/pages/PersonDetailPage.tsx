import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  useDeactivatePerson,
  useDeletePerson,
  usePersonGrants,
  useRevokeGrant,
  useUpdatePerson,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/layout/AppLayout';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { TextInput } from '../components/ui/Field';
import { EmptyState, ErrorMessage, Spinner } from '../components/ui/Feedback';
import { Modal } from '../components/ui/Modal';
import { Table, Tbody, Td, Th, Thead } from '../components/ui/Table';
import { formatDate } from '../lib/format';
import { ACCESS_LEVEL_LABELS } from '../types';

/**
 * Jedna osoba w ewidencji: dane i lista aplikacji, do których ma dostęp.
 *
 * Edycja danych jest tu z tych samych powodów co w macierzy — zmiana
 * stanowiska w jednym miejscu ma obowiązywać wszędzie, gdzie ta osoba
 * występuje. Dlatego formularz zapisuje do katalogu, a nie do macierzy.
 */
export function PersonDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data, isLoading, error } = usePersonGrants(id);
  const update = useUpdatePerson();
  const deactivate = useDeactivatePerson();
  const remove = useDeletePerson();
  const revoke = useRevokeGrant();

  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [lastName, setLastName] = useState<string | null>(null);
  const [position, setPosition] = useState<string | null>(null);
  const [department, setDepartment] = useState<string | null>(null);

  if (isLoading) return <Spinner label="Wczytuję osobę…" />;
  if (error) return <ErrorMessage error={error} />;
  if (!data) return <EmptyState title="Nie znaleziono osoby" />;

  const osoba = data.person;
  const grants = data.grants;
  const canWrite = can('access:write');

  const imie = firstName ?? osoba.firstName;
  const nazwisko = lastName ?? osoba.lastName;
  const stanowisko = position ?? osoba.position ?? '';
  const dzial = department ?? osoba.department ?? '';
  const zmienione =
    imie !== osoba.firstName ||
    nazwisko !== osoba.lastName ||
    stanowisko !== (osoba.position ?? '') ||
    dzial !== (osoba.department ?? '');

  return (
    <>
      <PageHeader
        title={`${osoba.firstName} ${osoba.lastName}`}
        description={osoba.email}
        back={{ to: '/uprawnienia', label: 'Wróć do uprawnień' }}
        actions={
          canWrite && (
            <>
              {osoba.isActive ? (
                <Button
                  variant="secondary"
                  loading={deactivate.isPending}
                  onClick={async () => {
                    setLocalError(null);
                    try {
                      await deactivate.mutateAsync(osoba.id);
                    } catch {
                      // Błąd bez komunikatu wygląda jak „nie udało się zapisać",
                      // a administrator odchodzi z wnioskiem, że kliknął i działa.
                      setLocalError('Nie udało się zdezaktywować osoby.');
                    }
                  }}
                >
                  Dezaktywuj
                </Button>
              ) : (
                // Bez tego osoby nie da się przywrócić z poziomu interfejsu:
                // komunikat o błudzie przy nadaniu mówi „najpierw aktywuj ją
                // w katalogu osób", a jedynym przyciskiem było „Dezaktywuj".
                <Button
                  variant="secondary"
                  loading={update.isPending}
                  onClick={async () => {
                    setLocalError(null);
                    try {
                      await update.mutateAsync({ id: osoba.id, isActive: true });
                    } catch {
                      setLocalError('Nie udało się aktywować osoby.');
                    }
                  }}
                >
                  Aktywuj
                </Button>
              )}
              <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
                Usuń
              </Button>
            </>
          )
        }
      />

      {localError && <ErrorMessage error={new Error(localError)} className="mb-4" />}

      <section className="card mb-5 px-4 py-4">
        <h2 className="section-title mb-3">Dane osoby</h2>
        {!osoba.isActive && (
          <p className="alert alert-warn mb-3 py-2 text-xs">
            Osoba jest nieaktywna — nie da się dodać jej do macierzy, a istniejące
            przypisania pozostają widoczne.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <TextInput
            label="Imię"
            value={imie}
            disabled={!canWrite}
            onChange={(e) => setFirstName(e.target.value)}
          />
          <TextInput
            label="Nazwisko"
            value={nazwisko}
            disabled={!canWrite}
            onChange={(e) => setLastName(e.target.value)}
          />
          <TextInput
            label="Stanowisko"
            value={stanowisko}
            disabled={!canWrite}
            onChange={(e) => setPosition(e.target.value)}
          />
          <TextInput
            label="Dział"
            value={dzial}
            disabled={!canWrite}
            onChange={(e) => setDepartment(e.target.value)}
          />
        </div>
        {canWrite && (
          <div className="mt-4 flex gap-2">
            <Button
              disabled={!zmienione}
              loading={update.isPending}
              onClick={async () => {
                setLocalError(null);
                try {
                  await update.mutateAsync({
                    id: osoba.id,
                    firstName: imie,
                    lastName: nazwisko,
                    ...(stanowisko ? { position: stanowisko } : {}),
                    ...(dzial ? { department: dzial } : {}),
                  });
                  setFirstName(null);
                  setLastName(null);
                  setPosition(null);
                  setDepartment(null);
                } catch {
                  setLocalError('Nie udało się zapisać danych osoby.');
                }
              }}
            >
              Zapisz zmiany
            </Button>
          </div>
        )}
      </section>

      <section className="card-section">
        <div className="card-section-header">
          <span className="section-icon tone-info" />
          <h2 className="section-title">Dostęp do aplikacji</h2>
        </div>
        <div className="card-section-body">
          {grants.length === 0 ? (
            <EmptyState
              title="Ta osoba nie ma jeszcze dostępu do żadnej aplikacji"
              description="Dodaj ją przy karcie aplikacji — to jedno miejsce, w którym nadajemy dostęp."
            />
          ) : (
            <Table className="min-w-[640px]">
              <Thead>
                <tr>
                  <Th>Aplikacja</Th>
                  <Th>Poziom</Th>
                  <Th>Nadano</Th>
                  <Th>Wygasa</Th>
                  {canWrite && (
                    <Th className="w-10 text-right">
                      <span className="sr-only">Akcje</span>
                    </Th>
                  )}
                </tr>
              </Thead>
              <Tbody>
                {grants.map((grant) => (
                  <tr key={grant.application.id} className="table-row-hover">
                    <Td>{grant.application.name}</Td>
                    <Td>
                      <Badge tone={grant.level === 'OWNER' ? 'violet' : 'neutral'}>
                        {ACCESS_LEVEL_LABELS[grant.level]}
                      </Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-fg-muted">
                      {formatDate(grant.grantedOn)}
                    </Td>
                    <Td className="whitespace-nowrap text-fg-muted">
                      {grant.expiresOn ? formatDate(grant.expiresOn) : 'bezterminowo'}
                    </Td>
                    {canWrite && (
                      <Td className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            setLocalError(null);
                            try {
                              await revoke.mutateAsync({
                                applicationId: grant.application.id,
                                personId: osoba.id,
                              });
                            } catch {
                              setLocalError('Nie udało się odebrać dostępu.');
                            }
                          }}
                        >
                          Odebraj
                        </Button>
                      </Td>
                    )}
                  </tr>
                ))}
              </Tbody>
            </Table>
          )}
        </div>
      </section>

      <Button
        variant="ghost"
        className="mt-4"
        onClick={() => navigate('/uprawnienia')}
      >
        Wróć do listy osób
      </Button>

      {confirmingDelete && (
        <Modal
          open
          size="sm"
          title="Usunąć osobę?"
          onClose={() => {
            setConfirmingDelete(false);
            remove.reset();
          }}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
                Anuluj
              </Button>
              <Button
                variant="danger"
                loading={remove.isPending}
                onClick={async () => {
                  await remove.mutateAsync(osoba.id);
                  navigate('/uprawnienia', { replace: true });
                }}
              >
                Usuń
              </Button>
            </>
          }
        >
          <p className="text-sm text-fg-muted">
            Czy na pewno chcesz usunąć{' '}
            <strong className="font-semibold text-fg">
              {osoba.firstName} {osoba.lastName}
            </strong>
            ? Twarde usunięcie zabiera jej wszystkie <strong className="font-semibold text-fg">przypisania</strong> w
            macierzach aplikacji — tę operację da się cofnąć tylko przez ponowne utworzenie osoby. Jeśli osoba odchodzi
            z organizacji, zamiast tego zostanie zdezaktywowana (przypisania zostają czytelne).
          </p>
          <ErrorMessage error={remove.error} className="mt-3" />
        </Modal>
      )}
    </>
  );
}