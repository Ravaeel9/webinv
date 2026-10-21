/**
 * Czysta logika formularza aplikacji — bez Reacta.
 *
 * Wydzielone z `ApplicationFormPage` w trakcie rozbijania „goda":
 * mapowanie rekordu API na stan formularza, budowanie payloadu,
 * walidacja pól i szkic w `localStorage`. Nic tu nie dotyka stanu
 * komponentów, więc całość da się sprawdzić testem bez montowania UI.
 */
import { toDateInput } from './format';
import {
  type AppStatus,
  type Application,
  type DeliveryType,
  type SecurityClass,
  type SupportChannel,
  type SupportOwnerType,
} from '../types';

/** Kolejność typów dostarczenia w formularzu — od najprostszego. */
export const DELIVERY_TYPE_ORDER: DeliveryType[] = [
  'GENERAL_USE',
  'SELF_HOSTED',
  'SAAS',
  'VENDOR_MANAGED',
];

/** Pusty formularz — wartości domyślne zgodne z defaultami schematu Prisma. */
export const EMPTY = {
  name: '',
  version: '',
  deliveryType: 'GENERAL_USE' as DeliveryType,
  baseUrl: '',
  hostingLocation: '',
  adminTeam: '',
  supportOwnerType: '' as '' | SupportOwnerType,
  supportOwnerName: '',
  supportEmail: '',
  supportUrl: '',
  supportChannel: '' as '' | SupportChannel,
  supportNotes: '',
  description: '',
  purpose: '',
  ownerId: '',
  adminIds: [] as string[],
  introducedOn: '',
  sunsetOn: '',
  securityClass: 'INTERNAL' as SecurityClass,
  criticality: 2,
  status: 'PROD' as AppStatus,
  accessRequestRequired: false,
  vendor: '',
  license: '',
  licenseCount: '',
  annualCost: '',
  websiteUrl: '',
  docsUrl: '',
  repoUrl: '',
  runbookUrl: '',
  integrations: '',
  environmentIds: [] as string[],
  // Poza `toPayload`: przypisania nie lecą w DTO aplikacji, a osobnym
  // `PUT` po udanym zapisie — patrz `handleSubmit`.
  ipAddressIds: [] as string[],
};

export type FormState = typeof EMPTY;

/** Klucz szkicu nowej aplikacji w `localStorage`. */
export const SZKIC_KLUCZ = 'webinv.szkic.aplikacji';

/** Zamienia rekord API na stan formularza (daty w formacie RRRR-MM-DD). */
export function fromApp(app: Application): FormState {
  return {
    name: app.name,
    version: app.version,
    deliveryType: app.deliveryType,
    baseUrl: app.baseUrl ?? '',
    hostingLocation: app.hostingLocation ?? '',
    adminTeam: app.adminTeam ?? '',
    supportOwnerType: app.supportOwnerType ?? '',
    supportOwnerName: app.supportOwnerName ?? '',
    supportEmail: app.supportEmail ?? '',
    supportUrl: app.supportUrl ?? '',
    supportChannel: app.supportChannel ?? '',
    supportNotes: app.supportNotes ?? '',
    description: app.description ?? '',
    purpose: app.purpose ?? '',
    ownerId: app.owner?.id ?? '',
    adminIds: app.admins.map((a) => a.id),
    introducedOn: toDateInput(app.introducedOn),
    sunsetOn: toDateInput(app.sunsetOn),
    // Formularz jest za `app:write`, więc API zawsze zwraca te pola.
    // Wartości domyślne są tylko na wypadek odpowiedzi okrojonej.
    securityClass: app.securityClass ?? 'INTERNAL',
    criticality: app.criticality ?? 2,
    status: app.status,
    accessRequestRequired: app.accessRequestRequired,
    vendor: app.vendor ?? '',
    license: app.license ?? '',
    licenseCount: app.licenseCount === null ? '' : String(app.licenseCount),
    annualCost: app.annualCost === null ? '' : String(app.annualCost),
    websiteUrl: app.websiteUrl ?? '',
    docsUrl: app.docsUrl ?? '',
    repoUrl: app.repoUrl ?? '',
    runbookUrl: app.runbookUrl ?? '',
    integrations: app.integrations ?? '',
    environmentIds: app.environments.map((e) => e.id),
    // Karta aplikacji nie niesie adresów — to osobne zapytanie IPAM,
    // więc tu zostaje pusto, a przypisania dosypuje oddzielne wejście.
    ipAddressIds: [],
  };
}

