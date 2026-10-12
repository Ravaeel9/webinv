import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  useCreateAddress,
  useDeleteAddress,
  useDeleteSubnet,
  useSubnet,
  useSubnets,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/layout/AppLayout';
import { Button } from '../components/ui/Button';
import { TextInput } from '../components/ui/Field';
import { EmptyState, ErrorMessage, Spinner } from '../components/ui/Feedback';
import { Modal } from '../components/ui/Modal';
import { IconInfo, IconPencil, IconPlus, IconTrash } from '../components/ui/icons';
import { formatDateTime } from '../lib/format';
import { AddressDeleteModal } from '../components/ipam/AddressDeleteModal';
import { AddressTable } from '../components/ipam/AddressTable';
import type { IpAddress } from '../types';

/** Oktety 0–255 bez zer wiodących — ta sama rygorystyczność co w API. */
const IPV4 = /^(\d{1,2})\.(\d{1,2})\.(\d{1,2})\.(\d{1,2})$/;

/** Poprawny IPv4: cztery oktety, każdy 0–255, bez zer wiodących. */
function isIpv4(value: string): boolean {
  const m = IPV4.exec(value);
  if (!m) return false;
  return m.slice(1).every((part) => {
    if (part.length > 1 && part.startsWith('0')) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

/** Karta podsieci — opis, lista adresów i akcje administracyjne. */
export function SubnetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();

  const { data, isLoading, error, refetch } = useSubnet(id);
  const removeSubnet = useDeleteSubnet();
  const removeAddress = useDeleteAddress();
  const createAddress = useCreateAddress(id ?? '');

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [addressToDelete, setAddressToDelete] = useState<IpAddress | null>(null);
  const [address, setAddress] = useState('');
  const [addressError, setAddressError] = useState<string | undefined>(undefined);

  // Referencja do formularza dodawania — `TextInput` generuje `id`
  // przez `useId()`, więc szukanie go po `getElementById` po stałym
  // napisie nigdy by go nie znalazło. Przewijamy do formularza.
  const addFormRef = useRef<HTMLFormElement>(null);

  const canWrite = can('ipam:write');
  const subnet = data?.subnet;
  const addresses = subnet?.addresses ?? [];

  // Co zniknie razem z podsiecią — dwie liczby, dwa różne źródła.
  //
  // Adresy: `addresses.length` — dokładnie te wiersze, które użytkownik
  // widzi w tabeli wyżej (`SubnetDetail` nie niesie `addressCount`, ale
  // niesie całą listę adresów).
  //
  // Przypisania: `applicationCount` z listy katalogu — jedyna liczba
  // liczona po frontendzie tak samo, jak kaskada liczy w bazie (adresy
  // z co najmniej jednym żywym przypisaniem). Statusy NIE są jej
  // zamiennikiem: `setApplicationIpAddresses` nie dotyka statusu (patrz
  // komentarz `releaseIpAddressesForApplication` — „przypisanie niczego
  // nie zmienia w statusie"), więc adres z przypisaniem może stać
  // `FREE`, a `IN_USE` bywa ręczną adnotacją bez żadnego właściciela.
  // `useSubnets` dzieli zapytanie z katalogiem (ten sam klucz, ten sam
  // cache), więc dla wejścia z listy nie ma tu dodatkowego ruchu sieci.
  const { data: katalog } = useSubnets();
  const podsumowanie = katalog?.subnets.find((s) => s.id === id);
  const znikaPrzypisania =
    addresses.length === 0 ? 0 : podsumowanie?.applicationCount;

  const handleDeleteSubnet = async () => {
    if (!id) return;
    await removeSubnet.mutateAsync(id);
    navigate('/ipam', { replace: true });
  };

  const submitAddress = async (event: FormEvent) => {
    event.preventDefault();
    if (!isIpv4(address.trim())) {
      setAddressError('Podaj poprawny adres IPv4, np. 10.20.1.15.');
      return;
    }
    setAddressError(undefined);
    await createAddress.mutateAsync({ address: address.trim() });
    setAddress('');
  };

  if (isLoading) return <Spinner label="Ładowanie podsieci…" />;

  if (error || !subnet) {
    return (
      <>
        <PageHeader
          title="Nie znaleziono podsieci"
          back={{ to: '/ipam', label: 'Wróć do katalogu' }}
        />
        <ErrorMessage error={error} onRetry={() => refetch()} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={subnet.name}
        description={
          `${subnet.cidr} · VLAN ${subnet.vlan ?? '—'} · ` +
          `${addresses.length} ${addresses.length === 1 ? 'adres' : 'adresów'}`
        }
        back={{ to: '/ipam', label: 'Wróć do katalogu' }}
        actions={
          <>
            {canWrite && (
              <Link to={`/ipam/${subnet.id}/edycja`}>
                <Button variant="secondary">
                  <IconPencil className="size-4" />
                  Edytuj
                </Button>
              </Link>
            )}
            {canWrite && (
              <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
                <IconTrash className="size-4" />
                Usuń
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-5">
        <section className="card-section">
          <div className="card-section-header">
            <span className="section-icon tone-info">
              <IconInfo />
            </span>
            <h2 className="section-title">Informacje o podsieci</h2>
          </div>

          <div className="card-section-body">
            <dl className="space-y-3">
              <div>
                <dt className="field-label">Zakres CIDR</dt>
                <dd className="field-value font-mono">{subnet.cidr}</dd>
              </div>
              <div>
                <dt className="field-label">VLAN</dt>
                <dd className="field-value">
                  {subnet.vlan ?? 'nie przypisano'}
                </dd>
              </div>
              <div>
                <dt className="field-label">Lokalizacja</dt>
                <dd className="field-value">
                  {subnet.location ?? 'nie uzupełniono'}
                </dd>
              </div>
              <div>
                <dt className="field-label">Opis</dt>
                <dd className="card-text whitespace-pre-wrap">
                  {subnet.description ?? 'nie uzupełniono'}
                </dd>
              </div>
              <div>
                <dt className="field-label">Ostatnia zmiana</dt>
                <dd className="field-value">{formatDateTime(subnet.updatedAt)}</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="card-section">
          <div className="card-section-header">
            <h2 className="section-title">Adresy</h2>
          </div>

          {addresses.length === 0 ? (
            <EmptyState
              title="Brak adresów w tej podsieci"
              description="Dodaj pierwszy adres ręcznie — skaner uzupełnia je później."
              action={
                canWrite && (
                  <Button
                    onClick={() =>
                      addFormRef.current?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center',
                      })
                    }
                  >
                    <IconPlus className="size-4" />
                    Dodaj adres
                  </Button>
                )
              }
            />
          ) : (
            <AddressTable
              addresses={addresses}
              onDelete={canWrite ? (a) => setAddressToDelete(a) : undefined}
              busyId={removeAddress.isPending ? (addressToDelete?.id ?? null) : null}
            />
          )}

          {/* Formularz tylko dla zapisujących — gość widzi listę, ale nie
              możliwość jej rozszerzenia. */}
          {canWrite && (
            <form
              ref={addFormRef}
              onSubmit={submitAddress}
              noValidate
              className="flex flex-wrap items-start gap-3 border-t border-line px-5 py-4"
            >
              <TextInput
                label="Nowy adres IP"
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setAddressError(undefined);
                }}
                error={addressError}
                className="w-56"
                placeholder="10.20.1.15"
                maxLength={18}
                autoComplete="off"
              />
              <Button type="submit" loading={createAddress.isPending} className="mt-6">
                <IconPlus className="size-4" />
                Dodaj adres
              </Button>
              <p className="mt-7 max-w-sm meta-text">
                Adres musi leżeć w zakresie {subnet.cidr} i być adresem
                hosta — serwer odrzuci adres sieciowy i rozgłoszeniowy.
              </p>
            </form>
          )}

          <ErrorMessage error={createAddress.error} className="mx-5 mb-4" />
        </section>
      </div>

      {/* ─── Potwierdzenie usunięcia podsieci ─────────────────── */}
      {/*
        Okno musi pokazać, co zniknie razem z podsiecią. Usunięcie
        jest twarde i kaskadowe (`onDelete: Cascade` ginie razem
        z podsiecią każdy adres i każde jego przypisanie do
        aplikacji), więc bez tych liczb użytkownik kasuje coś,
        czego nie odwróci.
      */}
      <Modal
        open={confirmingDelete}
        size="sm"
        title="Usunąć podsieć?"
        description="Usunięcie jest trwałe — nie da się go cofnąć."
        onClose={() => setConfirmingDelete(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
              Anuluj
            </Button>
            <Button
              variant="danger"
              loading={removeSubnet.isPending}
              onClick={handleDeleteSubnet}
            >
              <IconTrash className="size-4" />
              Usuń podsieć
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">
          Zniknie podsieć{' '}
          <strong className="font-semibold text-fg">{subnet.name}</strong> (
          {subnet.cidr}) razem ze wszystkim, co do niej należy:
        </p>

        <ul className="mt-3 space-y-1.5 text-sm text-fg-muted">
          <li className="flex items-baseline gap-2">
            <span className="tabular-nums font-semibold text-fg">
              {addresses.length}
            </span>
            <span>
              {addresses.length === 1 ? 'adres IP' : 'adresów IP'} wraz
              z opisami
            </span>
          </li>
          <li className="flex items-baseline gap-2">
            {znikaPrzypisania === undefined ? (
              <span>Liczba adresów z przypisaniami właśnie się wczytuje…</span>
            ) : (
              <>
                <span className="tabular-nums font-semibold text-fg">
                  {znikaPrzypisania}
                </span>
                <span>
                  {znikaPrzypisania === 1
                    ? 'adres jest przypisany do aplikacji — przypisanie zniknie razem z nim'
                    : 'adresy są przypisane do aplikacji — przypisania znikną razem z nimi'}
                </span>
              </>
            )}
          </li>
        </ul>

        {addresses.length === 0 && (
          <p className="mt-3 text-sm text-fg-muted">
            Podsieć jest pusta — nie zniknie żaden adres.
          </p>
        )}

        <p className="mt-3 text-sm text-fg-muted">
          Wpis w dzienniku zdarzeń zostanie, ale samej podsieci nie da się
          już odtworzyć.
        </p>

        <ErrorMessage error={removeSubnet.error} className="mt-3" />
      </Modal>

      <AddressDeleteModal
        address={addressToDelete}
        subnetName={subnet.name}
        pending={removeAddress.isPending}
        error={removeAddress.error}
        onClose={() => setAddressToDelete(null)}
        onConfirm={async () => {
          if (!addressToDelete) return;
          await removeAddress.mutateAsync(addressToDelete.id);
          setAddressToDelete(null);
        }}
      />
    </>
  );
}