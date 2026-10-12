import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useCreateSubnet, useSubnet, useUpdateSubnet } from '../lib/queries';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/layout/AppLayout';
import { Button } from '../components/ui/Button';
import { Select, Textarea, TextInput } from '../components/ui/Field';
import { ErrorMessage, Spinner } from '../components/ui/Feedback';
import { IconCheck } from '../components/ui/icons';
import {
  SUBNET_COLOR_NAMES,
  SUBNET_COLORS,
  type SubnetDetail,
} from '../types';

/**
 * Wstępna kontrola formatu CIDR.
 *
 * To **nie** jest walidacja — jest tylko szybki komunikat pod polem,
 * żeby użytkownik nie musiał czekać na serwer, żeby zobaczyć literówkę.
 * Prawdziwe sprawdzenia są w API: kolizja zakresu z inną podsiecią
 * (`409`), hosty wypadające poza nowy zakres przy zmianie CIDR
 * (`400`), ograniczenie długości kolumny. Komunikaty z API
 * pokazujemy wprost przez `ErrorMessage` — to jedyne miejsce, w którym
 * użytkownik dowiaduje się o tych regułach.
 */
const CIDR_SHAPE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

function cidrShapeError(value: string): string | null {
  const m = CIDR_SHAPE.exec(value.trim());
  if (!m) {
    return 'Wpisz adres sieci w formacie CIDR, np. 10.20.0.0/16.';
  }
  const oktety = m.slice(1, 5);
  if (oktety.some((o) => Number(o) > 255)) {
    return 'Oktet adresu sieci musi mieścić się w zakresie 0–255.';
  }
  const prefiks = Number(m[5]);
  if (prefiks < 0 || prefiks > 32) {
    return 'Długość maski musi mieścić się w zakresie 0–32.';
  }
  return null;
}

/** Pusty formularz — wartości domyślne zgodne z defaultami schematu Prisma. */
const EMPTY = {
  name: '',
  cidr: '',
  description: '',
  color: 'slate',
  vlan: '',
  location: '',
};

type FormState = typeof EMPTY;

/** Zamienia rekord API na stan formularza. */
function fromSubnet(subnet: SubnetDetail): FormState {
  return {
    name: subnet.name,
    cidr: subnet.cidr,
    description: subnet.description ?? '',
    color: subnet.color,
    vlan: subnet.vlan === null ? '' : String(subnet.vlan),
    location: subnet.location ?? '',
  };
}

/**
 * Formularz podsieci — jeden komponent dla dodania i edycji.
 *
 * `id` z trasy decyduje, czy to dodanie, czy zmiana; różni je tylko
 * nagłówek, przycisk i to, którą mutację wywołujemy. Dwie osobne
 * strony rozdzieliłyby pola na dwa miejsca do utrzymania.
 */
