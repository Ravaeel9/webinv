import { useState } from 'react';
import { useCreateVerification, useVerifications } from '../../lib/queries';
import { useAuth } from '../../lib/auth';
import { formatDate } from '../../lib/format';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { TextInput } from '../ui/Field';
import { EmptyState, ErrorMessage, Spinner } from '../ui/Feedback';
import { Modal } from '../ui/Modal';
import { Table, Tbody, Td, Th, Thead } from '../ui/Table';
import { IconShield } from '../ui/icons';
import type { AccessVerificationScope } from '../../types';

/** Etykiety zakresu — są też rozróżnieniem, o który przegląd chodziło. */
const ZAKRES_LABELS: Record<AccessVerificationScope, string> = {
  MATRIX: 'Cała macierz',
  APPLICATION: 'Aplikacja',
  GRANT: 'Pojedynczy dostęp',
};

/**
 * Rejestr przeglądów dostępów — „kiedy dostępy zostały zweryfikowane i przez kogo".
 *
 * Ten sam komponent obsługuje dwa widoki, bo to jedna historia o różnym
 * zawężeniu:
 *
 *  - bez `applicationId` — rejestr całej macierzy na stronie „Uprawnienia";
 *    wpis obejmuje wtedy wszystkie aplikacje (`MATRIX`),
 *  - z `applicationId` — sekcja na karcie aplikacji; wpis obejmuje tę
 *    aplikację (`APPLICATION`).
 *
 * Weryfikujący to zawsze zalogowany użytkownik (z sesji) — nie wybieramy
 * „kto" z listy, bo potwierdzenie cudzym imieniem nie byłoby dowodem.
 */
export function AccessVerificationsSection({
  applicationId,
}: {
  applicationId?: string;
}) {
  const { can } = useAuth();
  const edytowac = can('access:write');
  const { data, isLoading, error } = useVerifications(applicationId);
  const [otwarty, setOtwarty] = useState(false);

  const wpisy = data?.wpisy ?? [];
  // Zakres nowego wpisu wynika z kontekstu sekcji: karta aplikacji
  // weryfikuje aplikację, strona macierzy — całą macierz.
  const scope: 'MATRIX' | 'APPLICATION' = applicationId ? 'APPLICATION' : 'MATRIX';

  return (
    <section className="card mt-4">
      <div className="card-section-header">
        <span className="section-icon tone-info">
          <IconShield />
        </span>
        <h2 className="section-title">Weryfikacje dostępów</h2>
        {edytowac && (
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto"
            onClick={() => setOtwarty(true)}
          >
            {applicationId ? 'Zweryfikuj aplikację' : 'Zweryfikuj'}
          </Button>
        )}
      </div>
      <div className="card-section-body">
        <ErrorMessage error={error} className="mb-3" />
        {isLoading && <Spinner label="Wczytywanie rejestru…" />}
        {!isLoading && wpisy.length === 0 && (
          <EmptyState
            title="Brak wpisów weryfikacji"
            description="Żaden przegląd dostępów nie został jeszcze odnotowany — pierwszy wpis potwierdzi, że zapisane dostępy są aktualne."
            tone="muted"
          />
        )}
        {wpisy.length > 0 && (
          <Table className="min-w-[640px]">
            <Thead>
              <tr>
                <Th className="w-[14%]">Data</Th>
                <Th>Zakres</Th>
                <Th>Objęte</Th>
                <Th>Zweryfikował(a)</Th>
                <Th>Notatka</Th>
              </tr>
            </Thead>
            <Tbody>
              {wpisy.map((wpis) => (
                <tr key={wpis.id} className="table-row-hover">
                  <Td className="whitespace-nowrap text-fg-muted">
                    {formatDate(wpis.verifiedOn)}
                  </Td>
                  <Td>
                    <Badge tone={wpis.scope === 'MATRIX' ? 'violet' : 'neutral'}>
                      {ZAKRES_LABELS[wpis.scope]}
                    </Badge>
                  </Td>
                  <Td>
                    {wpis.application?.name ?? 'wszystkie aplikacje z macierzą'}
                    {wpis.personName && (
                      <span className="text-fg-muted"> — {wpis.personName}</span>
                    )}
                  </Td>
                  <Td className="text-fg-muted">{wpis.actorName ?? '—'}</Td>
                  <Td className="text-fg-muted">{wpis.note ?? '—'}</Td>
                </tr>
              ))}
            </Tbody>
          </Table>
        )}
      </div>
      {otwarty && (
        <WeryfikacjaModal
          scope={scope}
          applicationId={applicationId}
          onClose={() => setOtwarty(false)}
        />
      )}
    </section>
  );
}

/**
 * Formularz nowego wpisu. Data domyślnie dzisiejsza (przegląd odnotowuje
 * się w dniu przeglądu), ale pozwala rozliczyć się wstecz — serwer odrzuca
 * daty z przyszłości.
 */
function WeryfikacjaModal({
  scope,
  applicationId,
  onClose,
}: {
  scope: 'MATRIX' | 'APPLICATION';
  applicationId?: string;
  onClose: () => void;
}) {
  const zapisz = useCreateVerification();
  const [data, setData] = useState(dzis());
  const [notatka, setNotatka] = useState('');
  const [blad, setBlad] = useState<unknown>(null);

  const zapiszWpis = async () => {
    try {
      await zapisz.mutateAsync({
        scope,
        applicationId,
        verifiedOn: data,
        note: notatka || undefined,
      });
      onClose();
    } catch (wyjatek) {
      setBlad(wyjatek);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={applicationId ? 'Zweryfikuj dostęp do aplikacji' : 'Zweryfikuj macierz uprawnień'}
      description={
        applicationId
          ? 'Wpis potwierdza, że zapisane dostępy do tej aplikacji były przeglądane i są aktualne.'
          : 'Wpis potwierdza, że zapisane dostępy we wszystkich aplikacjach z macierzą były przeglądane i są aktualne.'
      }
    >
      <div className="grid gap-3">
        <TextInput
          label="Data weryfikacji"
          type="date"
          value={data}
          onChange={(e) => setData(e.target.value)}
        />
        <TextInput
          label="Notatka (opcjonalnie)"
          value={notatka}
          placeholder="np. przegląd półroczny, rozmowa z właścicielem"
          onChange={(e) => setNotatka(e.target.value)}
        />
      </div>
      <p className="mt-3 text-xs text-fg-subtle">
        Weryfikującym zostaje odnotowany zalogowany użytkownik.
      </p>
      {/* Ternary zamiast `&&`: `blad` jest `unknown`, a wyrażenie `unknown && JSX`
          typu ReactNode nie przechodzi typechecku. */}
      {blad ? <ErrorMessage error={blad} className="mt-3" /> : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Anuluj
        </Button>
        <Button onClick={zapiszWpis} loading={zapisz.isPending}>
          Odnotuj weryfikację
        </Button>
      </div>
    </Modal>
  );
}

/** Dzisiejsza data w formacie `RRRR-MM-DD` — porównanie jest tekstowe. */
function dzis(): string {
  return new Date().toISOString().slice(0, 10);
}
