/**
 * Sekcje formularza aplikacji — przeniesione 1:1 z `ApplicationFormPage`.
 *
 * Każda sekcja to wcześniej po prostu `fieldset` w ośmiuset linijkach
 * strony. Dzielą one plik na skrawki, które da się czytać i podmieniać
 * osobno; stan i orkiestracja zostają na stronie (patrz
 * `use-application-form.ts`), a sekcje są nieświadome historii zapisu.
 */
import {
  DELIVERY_TYPE_DESCS,
  DELIVERY_TYPE_LABELS,
  SECURITY_LABELS,
  STATUS_LABELS,
  SUPPORT_CHANNEL_LABELS,
  SUPPORT_OWNER_LABELS,
  type AppStatus,
  type DeliveryType,
  type SecurityClass,
  type SupportChannel,
  type SupportOwnerType,
} from '../../types';
import type { FormState } from '../../lib/application-form';
import { DELIVERY_TYPE_ORDER } from '../../lib/application-form';
import { IpAddressPicker } from '../ipam/IpAddressPicker';
import { Checkbox, Select, Textarea, TextInput } from '../ui/Field';

/** Wspólne ogniwo każdej sekcji — ten sam kształt, co zwraca hook stanu. */
export type FormCtx = {
  form: FormState;
  errors: Record<string, string>;
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  toggle: (key: 'adminIds' | 'environmentIds', value: string) => void;
};

