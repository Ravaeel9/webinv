import { Button } from '../ui/Button';
import { ErrorMessage } from '../ui/Feedback';
import { Modal } from '../ui/Modal';
import { IconTrash } from '../ui/icons';
import { IP_STATUS_LABELS, type IpAddress } from '../../types';

/**
 * Potwierdzenie usunięcia pojedynczego adresu.
 *
 * Osobny komponent, bo okno pojawia się w dwóch miejscach — w
 * drill-downie katalogu i na karcie podsieci — a treść musi być
 * ta sama: zastrzeżenie o przypisaniach. API odmawia usunięcia
 * adresu przypisanego do aplikacji (`ConflictException`), więc bez
 * tego zdania użytkownik klika „Usuń", dostaje błąd i nie wie,
 * co właściwie zrobić.
 *
 * Komponent nie mutuje — wołający przekazuje `onConfirm`, który
 * zwraca obietnicę. Dzięki temu rodzic decyduje, kiedy zamykać okno
 * (po sukcesie, nie po kliknięciu).
 */
export function AddressDeleteModal({
  address,
  subnetName,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  address: IpAddress | null;
  /** Nazwa podsieci, z której kasujemy — w komunikacie, nie w nagłówku. */
  subnetName?: string;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <Modal
      open={address !== null}
      size="sm"
      title="Usunąć adres?"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Anuluj
          </Button>
          <Button variant="danger" loading={pending} onClick={onConfirm}>
            <IconTrash className="size-4" />
            Usuń
          </Button>
        </>
      }
    >
      <p className="text-sm text-fg-muted">
        Adres{' '}
        <strong className="font-mono font-semibold text-fg">
          {address?.address}
        </strong>{' '}
        ({address ? IP_STATUS_LABELS[address.status] : ''}) zniknie z katalogu
        razem z opisem
        {subnetName ? ` podsieci ${subnetName}` : ''}. Jeśli jest przypisany do
        aplikacji, API odmówi — najpierw zdejmij przypisanie na karcie
        aplikacji.
      </p>

      {/* `ErrorMessage` sam nic nie rysuje dla pustego błędu, więc
          niepotrzebny jest tu warunek — a `error` jest typu `unknown`. */}
      <ErrorMessage error={error} className="mt-3" />
    </Modal>
  );
}
