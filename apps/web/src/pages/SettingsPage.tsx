import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../lib/auth';
import {
  useDeleteDemoData,
  useDemoMode,
  useSetDemoMode,
} from '../lib/queries';
import { PageHeader } from '../components/layout/AppLayout';
import { Button, buttonClass } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { ErrorMessage } from '../components/ui/Feedback';
import { IconGear, IconHistory, IconTrash } from '../components/ui/icons';

/**
 * Ustawienia systemowe — zakładka „System" sekcji.
 *
 * Dane demonstracyjne to jedyne miejsce w aplikacji, gdzie operacja
 * dotyczy całej bazy zamiast pojedynczego rekordu, więc wymaga
 * `settings:write`. Pozostałe zakładki sekcji (użytkownicy, dziennik)
 * mają własne, słabsze bramki — patrz `SettingsLayout`.
 */
export function SettingsPage() {
  const { can } = useAuth();
  const stan = useDemoMode();
  const ustaw = useSetDemoMode();
  const kasuj = useDeleteDemoData();

  const [potwierdzenie, setPotwierdzenie] = useState(false);

  const dane = stan.data;
  const liczba = dane?.recordCount ?? 0;

  return (
    <>
      <PageHeader
        title="Ustawienia"
        description="Konfiguracja rejestru. Widoczna tylko dla super administratora."
      />

      <section className="card-section mb-5">
        <div className="card-section-header">
          <span className="section-icon tone-violet">
            <IconGear />
          </span>
          <h2 className="section-title">Dane demonstracyjne</h2>
        </div>

        <div className="card-section-body">
          {stan.isError ? (
            <ErrorMessage
              error={stan.error}
              onRetry={() => void stan.refetch()}
            />
          ) : !dane ? (
            <p className="text-sm text-fg-muted">Wczytywanie…</p>
          ) : (
            <div className="space-y-6">
              {/* Przełącznik */}
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <label
                    htmlFor="demo-mode"
                    className="block text-sm font-medium text-fg"
                  >
                    Tryb demo
                  </label>
                  <p className="mt-0.5 max-w-prose text-sm text-fg-muted">
                    Przykładowe aplikacje wracają przy każdym starcie
                    kontenera, dopóki tryb jest włączony. Warto wyłączyć
                    przed wprowadzeniem prawdziwych danych — inaczej
                    przykładowe rekordy wrócą obok nich.
                  </p>

                  {dane.source === 'env' && (
                    <p className="mt-1 max-w-prose text-xs text-fg-subtle">
                      Stan pochodzi ze zmiennej{' '}
                      <code className="font-mono">SEED_DEMO_APPS</code> —
                      dopóki nie zmienisz przełącznika, decyzja z pliku
                      będzie obowiązywać także po restarcie.
                    </p>
                  )}
                </div>

                <button
                  id="demo-mode"
                  type="button"
                  role="switch"
                  aria-checked={dane.enabled}
                  disabled={ustaw.isPending || !can('settings:write')}
                  onClick={() => ustaw.mutate(!dane.enabled)}
                  className={[
                    'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                    'disabled:cursor-not-allowed disabled:opacity-60',
                    dane.enabled
                      ? 'bg-brand-600'
                      : 'bg-surface-3 ring-1 ring-line-strong ring-inset',
                  ].join(' ')}
                >
                  <span
                    aria-hidden="true"
                    className={[
                      'absolute top-0.5 size-5 rounded-full bg-white shadow-sm',
                      'transition-[left]',
                      dane.enabled ? 'left-5.5' : 'left-0.5',
                    ].join(' ')}
                  />
                </button>
              </div>

              <ErrorMessage error={ustaw.error} />

              {/* Kasowanie danych */}
              <div className="flex flex-wrap items-start justify-between gap-4 border-t border-line pt-5">
                <div className="min-w-0">
                  <p className="block text-sm font-medium text-fg">
                    Dane w bazie
                  </p>
                  <p className="mt-0.5 max-w-prose text-sm text-fg-muted">
                    {liczba === 0
                      ? 'W bazie nie ma przykładowych rekordów.'
                      : `W bazie jest ${liczba} przykładowych rekordów.` +
                        ' Usunięcie kasuje je na zawsze — wpis trafi' +
                        ' do dziennika zdarzeń. Prawdziwe dane nie' +
                        ' zostaną naruszone.'}
                  </p>
                  {dane.enabled && liczba > 0 && (
                    <p className="mt-1 max-w-prose text-xs text-fg-subtle">
                      Skasowane dane wrócą przy następnym starcie
                      kontenera, dopóki tryb demo jest włączony. Wyłącz
                      przełącznik powyżej, jeśli mają zniknąć na stałe.
                    </p>
                  )}
                </div>

                <Button
                  variant="danger"
                  disabled={liczba === 0 || kasuj.isPending}
                  onClick={() => setPotwierdzenie(true)}
                  className="shrink-0"
                >
                  <IconTrash className="size-4" />
                  Usuń dane demonstracyjne
                </Button>
              </div>

              <ErrorMessage error={kasuj.error} />
            </div>
          )}
        </div>
      </section>

      <section className="card-section mb-5">
        <div className="card-section-header">
          <span className="section-icon tone-info">
            <IconHistory />
          </span>
          <h2 className="section-title">Dziennik zdarzeń</h2>
        </div>

        <div className="card-section-body">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-fg">
                Historia operacji w systemie
              </div>
              <p className="mt-1 max-w-prose text-xs text-fg-muted">
                Zapis kto, co i kiedy zmienił — z dokładną różnicą przed i po
                edycji, filtrowaniem po encji, akcji i użytkowniku.
              </p>
            </div>

            <Link
              to="/ustawienia/dziennik"
              className={`${buttonClass('secondary')} shrink-0`}
            >
              <IconHistory className="size-4" />
              Otwórz dziennik zdarzeń
            </Link>
          </div>
        </div>
      </section>

      <Modal
        open={potwierdzenie}
        onClose={() => setPotwierdzenie(false)}
        title="Usunąć dane demonstracyjne?"
        description={`Zostanie usuniętych ${liczba} przykładowych rekordów. Operacji nie da się cofnąć — przywrócenie wymaga włączenia trybu demo i restartu kontenera.`}
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setPotwierdzenie(false)}
            >
              Anuluj
            </Button>
            <Button
              variant="danger"
              loading={kasuj.isPending}
              onClick={() => {
                kasuj.mutate(undefined, {
                  onSettled: () => setPotwierdzenie(false),
                });
              }}
            >
              <IconTrash className="size-4" />
              Usuń {liczba} rekordów
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">
          Skasowane zostaną wyłącznie rekordy oznaczone jako
          demonstracyjne. Wpisy dodane przez użytkowników pozostaną
          nietknięte.
        </p>
        {dane?.enabled && (
          <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
            Tryb demo jest włączony, więc po restarcie kontenera dane
            pojawią się ponownie.
          </p>
        )}
      </Modal>
    </>
  );
}