export function IdentyfikacjaSection({ ctx }: { ctx: FormCtx }) {
  const { form, errors, set } = ctx;
  return (
    <fieldset className="card px-5 py-4">
      <legend className="group-title">
        Identyfikacja
      </legend>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          label="Nazwa"
          required
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
          maxLength={200}
          placeholder="np. System Płacowy"
        />
        <TextInput
          label="Wersja"
          required
          value={form.version}
          onChange={(e) => set('version', e.target.value)}
          error={errors.version}
          maxLength={100}
          placeholder="np. 4.2.1"
        />
        <Select
          label="Typ dostarczenia"
          value={form.deliveryType}
          onChange={(e) =>
            set('deliveryType', e.target.value as DeliveryType)
          }
          hint={DELIVERY_TYPE_DESCS[form.deliveryType]}
        >
          {DELIVERY_TYPE_ORDER.map((type) => (
            <option key={type} value={type}>
              {DELIVERY_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
        <TextInput
          label="Dostawca"
          value={form.vendor}
          onChange={(e) => set('vendor', e.target.value)}
          error={errors.vendor}
          maxLength={200}
          placeholder="np. dostawca zewnętrzny albo „wewnętrzne”"
        />
      </div>
    </fieldset>
  );
}

/**
 * Dostęp i hosting — tylko dla typów innych niż `GENERAL_USE`. Ukrycie
 * jest tylko wizualne — wartości zostają w stanie formularza i lecą
 * do serwera, więc powrót do typu usługi niczego nie gubi.
 */
export function HostingSection({ ctx }: { ctx: FormCtx }) {
  const { form, errors, set } = ctx;
  return (
    <fieldset className="card px-5 py-4">
      <legend className="group-title">
        Dostęp i hosting
      </legend>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          label="Adres bazowy"
          value={form.baseUrl}
          onChange={(e) => set('baseUrl', e.target.value)}
          error={errors.baseUrl}
          maxLength={500}
          placeholder="np. https://jira.firma.pl"
          hint="Pod tym adresem aplikacja jest dostępna."
        />
        <TextInput
          label="Gdzie hostowane"
          value={form.hostingLocation}
          onChange={(e) => set('hostingLocation', e.target.value)}
          error={errors.hostingLocation}
          maxLength={200}
          placeholder="np. k8s-prod-eu, serwer FIL-01"
          hint="Klaster, serwer lub cloud, w którym to działa."
        />
        <TextInput
          label="Zespół administracyjny"
          value={form.adminTeam}
          onChange={(e) => set('adminTeam', e.target.value)}
          error={errors.adminTeam}
          maxLength={200}
          placeholder="np. Zespół Platformy"
          hint="Kto technicznie zarządza — nie helpdesk."
        />
      </div>

      {/* Adresy IP — wyłącznie dla `SELF_HOSTED`, czyli gdy
          aplikacja stoi na naszym sprzęcie i adres w ogóle
          istnieje. Bez dodatkowej checki uprawnień: formularz
          siedzi za `app:write`, a każda rola z `app:write` ma
          też `ipam:write` (patrz `PERMISSIONS`). Ukrycie pola
          nie zeruje zaznaczenia — ta sama reguła co przy bloku
          wsparcia: zmiana typu tam i z powrotem niczego nie gubi. */}
      {form.deliveryType === 'SELF_HOSTED' && (
        <fieldset className="mt-4 border-t border-line pt-4">
          <legend className="label">Adresy IP</legend>
          <p className="mb-3 meta-text">
            Adresy z katalogu IPAM przypisane do tej aplikacji.
            Zapis trafi do niej osobnym żądaniem po zachowaniu
            pozostałych pól.
          </p>
          <IpAddressPicker
            value={form.ipAddressIds}
            onChange={(ids) => set('ipAddressIds', ids)}
          />
        </fieldset>
      )}
    </fieldset>
  );
}

export function WsparcieSection({ ctx }: { ctx: FormCtx }) {
  const { form, errors, set } = ctx;
  return (
    <fieldset className="card px-5 py-4">
      <legend className="group-title">
        Wsparcie
      </legend>

      <p className="mb-3 meta-text">
        Wszystkie pola są opcjonalne — uzupełnij to, co wiesz.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Wsparcie prowadzi"
          value={form.supportOwnerType}
          onChange={(e) =>
            set('supportOwnerType', e.target.value as SupportOwnerType | '')
          }
        >
          <option value="">— nie wiadomo —</option>
          {Object.entries(SUPPORT_OWNER_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          label="Główny kanał"
          value={form.supportChannel}
          onChange={(e) =>
            set('supportChannel', e.target.value as SupportChannel | '')
          }
        >
          <option value="">— nie wiadomo —</option>
          {Object.entries(SUPPORT_CHANNEL_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <TextInput
          label="Wsparcie — kto"
          value={form.supportOwnerName}
          onChange={(e) => set('supportOwnerName', e.target.value)}
          error={errors.supportOwnerName}
          maxLength={200}
          placeholder="np. Atlassian albo Helpdesk IT"
          hint="Dostawca albo zespół, do którego idzie zgłoszenie."
        />
        <TextInput
          label="Wsparcie — e-mail"
          type="email"
          autoComplete="off"
          value={form.supportEmail}
          onChange={(e) => set('supportEmail', e.target.value)}
          error={errors.supportEmail}
          maxLength={320}
          placeholder="support@firma.pl"
        />
        <TextInput
          label="Wsparcie — adres zgłoszeń"
          value={form.supportUrl}
          onChange={(e) => set('supportUrl', e.target.value)}
          error={errors.supportUrl}
          maxLength={500}
          placeholder="https://firma.atlassian.net"
          hint="Portal, na którym zakłada się ticket."
        />
      </div>

      <Textarea
        label="Wsparcie — uwagi"
        value={form.supportNotes}
        onChange={(e) => set('supportNotes', e.target.value)}
        error={errors.supportNotes}
        hint="Jak wygląda zgłaszanie u nas — np. przez Jira IT."
        rows={3}
      />
    </fieldset>
  );
}

export function OpisSection({ ctx }: { ctx: FormCtx }) {
  const { form, errors, set } = ctx;
  return (
    <fieldset className="card px-5 py-4">
      <legend className="group-title">
        Opis i przeznaczenie
      </legend>

      <div className="space-y-4">
        <Textarea
          label="Opis"
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          error={errors.description}
          hint="Czym to jest, z czego korzysta organizacja."
        />
        <Textarea
          label="Cel / do czego służy"
          value={form.purpose}
          onChange={(e) => set('purpose', e.target.value)}
          error={errors.purpose}
          hint="Dlaczego wdrożyliśmy to oprogramowanie i jaki problem rozwiązuje."
        />
        <Textarea
          label="Integracje i API"
          value={form.integrations}
          onChange={(e) => set('integrations', e.target.value)}
          error={errors.integrations}
          hint="Z czym to się komunikuje — inne systemy, usługi, bazy."
          rows={3}
        />
      </div>
    </fieldset>
  );
}

export function OdpowiedzialniSection({
  ctx,
  /** Zapytanie o użytkowników — sekcja pilnuje tylko jego trzech stanów. */
  users,
}: {
  ctx: FormCtx;
  users: {
    isLoading: boolean;
    data?: { users: { id: string; username: string; fullName: string }[] };
  };
}) {
  const { form, toggle } = ctx;
  return (
    <fieldset className="card px-5 py-4">
      <legend className="group-title">
        Odpowiedzialni
      </legend>

      <div className="space-y-4">
        <TextInput
          label="Właściciel (e-mail)"
          type="email"
          autoComplete="off"
          value={form.ownerEmail}
          onChange={(e) => ctx.set('ownerEmail', e.target.value)}
          error={ctx.errors.ownerEmail}
          hint="Adres e-mail osoby odpowiedzialnej za aplikację — nie musi mieć konta w systemie."
        />

        <fieldset>
          <legend className="label">Administratorzy</legend>
          <p className="mb-2 meta-text">
            Osoby z uprawnieniami administracyjnymi w tej aplikacji.
          </p>

          <div className="scroll-thin max-h-48 overflow-y-auto rounded-lg border border-line">
            {users.isLoading ? (
              <p className="px-3 py-3 text-sm text-fg-muted">
                Ładowanie…
              </p>
            ) : users.data?.users.length === 0 ? (
              <p className="px-3 py-3 text-sm text-fg-muted">
                Brak aktywnych użytkowników.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {users.data?.users.map((user) => (
                  <li key={user.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-page">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-line-strong text-brand-600"
                        checked={form.adminIds.includes(user.id)}
                        onChange={() => toggle('adminIds', user.id)}
                      />
                      <span className="field-value min-w-0 flex-1">
                        {user.fullName}
                        <span className="ml-1.5 meta-text">
                          {user.username}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </fieldset>
      </div>
    </fieldset>
  );
}

export function DatySection({ ctx }: { ctx: FormCtx }) {
  const { form, errors, set } = ctx;
  return (
    <fieldset className="card px-5 py-4">
      <legend className="group-title">
        Daty
      </legend>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          label="Data wprowadzenia"
          type="date"
          value={form.introducedOn}
          onChange={(e) => set('introducedOn', e.target.value)}
          error={errors.introducedOn}
        />
        <TextInput
          label="Planowane wycofanie (EOL)"
          type="date"
          value={form.sunsetOn}
          onChange={(e) => set('sunsetOn', e.target.value)}
          error={errors.sunsetOn}
          hint="Pulpit ostrzega, gdy termin zbliża się albo minął."
        />
      </div>
    </fieldset>
  );
}

export function KlasyfikacjaSection({ ctx }: { ctx: FormCtx }) {
  const { form, errors, set } = ctx;
  return (
    <fieldset className="card px-5 py-4">
      <legend className="group-title">
        Klasyfikacja i status
      </legend>

      <div className="grid gap-4 sm:grid-cols-3">
        <Select
          label="Klasyfikacja bezpieczeństwa"
          value={form.securityClass}
          onChange={(e) => set('securityClass', e.target.value as SecurityClass)}
          error={errors.securityClass}
        >
          {Object.entries(SECURITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        <Select
          label="Krytyczność biznesowa"
          value={form.criticality}
          onChange={(e) => set('criticality', Number(e.target.value))}
          error={errors.criticality}
        >
          <option value={4}>4 — Krytyczna</option>
          <option value={3}>3 — Wysoka</option>
          <option value={2}>2 — Średnia</option>
          <option value={1}>1 — Niska</option>
        </Select>

        <Select
          label="Status"
          value={form.status}
          onChange={(e) => set('status', e.target.value as AppStatus)}
          error={errors.status}
        >
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      <div className="mt-4 border-t border-line pt-4">
        <Checkbox
          label="Wymagany wniosek o dostęp"
          hint="Zaznacz, jeśli uzyskanie dostępu do tej aplikacji wymaga złożenia formalnego wniosku."
          checked={form.accessRequestRequired}
          onChange={(e) => set('accessRequestRequired', e.target.checked)}
        />
      </div>
    </fieldset>
  );
}

export function SrodowiskaSection({
  ctx,
  environments,
}: {
  ctx: FormCtx;
  environments: {
    isLoading: boolean;
    data?: { environments: { id: string; name: string }[] };
  };
}) {
  const { form, toggle } = ctx;
  return (
    <fieldset className="card px-5 py-4">
      <legend className="group-title">
        Środowiska
      </legend>

      {environments.isLoading ? (
        <p className="text-sm text-fg-muted">Ładowanie…</p>
      ) : environments.data?.environments.length === 0 ? (
        <p className="text-sm text-fg-muted">
          Brak zdefiniowanych środowisk.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {environments.data?.environments.map((env) => {
            const active = form.environmentIds.includes(env.id);
            return (
              <button
                key={env.id}
                type="button"
                onClick={() => toggle('environmentIds', env.id)}
                aria-pressed={active}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium
                            ring-1 ring-inset transition ${
                              active
                                ? 'bg-brand-600 text-white ring-brand-600'
                                : 'bg-surface text-fg-muted ring-line-strong hover:bg-page'
                            }`}
              >
                {env.name}
              </button>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

export function LicencjaSection({ ctx }: { ctx: FormCtx }) {
  const { form, errors, set } = ctx;
  return (
    <fieldset className="card px-5 py-4">
      <legend className="group-title">
        Licencja i koszty
      </legend>

      <div className="grid gap-4 sm:grid-cols-3">
        <TextInput
          label="Rodzaj licencji"
          value={form.license}
          onChange={(e) => set('license', e.target.value)}
          error={errors.license}
          maxLength={200}
          placeholder="np. Enterprise, perpetualna"
        />
        <TextInput
          label="Liczba licencji"
          type="number"
          min={0}
          step={1}
          value={form.licenseCount}
          onChange={(e) => set('licenseCount', e.target.value)}
          error={errors.licenseCount}
        />
        <TextInput
          label="Koszt roczny (PLN)"
          type="number"
          min={0}
          step="0.01"
          value={form.annualCost}
          onChange={(e) => set('annualCost', e.target.value)}
          error={errors.annualCost}
        />
      </div>
    </fieldset>
  );
}

export function LinkiSection({ ctx }: { ctx: FormCtx }) {
  const { form, errors, set } = ctx;
  return (
    <fieldset className="card px-5 py-4">
      <legend className="group-title">
        Linki
      </legend>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          label="Strona WWW"
          type="url"
          value={form.websiteUrl}
          onChange={(e) => set('websiteUrl', e.target.value)}
          error={errors.websiteUrl}
          placeholder="https://…"
        />
        <TextInput
          label="Dokumentacja"
          type="url"
          value={form.docsUrl}
          onChange={(e) => set('docsUrl', e.target.value)}
          error={errors.docsUrl}
          placeholder="https://…"
        />
        <TextInput
          label="Repozytorium"
          type="url"
          value={form.repoUrl}
          onChange={(e) => set('repoUrl', e.target.value)}
          error={errors.repoUrl}
          placeholder="https://…"
        />
        <TextInput
          label="Runbook / instrukcja"
          type="url"
          value={form.runbookUrl}
          onChange={(e) => set('runbookUrl', e.target.value)}
          error={errors.runbookUrl}
          placeholder="https://…"
        />
      </div>
    </fieldset>
  );
}
