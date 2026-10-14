/**
 * Nazwy pól w dzienniku zdarzeń — camelCase z bazy → po polsku.
 *
 * Jedno miejsce, bo lista była skopiowana do dwóch stron: szczegółów
 * aplikacji i dziennika. Kopie rozjechały się — wersja ze szczegółów
 * nie znała `count` ani `mustChangePassword`, więc te zmiany pokazywały
 * się jako surowe angielskie nazwy kluczy. Teraz brak wpisu oznacza
 * jedną rzecz: pole spoza modelu, a nie zapomniany wpis w drugiej stronie.
 *
 * `AuditService.diff` nie ma listy pól — chodzi po kluczu obiektu, więc
 * kompletność tej mapy pilnuje przegląd, a nie typ. Stąd `Record`:
 * brak wpisów to błąd wyświetlania, nie błąd typów.
 */
export const FIELD_LABELS: Record<string, string> = {
  // Aplikacja
  name: 'nazwa',
  version: 'wersja',
  deliveryType: 'typ dostarczenia',
  baseUrl: 'adres bazowy',
  hostingLocation: 'gdzie hostowane',
  adminTeam: 'zespół administracyjny',
  supportOwnerType: 'wsparcie prowadzi',
  supportOwnerName: 'wsparcie — kto',
  supportEmail: 'wsparcie — e-mail',
  supportUrl: 'wsparcie — adres zgłoszeń',
  supportChannel: 'wsparcie — kanał',
  supportNotes: 'wsparcie — uwagi',
  description: 'opis',
  purpose: 'cel',
  ownerEmail: 'e-mail właściciela',
  introducedOn: 'data wprowadzenia',
  sunsetOn: 'data wycofania',
  accessRequestRequired: 'wniosek o dostęp',
  securityClass: 'klasyfikacja',
  criticality: 'krytyczność',
  status: 'status',
  vendor: 'dostawca',
  license: 'licencja',
  licenseCount: 'liczba licencji',
  annualCost: 'koszt roczny',
  websiteUrl: 'adres WWW',
  docsUrl: 'dokumentacja',
  repoUrl: 'repozytorium',
  runbookUrl: 'runbook',
  integrations: 'integracje',
  // Pole techniczne: zmienia je wyłącznie seed, nie panel. Bez wpisu
  // w dzienniku pokazałoby się jako surowy klucz `isDemo`.
  isDemo: 'rekord demonstracyjny',
  // `createdById` PATCH nie zmienia (mapPatchDto bierze tylko pola DTO),
  // więc `diff` dziś go nie raportuje. Etykieta jest mimo to: wykluczanie
  // go w teście byłoby kruche — wystarczyłoby nowe pole w DTO, żeby
  // na ekranie wrócił surowy `createdById`.
  createdById: 'kto utworzył',

  // Użytkownik
  username: 'nazwa użytkownika',
  email: 'e-mail',
  fullName: 'imię i nazwisko',
  role: 'rola',
  isActive: 'aktywność',
  mustChangePassword: 'wymuszona zmiana hasła',
  lastLoginAt: 'ostatnie logowanie',

  // Pozostałe zdarzenia
  count: 'liczba',
  source: 'źródło',
};

/** Nazwa pola po polsku; nieznane pole wraca jako klucz, nie jako pustka. */
export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/**
 * Wartość zmiany w formie do przeczytania.
 *
 * `null`/`undefined`/`''` to jedno znaczenie — brak wartości — i pokazujemy
 * je jako myślnik. `false` jest wartością, nie brakiem, więc działa
 * osobno: `??` zamiast `||` byłby tu błędem.
 */
export function formatChangeValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'tak' : 'nie';
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 40);
  return String(value);
}