export function SubnetFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);

  const navigate = useNavigate();
  const { can } = useAuth();

  const { data, isLoading, error: loadError } = useSubnet(id);
  const create = useCreateSubnet();
  const update = useUpdateSubnet(id ?? '');

  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(!isEdit);

  // Wczytujemy dane podsieci do formularza tylko raz — potem użytkownik
  // edytuje lokalny stan, a nie ten z serwera.
  useEffect(() => {
    if (data?.subnet && !loaded) {
      setForm(fromSubnet(data.subnet));
      setLoaded(true);
    }
  }, [data, loaded]);

  const mutation = isEdit ? update : create;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Błąd pola znika, gdy użytkownik zaczyna poprawiać.
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};

    if (!form.name.trim()) next.name = 'Nazwa jest wymagana.';

    const cidrError = cidrShapeError(form.cidr);
    if (cidrError) next.cidr = cidrError;

    if (form.vlan.trim() !== '') {
      const vlan = Number(form.vlan);
      if (!Number.isInteger(vlan) || vlan < 1 || vlan > 4094) {
        next.vlan = 'VLAN musi być liczbą całkowitą w zakresie 1–4094.';
      }
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validate()) {
      const first = document.querySelector('[aria-invalid="true"]');
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const text = (v: string) => (v.trim() === '' ? null : v.trim());

    const payload = {
      name: form.name.trim(),
      cidr: form.cidr.trim(),
      description: text(form.description),
      color: form.color,
      vlan: form.vlan.trim() === '' ? null : Number(form.vlan),
      location: text(form.location),
    };

    try {
      const result = isEdit
        ? await update.mutateAsync(payload)
        : await create.mutateAsync(payload);
      navigate(`/ipam/${result.subnet.id}`, { replace: true });
    } catch (err) {
      // Błędy walidacji z serwera trafiają do `ErrorMessage` nad
      // formularzem; przewijamy do góry, bo komunikat jest tam.
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  if (!can('ipam:write')) {
    return (
      <div className="card mx-auto max-w-lg px-6 py-12 text-center">
        <h1 className="text-base font-semibold text-fg">
          Brak uprawnień
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          Twoja rola pozwala tylko odczytywać katalog podsieci.
        </p>
      </div>
    );
  }

  if (isEdit && isLoading) return <Spinner label="Ładowanie podsieci…" />;

  if (isEdit && loadError) {
    return (
      <>
        <PageHeader
          title="Nie znaleziono podsieci"
          back={{ to: '/ipam', label: 'Wróć do katalogu' }}
        />
        <ErrorMessage error={loadError} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={isEdit ? `Edycja: ${data?.subnet.name ?? ''}` : 'Nowa podsieć'}
        description={
          isEdit
            ? 'Zmiany trafią do dziennika zdarzeń.'
            : 'Pola oznaczone * są wymagane. Resztę możesz uzupełnić później.'
        }
        back={{ to: isEdit ? `/ipam/${id}` : '/ipam', label: 'Anuluj' }}
      />

      {/* Komunikat z API wprost — walidacja kolizji zakresu i objęcia
          adresów żyje tylko na serwerze i tylko on ją zna. */}
      <ErrorMessage error={mutation.error} className="mb-5" />

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <fieldset className="card px-5 py-4">
          <legend className="group-title">Zakres</legend>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Nazwa"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              error={errors.name}
              maxLength={200}
              placeholder="np. Sieć dla produkcji"
            />
            <TextInput
              label="Zakres CIDR"
              required
              value={form.cidr}
              onChange={(e) => set('cidr', e.target.value)}
              error={errors.cidr}
              maxLength={18}
              placeholder="10.20.0.0/16"
              // Podpowiedź, nie walidacja: serwer i tak odrzuci
              // zakres kolidujący z inną podsiecią.
              hint="Adres SIEĆ, nie adres hosta — dla 10.20.1.0–10.20.255.255 wpisz 10.20.0.0/16."
            />
            <TextInput
              label="VLAN"
              type="number"
              value={form.vlan}
              onChange={(e) => set('vlan', e.target.value)}
              error={errors.vlan}
              min={1}
              max={4094}
              placeholder="np. 120"
              hint="Puste pole = brak VLAN-u."
            />
            <TextInput
              label="Lokalizacja"
              value={form.location}
              onChange={(e) => set('location', e.target.value)}
              maxLength={200}
              placeholder="np. serwerownia A, szafa 3"
            />
          </div>
        </fieldset>

        <fieldset className="card px-5 py-4">
          <legend className="group-title">Opis</legend>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Kolor"
              value={form.color}
              onChange={(e) => set('color', e.target.value)}
              hint="Kolor kafelka na liście — pole rozpoznawania, nie status."
            >
              {SUBNET_COLOR_NAMES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>

            <div className="flex items-end pb-2">
              <span
                className="inline-block size-6 rounded-full border border-line"
                style={{ backgroundColor: SUBNET_COLORS[form.color] }}
                aria-hidden="true"
              />
              <span className="ml-2 text-sm text-fg-muted">Podgląd koloru</span>
            </div>

            <Textarea
              label="Notatki"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              maxLength={2000}
              rows={5}
              placeholder="Do czego służy ta podsieć, kto za nią odpowiada…"
            />
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={mutation.isPending}>
            <IconCheck className="size-4" />
            {isEdit ? 'Zapisz zmiany' : 'Dodaj podsieć'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate(isEdit ? `/ipam/${id}` : '/ipam')}
          >
            Anuluj
          </Button>
        </div>
      </form>
    </>
  );
}