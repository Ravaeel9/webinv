import { useState } from 'react';
import {
  useGlpiSettings,
  useGlpiTest,
  useSetGlpiSettings,
} from '../lib/queries';
import {
  ACCESS_LEVEL_LABELS,
  type GlpiAccessLevel,
  type GlpiSettingsInput,
} from '../types';
import { PageHeader } from '../components/layout/AppLayout';
import { Button } from '../components/ui/Button';
import { ErrorMessage } from '../components/ui/Feedback';
import { Select, TextInput } from '../components/ui/Field';
import { GlpiImportModal } from '../components/glpi/GlpiImportModal';
import { useToast } from '../components/ui/Toast';
import {
  IconDownload,
  IconLock,
  IconNetwork,
  IconPlug,
  IconSave,
  IconUser,
} from '../components/ui/icons';

/**
 * Zakładka „GLPI" — konfiguracja połączenia i import.
 *
 * Sekrety (client secret, hasło OAuth, tokeny) nigdy nie wracają
 * z API: GET pokazuje flagi `has*`, a puste pole przy zapisie znaczy
 * „zostaw poprzednie". Dlatego pola sekretów mają placeholder
 * „•••• (ustawiono)" zamiast wartości.
 *
 * Kontener czeka na stan z serwera; ciało startuje raz z tymi
 * wartościami (inicjalizacja przez `useState`) — bez efektu
 * „wczytaj raz", który synchronicznie ustawiałby stan w efekcie.
 */
export function GlpiSettingsPage() {
  const ustawienia = useGlpiSettings();
  const dane = ustawienia.data;

  return (
    <>
      <PageHeader
        title="Ustawienia"
        description="Integracja z GLPI — konfiguracja połączenia i import osób, oprogramowania i dostępów."
      />

      {ustawienia.isError && (
        <ErrorMessage error={ustawienia.error} onRetry={() => void ustawienia.refetch()} />
      )}

      {!dane ? (
        <p className="text-sm text-fg-muted">Wczytywanie…</p>
      ) : (
        <GlpiSettingsBody dane={dane} />
      )}
    </>
  );
}

/**
 * Ciało zakładki — formularz i sekrety startują tylko raz, z danymi,
 * które przyszły z zapytaniem kontenera.
 */
