/**
 * Stan formularza aplikacji — wydzielony z `ApplicationFormPage`.
 *
 * Odpowiada za cztery rzeczy, które wcześniej były sypnięte po ciele
 * strony: wartości pól, błędy pól, blokadę niezapisanych zmian
 * („brudny") i szkic nowej aplikacji w `localStorage`.
 *
 * Start przez `useState(() => …)` zamiast efektu wczytującego dane
 * raz po montażu: dane z serwera doczeka strona przed montażem
 * (`ApplicationFormPage`), więc efekt „wczytaj raz" nie jest tu
 * potrzebny — a bez niego nie ma synchronicznego ustawiania stanu
 * w efekcie, o co zaczepia `react-hooks/set-state-in-effect`.
 */
import { useEffect, useState } from 'react';
import { useDirtyGuard } from '../ui/DirtyGuard';
import { bramaZmian, type BramaZmian } from '../../lib/dirty-guard';
import {
  EMPTY,
  SZKIC_KLUCZ,
  odczytajSzkic,
  usuńSzkic,
  validateApplicationForm,
  zapiszSzkic,
  type FormState,
} from '../../lib/application-form';

type ListaIds = 'adminIds' | 'environmentIds';

export function useApplicationFormState(opcje: {
  tryb: 'create' | 'edit';
  /** W trybie edycji — wartości zsynchronizowane z rekordem API. */
  wartości: FormState;
}) {
  const { tryb, wartości } = opcje;

  /**
   * Jedno obliczenie startowe. Prywatny szkic leży tylko w trybie
   * tworzenia: przywrócenie go w edycji nadpisałoby stan z bazy
   * starszymi danymi i wyglądało jak błąd. Uszkodzony szkic kasuje się
   * sam (`odczytajSzkic`) i jest tylko powrotem do pustego formularza.
   */
  const [start] = useState(() => {
    if (tryb === 'edit') return { wartości, szkic: false } as const;
    const szkic = odczytajSzkic();
    if (!szkic) return { wartości, szkic: false } as const;
    return {
      wartości: { ...szkic, ipAddressIds: [] } as FormState,
      szkic: true,
    } as const;
  });

  const [form, setForm] = useState<FormState>(start.wartości);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [szkicPrzywrócony, setSzkicPrzywrócony] = useState(start.szkic);

  // ─── Zabezpieczenie niezapisanych zmian ─────────────────────
  //
  // `brama` robi się brudna przy pierwszej ręcznej zmianie pola
  // (`set`/`toggle`) i gaśnie po udanym zapisie. Zwykłe domknięcie,
  // nie `useState` — router ocenia nawigację predykatem czytanym
  // synchronicznie, poza cyklem renderowania (patrz `DirtyGuard`).
  const [brama] = useState<BramaZmian>(() => bramaZmian());
  const dirtyGuard = useDirtyGuard(brama.czyBrudny);

  // Autosave szkicu: po 500 ms ciszy zapisuje aktualny stan. Tylko
  // w trybie tworzenia — szkic w edycji nadpisałby stan z bazy
  // starszymi danymi i wyglądał jak błąd.
  useEffect(() => {
    if (tryb === 'edit' || !brama.czyBrudny()) return;
    const timer = window.setTimeout(() => {
      zapiszSzkic(form);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [form, tryb, brama]);

  const odrzućSzkic = () => {
    usuńSzkic();
    setForm({ ...EMPTY });
    setSzkicPrzywrócony(false);
    brama.zwolnij();
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    brama.oznacz();
    // Błąd pola znika, gdy user zaczyna poprawiać
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const toggle = (key: ListaIds, value: string) => {
    setForm((prev) => {
      const list = prev[key];
      return {
        ...prev,
        [key]: list.includes(value)
          ? list.filter((v) => v !== value)
          : [...list, value],
      };
    });
    brama.oznacz();
  };

  /** Podmienia błędy i zwraca `true`, gdy formularz jest kompletny. */
  const validate = (): boolean => {
    const next = validateApplicationForm(form);
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  /** Po udanym zapisie: blokada wyjścia i szkic przestają być aktualne. */
  const oczyszczPoZapisie = () => {
    // Synchronicznie, przed `navigate()` — router ocenia nawigację
    // predykatem z ostatniego rendera, więc stan Reacta tu nie wystarcza.
    brama.zwolnij();
    localStorage.removeItem(SZKIC_KLUCZ);
  };

  return {
    form,
    errors,
    dirtyGuard,
    szkicPrzywrócony,
    odrzućSzkic,
    set,
    toggle,
    validate,
    oczyszczPoZapisie,
  };
}