/**
 * Buduje payload. `forbidNonWhitelisted` w ValidationPipe odrzuca
 * nieznane pola, więc wysyłamy wyłącznie to, co jest w DTO —
 * puste wartości zamieniamy na `null`, a nie pusty string.
 *
 * Blok wsparcia wysyłamy **zawsze**, także gdy typ to `GENERAL_USE`
 * i pola nie są widoczne. Dzięki temu przełączenie typu w trakcie
 * edycji niczego nie gubi, a powrót do `SAAS` odsłania dane, które
 * nadal tam są. Serwer z kolei ich nie czyści — patrz `mapDto`.
 */
export function toPayload(form: FormState) {
  const text = (v: string) => (v.trim() === '' ? null : v.trim());

  return {
    name: form.name.trim(),
    version: form.version.trim(),
    deliveryType: form.deliveryType,
    baseUrl: text(form.baseUrl),
    hostingLocation: text(form.hostingLocation),
    adminTeam: text(form.adminTeam),
    supportOwnerType: form.supportOwnerType || null,
    supportOwnerName: text(form.supportOwnerName),
    supportEmail: text(form.supportEmail),
    supportUrl: text(form.supportUrl),
    supportChannel: form.supportChannel || null,
    supportNotes: text(form.supportNotes),
    description: text(form.description),
    purpose: text(form.purpose),
    ownerId: form.ownerId || null,
    adminIds: form.adminIds,
    introducedOn: text(form.introducedOn),
    sunsetOn: text(form.sunsetOn),
    securityClass: form.securityClass,
    criticality: Number(form.criticality),
    status: form.status,
    accessRequestRequired: form.accessRequestRequired,
    vendor: text(form.vendor),
    license: text(form.license),
    licenseCount:
      form.licenseCount.trim() === '' ? null : Number(form.licenseCount),
    annualCost: form.annualCost.trim() === '' ? null : Number(form.annualCost),
    websiteUrl: text(form.websiteUrl),
    docsUrl: text(form.docsUrl),
    repoUrl: text(form.repoUrl),
    runbookUrl: text(form.runbookUrl),
    integrations: text(form.integrations),
    environmentIds: form.environmentIds,
  };
}

/**
 * Walidacja pól formularza — te same reguły, które pilnuje DTO w API,
 * ale po stronie przeglądarki: komunikat użytkownik dostaje od razu,
 * bez rundy sieciowej.
 */
export function validateApplicationForm(form: FormState): Record<string, string> {
  const next: Record<string, string> = {};

  if (!form.name.trim()) next.name = 'Nazwa jest wymagana.';
  if (!form.version.trim()) next.version = 'Wersja jest wymagana.';

  if (form.introducedOn && form.sunsetOn && form.sunsetOn < form.introducedOn) {
    next.sunsetOn = 'Data wycofania nie może być wcześniejsza niż data wprowadzenia.';
  }

  for (const [key, value] of Object.entries({
    licenseCount: form.licenseCount,
    annualCost: form.annualCost,
  })) {
    if (value.trim() !== '' && Number.isNaN(Number(value))) {
      next[key] = 'Podaj liczbę.';
    }
  }

  if (
    form.licenseCount.trim() !== '' &&
    Number(form.licenseCount) < 0
  ) {
    next.licenseCount = 'Liczba nie może być ujemna.';
  }

  if (form.annualCost.trim() !== '' && Number(form.annualCost) < 0) {
    next.annualCost = 'Koszt nie może być ujemny.';
  }

  return next;
}

/**
 * Szkic nowej aplikacji — trzy operacje w jednym miejscu, żeby klucz
 * `SZKIC_KLUCZ` nie rozeszł się między wywołaniami.
 *
 * Tylko dla trybu tworzenia: przywrócenie szkicu w trybie edycji
 * nadpisałoby stan z bazy starszymi danymi i wyglądało jak błąd.
 */

/** Odczyt szkicu; uszkodzony szkic jest kasowany, nie zabija formularza. */
export function odczytajSzkic(): FormState | null {
  try {
    const surowy = localStorage.getItem(SZKIC_KLUCZ);
    if (!surowy) return null;
    return JSON.parse(surowy) as FormState;
  } catch {
    localStorage.removeItem(SZKIC_KLUCZ);
    return null;
  }
}

/** Zapis szkicu; pełny pamięć lokalna nie ma prawa zabić formularza. */
export function zapiszSzkic(form: FormState): void {
  try {
    localStorage.setItem(SZKIC_KLUCZ, JSON.stringify(form));
  } catch {
    // Brak szkicu to tylko powrót do stanu sprzed tej poprawki.
  }
}

export function usuńSzkic(): void {
  localStorage.removeItem(SZKIC_KLUCZ);
}