function GlpiSettingsBody({ dane }: { dane: NonNullable<ReturnType<typeof useGlpiSettings>['data']> }) {
  const zapisz = useSetGlpiSettings();
  const test = useGlpiTest();
  const toast = useToast();

  const [formularz, setFormularz] = useState<GlpiSettingsInput>({
    apiUrl: dane.apiUrl,
    clientId: dane.clientId,
    login: dane.login,
    legacyUrl: dane.legacyUrl,
    parentGroup: dane.parentGroup,
    accessLevel: dane.accessLevel,
  });
  const [sekrety, setSekrety] = useState<{
    clientSecret: string;
    haslo: string;
    userToken: string;
    appToken: string;
  }>({ clientSecret: '', haslo: '', userToken: '', appToken: '' });
  const [importOtwarty, setImportOtwarty] = useState(false);

  const zmien = (pole: keyof GlpiSettingsInput, wartosc: string) =>
    setFormularz((poprzedni) => ({ ...poprzedni, [pole]: wartosc }));

  const zapiszWszystko = () => {
    // Puste pole sekretu = „nie ruszaj" — nie wysyłamy go wcale.
    zapisz.mutate(
      {
        ...formularz,
        ...(sekrety.clientSecret ? { clientSecret: sekrety.clientSecret } : {}),
        ...(sekrety.haslo ? { haslo: sekrety.haslo } : {}),
        ...(sekrety.userToken ? { userToken: sekrety.userToken } : {}),
        ...(sekrety.appToken ? { appToken: sekrety.appToken } : {}),
      },
      {
        onSuccess: () => {
          setSekrety({ clientSecret: '', haslo: '', userToken: '', appToken: '' });
          toast.pokaz('Ustawienia GLPI zapisane.');
        },
      },
    );
  };

  return (
    <>
      {/*
        Formularz podzielony na sekcje według źródła poświadczeń:
        serwer → klient OAuth → konto techniczne → legacy API →
        mapowanie importu. Sekcja legacy jest potrzebna wyłącznie
        do importu dostępów z grup — reszta integracji działa bez niej.
      */}
      <section className="card-section mb-5">
        <div className="card-section-header">
          <span className="section-icon tone-info">
            <IconPlug />
          </span>
          <h2 className="section-title">Serwer GLPI (API v2.3)</h2>
        </div>
        <div className="card-section-body">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Adres API GLPI"
              required
              hint="Adres nowego API GLPI — z niego bierzemy osoby i oprogramowanie."
              placeholder="http://glpi.firma.local/api.php"
              value={formularz.apiUrl}
              onChange={(e) => zmien('apiUrl', e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="card-section mb-5">
        <div className="card-section-header">
          <span className="section-icon tone-info">
            <IconLock />
          </span>
          <h2 className="section-title">Klient OAuth</h2>
        </div>
        <div className="card-section-body">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Client ID"
              required
              hint="Z Konfiguracja → Klienci OAuth w GLPI (grant Password, zakres api)."
              value={formularz.clientId}
              onChange={(e) => zmien('clientId', e.target.value)}
            />
            <TextInput
              label="Client secret"
              type="password"
              autoComplete="off"
              placeholder={dane.hasClientSecret ? '•••• (ustawiono — zostaw puste, aby nie zmieniać)' : ''}
              value={sekrety.clientSecret}
              onChange={(e) => setSekrety((s) => ({ ...s, clientSecret: e.target.value }))}
            />
          </div>
        </div>
      </section>

      <section className="card-section mb-5">
        <div className="card-section-header">
          <span className="section-icon tone-violet">
            <IconUser />
          </span>
          <h2 className="section-title">Konto techniczne synchronizacji</h2>
        </div>
        <div className="card-section-body">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Login"
              required
              hint="Konto GLPI, w imieniu którego integracja się loguje (OAuth grant Password). Najlepiej dedykowane, tylko do odczytu."
              value={formularz.login}
              onChange={(e) => zmien('login', e.target.value)}
            />
            <TextInput
              label="Hasło"
              type="password"
              autoComplete="new-password"
              placeholder={dane.hasPassword ? '•••• (ustawiono — zostaw puste, aby nie zmieniać)' : ''}
              value={sekrety.haslo}
              onChange={(e) => setSekrety((s) => ({ ...s, haslo: e.target.value }))}
            />
          </div>
        </div>
      </section>

      <section className="card-section mb-5">
        <div className="card-section-header">
          <span className="section-icon tone-warn">
            <IconNetwork />
          </span>
          <h2 className="section-title">Legacy REST API (tylko import dostępów)</h2>
        </div>
        <div className="card-section-body space-y-4">
          <p className="max-w-prose text-sm text-fg-muted">
            Potrzebne wyłącznie, gdy importujesz dostępy z grup — nowe API
            nie wystawia członkostw. Jeśli importujesz tylko osoby
            i oprogramowanie, ta sekcja może zostać pusta.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Adres legacy API"
              hint="Jak w panelu GLPI (Konfiguracja → API), np. http://glpi.firma.local/api.php/v1 — równoważnie http://glpi.firma.local/apirest.php."
              placeholder="http://glpi.firma.local/api.php/v1"
              value={formularz.legacyUrl}
              onChange={(e) => zmien('legacyUrl', e.target.value)}
            />
            <TextInput
              label="Token osobisty"
              type="password"
              autoComplete="off"
              hint="Z profilu konta technicznego w GLPI (zakładka API)."
              placeholder={dane.hasUserToken ? '•••• (ustawiono — zostaw puste, aby nie zmieniać)' : ''}
              value={sekrety.userToken}
              onChange={(e) => setSekrety((s) => ({ ...s, userToken: e.target.value }))}
            />
            <TextInput
              label="App-Token"
              type="password"
              autoComplete="off"
              hint="Z klienta API w Konfiguracja → API, jeśli legacy wymaga app-token."
              placeholder={dane.hasAppToken ? '•••• (ustawiono — zostaw puste, aby nie zmieniać)' : ''}
              value={sekrety.appToken}
              onChange={(e) => setSekrety((s) => ({ ...s, appToken: e.target.value }))}
            />
          </div>
        </div>
      </section>

      <section className="card-section mb-5">
        <div className="card-section-header">
          <span className="section-icon tone-violet">
            <IconDownload />
          </span>
          <h2 className="section-title">Mapowanie importu</h2>
        </div>
        <div className="card-section-body">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Grupa nadrzędna dostępów"
              required
              hint="Grupa w GLPI, której podrzędne grupy odpowiadają aplikacjom (np. Access → VPN, Mail)."
              value={formularz.parentGroup}
              onChange={(e) => zmien('parentGroup', e.target.value)}
            />
            <Select
              label="Poziom dostępu przy imporcie"
              value={formularz.accessLevel}
              onChange={(e) => zmien('accessLevel', e.target.value as GlpiAccessLevel)}
            >
              {Object.entries(ACCESS_LEVEL_LABELS).map(([wartosc, label]) => (
                <option key={wartosc} value={wartosc}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </section>

      <section className="card-section mb-5">
        <div className="card-section-body">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={zapiszWszystko}
              loading={zapisz.isPending}
              disabled={!formularz.apiUrl || !formularz.clientId || !formularz.login}
            >
              <IconSave className="size-4" />
              Zapisz ustawienia
            </Button>

            <Button
              variant="secondary"
              loading={test.isPending}
              disabled={!dane.skonfigurowano}
              onClick={() =>
                test.mutate(undefined, {
                  onSuccess: (wynik) => toast.pokaz(wynik.komunikat),
                })
              }
            >
              <IconPlug className="size-4" />
              Testuj połączenie
            </Button>

            <Button
              variant="secondary"
              disabled={!dane.skonfigurowano}
              onClick={() => setImportOtwarty(true)}
            >
              <IconDownload className="size-4" />
              Importuj z GLPI
            </Button>
          </div>

          <div className="mt-3">
            <ErrorMessage error={zapisz.error} />
            <ErrorMessage error={test.error} />
          </div>
        </div>
      </section>

      <section className="card-section mb-5">
        <div className="card-section-header">
          <span className="section-icon tone-violet">
            <IconDownload />
          </span>
          <h2 className="section-title">Co importuje integracja</h2>
        </div>
        <div className="card-section-body">
          <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">
            <li>
              <strong className="text-fg">Osoby</strong> — użytkownicy GLPI
              trafiają do katalogu osób (tożsamość: e-mail). Brak e-maila
              w GLPI = wiersz pomijany z powodem.
            </li>
            <li>
              <strong className="text-fg">Oprogramowanie</strong> — programy
              z GLPI stają się szkicami aplikacji: nazwa i najnowsza wersja,
              reszta pól do ręcznego uzupełnienia.
            </li>
            <li>
              <strong className="text-fg">Dostępy</strong> — podrzędne grupy
              grupy nadrzędnej stają się aplikacjami, a ich członkowie
              dostają wiersze w macierzy uprawnień z wybranym poziomem.
            </li>
          </ul>
          <p className="mt-3 max-w-prose text-xs text-fg-subtle">
            Import tworzy wyłącznie nowe rekordy — istniejące osoby,
            aplikacje i dostępy pozostają nietknięte. Każdy import to jeden
            wpis w dzienniku zdarzeń.
          </p>
        </div>
      </section>

      <GlpiImportModal open={importOtwarty} onClose={() => setImportOtwarty(false)} />
    </>
  );
}
