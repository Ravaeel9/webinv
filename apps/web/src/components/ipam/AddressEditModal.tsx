import { useState } from 'react';
import { Button } from '../ui/Button';
import { Select, TextInput, Textarea } from '../ui/Field';
import { ErrorMessage } from '../ui/Feedback';
import { Modal } from '../ui/Modal';
import { IconCheck } from '../ui/icons';
import { isIpv4 } from '../../lib/ip';
import { IP_STATUS_LABELS, IP_STATUSES, type IpAddress } from '../../types';

/**
 * Edycja pojedynczego adresu IP — adres, status i opis.
 *
 * Osobny komponent, bo okno pojawia się w dwóch miejscach — na karcie
 * podsieci i w drill-downie katalogu — a treść musi być ta sama
 * (wzorzek `AddressDeleteModal`).
 *
 * Komponent nie mutuje: rodzic przekazuje `onConfirm` zwracający
 * obietnicę, dzięki czemu okno zamyka się po sukcesie, a nie po
 * kliknięciu. `onPayload` oddziela budowanie ładunku od okna — modal nie
 * musi znać `useUpdateAddress`.
 *
 * Pusty opis wysyłamy jako `null`, a nie `''`: DTO zamienia `''` na
 * `undefined`, co w PATCH-u znaczy „nie ruszaj pola" — czyli nie dałoby
 * się wyczyścić opisu.
 */
export function AddressEditModal({
  address,
  subnetName,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  address: IpAddress | null;
  /** Nazwa podsieci — w podpowiedzi pod polem adresu, nie w nagłówku. */
  subnetName?: string;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  /** Buduje ładunek PATCH-a. Osobny props, żeby modal nie znał hooka. */
  onConfirm: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [adres, setAdres] = useState(address?.address ?? '');
  const [status, setStatus] = useState<string>(address?.status ?? 'FREE');
  const [opis, setOpis] = useState(address?.description ?? '');
  const [blad, setBlad] = useState<string | undefined>(undefined);

  // Wybór innego wiersza musi wypełnić formularz nowymi wartościami —
  // bez tego po edycji jednego adresu i otwarciu kolejnego pokazałyby
  // się stare dane, a zapis zniszczyłby nie to, co użytkownik widzi.
  // Start z wartościami pierwszego adresu jest w inicjalizatorach
  // powyżej; tu zostaje tylko śledzenie kolejnych zmian (wzorzec
  // „dostosowania stanu podczas renderu", react.dev).
  const [poprzedniAdres, setPoprzedniAdres] = useState(address);
  if (address !== poprzedniAdres) {
    setPoprzedniAdres(address);
    if (address) {
      setAdres(address.address);
      setStatus(address.status);
      setOpis(address.description ?? '');
      setBlad(undefined);
    }
  }

  const zapisz = async () => {
    const nowyAdres = adres.trim();
    if (!isIpv4(nowyAdres)) {
      setBlad('Podaj poprawny adres IPv4, np. 10.20.1.15.');
      return;
    }
    setBlad(undefined);
    await onConfirm({
      address: nowyAdres,
      status,
      // `null`, nie `''` — patrz opis komponentu.
      description: opis.trim() === '' ? null : opis.trim(),
    });
  };

  return (
    <Modal
      open={address !== null}
      size="md"
      title="Edytuj adres IP"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Anuluj
          </Button>
          <Button loading={pending} onClick={() => void zapisz()}>
            <IconCheck className="size-4" />
            Zapisz
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextInput
          label="Adres IP"
          value={adres}
          onChange={(e) => setAdres(e.target.value)}
          error={blad}
          maxLength={18}
          autoComplete="off"
          hint={
            subnetName
              ? `Adres musi leżeć w zakresie podsieci ${subnetName} i być adresem hosta.`
              : 'Adres musi być adresem hosta, nie sieciowym ani rozgłoszeniowym.'
          }
        />

        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          hint="Status nie musi się zgadzać z przypisaniami do aplikacji."
        >
          {IP_STATUSES.map((s) => (
            <option key={s} value={s}>
              {IP_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>

        <Textarea
          label="Opis"
          value={opis}
          onChange={(e) => setOpis(e.target.value)}
          maxLength={2000}
          placeholder="np. serwer bazy, drukarka w recepcji"
        />
      </div>

      {/* `ErrorMessage` sam nic nie rysuje dla pustego błędu, więc
          niepotrzebny jest tu warunek — a `error` jest typu `unknown`. */}
      <ErrorMessage error={error} className="mt-3" />
    </Modal>
  );
}
