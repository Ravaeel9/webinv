/**
 * Logika formularza aplikacji z interfejsu — czysta, bez Reacta.
 *
 * `apps/web/src/lib/application-form.ts` odpowiada za trzy rzeczy,
 * które historycznie najłatwiej popsuć na granicy UI i API:
 *
 *  - **Karta ↔ formularz.** `fromApp` wypełnia pola rekordem API:
 *    `null` staje się pustym polem, daty idą jako RRRR-MM-DD
 *    (format `<input type="date">`), a przypisań IPAM tu nie ma —
 *    przychodzą z osobnego zapytania.
 *  - **Formularz ↔ payload.** `toPayload` buduje DTO:
 *    `forbidNonWhitelisted` na serwerze odrzuca nieznane pola,
 *    więc wysyłamy wyłącznie to, co DTO zna.
 *  - **Walidacja.** Reguły client-side odpowiadają walidacji DTO
 *    serwera — gdyby się rozjechały, użytkownik zobaczy błąd
 *    lokalnie, ale zapis i tak skończy się 400.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  DELIVERY_TYPE_ORDER,
  EMPTY,
  fromApp,
  toPayload,
  validateApplicationForm,
  odczytajSzkic,
  zapiszSzkic,
  usuńSzkic,
  type FormState,
} from '../../web/src/lib/application-form';
import type { Application } from '../../web/src/types';

/* Atrapa `localStorage`: moduł dotyka szkiców (localStorage) dopiero
   w funkcjach, nie na poziomie modułu, więc atrapa może wylądować
   w `globalThis` po imporcie. Kopia w pamięci wystarczy — przeglądarka
   i tak ma własną. */
const SCHRANIE = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => SCHRANIE.get(key) ?? null,
    setItem: (key: string, value: string) => void SCHRANIE.set(key, value),
    removeItem: (key: string) => void SCHRANIE.delete(key),
  },
});

/* Pełny minimalny rekord API — taka odpowiedź, jaką zwraca `/applications/:id`. */
const podstawa: Application = {
  id: 'a1',
  name: 'System Płacowy',
  version: '4.2.1',
  deliveryType: 'SAAS',
  baseUrl: 'https://place.firma.pl',
  description: 'Opis',
  purpose: 'Cel',
  ownerEmail: 'wlasciciel@firma.pl',
  admins: [
    { id: 'u1', username: 'jan', fullName: 'Jan Kowalski', email: 'jan@firma.pl' },
    { id: 'u2', username: 'ala', fullName: 'Ala Nowak', email: 'ala@firma.pl' },
  ],
  introducedOn: '2026-01-05T00:00:00.000Z',
  sunsetOn: '2027-06-30T12:00:00.000Z',
  securityClass: 'INTERNAL',
  criticality: 3,
  status: 'PROD',
  accessRequestRequired: true,
  hostingLocation: null,
  adminTeam: 'Zespół płac',
  supportOwnerType: 'VENDOR',
  supportOwnerName: 'Atlassian',
  supportEmail: 'support@firma.pl',
  supportUrl: 'https://firma.atlassian.net',
  supportChannel: 'EMAIL',
  supportNotes: '',
  vendor: 'Firma X',
  license: 'Enterprise',
  licenseCount: 120,
  annualCost: 48000,
  environments: [
    { id: 'e1', name: 'prod', color: 'slate', sortOrder: 1 },
    { id: 'e2', name: 'uat', color: 'slate', sortOrder: 2 },
  ],
  websiteUrl: null,
  docsUrl: null,
  repoUrl: null,
  runbookUrl: null,
  integrations: null,
  createdById: null,
  createdBy: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

/** Poprawny, niewypełniony polami kosztowymi stan formularza. */
const WALIDNE: FormState = {
  ...EMPTY,
  name: 'Aplikacja',
  version: '1.0',
};

describe('fromApp — karta aplikacji na stan formularza', () => {
  it('mapuje rekord API na pola formularza', () => {
    const form = fromApp(podstawa);

    assert.equal(form.name, 'System Płacowy');
    assert.equal(form.baseUrl, 'https://place.firma.pl');
    assert.equal(form.adminIds.join(','), 'u1,u2');
    assert.equal(form.environmentIds.join(','), 'e1,e2');
    // Numery w rekordzie API — stringi zaokrąglające do pola.
    assert.equal(form.licenseCount, '120');
    assert.equal(form.annualCost, '48000');
    // Daty w `<input type="date">` to RRRR-MM-DD (UTC).
    assert.equal(form.introducedOn, '2026-01-05');
    assert.equal(form.sunsetOn, '2027-06-30');
  });

  it('wartości nullowe zamienia na pola do edycji, nie na „null"', () => {
    const form = fromApp({
      ...podstawa,
      baseUrl: null,
      description: null,
      licenseCount: null,
      annualCost: null,
      introducedOn: null,
    });

    assert.equal(form.baseUrl, '');
    assert.equal(form.description, '');
    assert.equal(form.licenseCount, '');
    assert.equal(form.annualCost, '');
    assert.equal(form.introducedOn, '');
  });

  it('przypisania IPAM nie przychodzą z karty aplikacji', () => {
    assert.deepEqual(fromApp(podstawa).ipAddressIds, []);
  });
});

describe('toPayload — stan formularza na DTO', () => {
  it('puste pola idą jako null, nie jako pusty string', () => {
    const payload = toPayload({ ...EMPTY, name: 'Aplikacja', version: '1.0' });

    assert.equal(payload.baseUrl, null);
    assert.equal(payload.description, null);
    assert.equal(payload.licenseCount, null);
    assert.equal(payload.annualCost, null);
  });

  it('blok wsparcia leci zawsze — nawet dla GENERAL_USE', () => {
    const payload = toPayload({
      ...EMPTY,
      supportOwnerType: 'VENDOR',
      supportOwnerName: 'Firma X',
    });

    // GENERAL_USE ukrywa sekcję wizualnie, ale wartości zostają
    // w stanie i lecą do serwera — powrót do SAAS je odsłoni.
    assert.equal(payload.supportOwnerType, 'VENDOR');
    assert.equal(payload.supportOwnerName, 'Firma X');
  });

  it('przypisania IP pozostają poza DTO — idą osobnym żądaniem', () => {
    const payload = toPayload({ ...EMPTY, ipAddressIds: ['ip1', 'ip2'] });

    assert.ok(!('ipAddressIds' in payload));
  });

  it('białe znaki z boków ucina, a liczby zamienia na Number', () => {
    const payload = toPayload({
      ...EMPTY,
      name: '  System Płacowy  ',
      version: '4.2.1',
      licenseCount: ' 120 ',
      annualCost: '48000',
      criticality: 2,
    });

    assert.equal(payload.name, 'System Płacowy');
    assert.equal(payload.licenseCount, 120);
    assert.equal(payload.annualCost, 48000);
    assert.equal(payload.criticality, 2);
  });
});

describe('validateApplicationForm — reguły zgodne z DTO', () => {
  it('pusty formularz wskazuje dokładnie wymagane pola', () => {
    const błędy = validateApplicationForm({ ...EMPTY });

    assert.ok(błędy.name);
    assert.ok(błędy.version);
    assert.equal(Object.keys(błędy).length, 2);
  });

  it('data wycofania przed wprowadzeniem jest błędem', () => {
    const błędy = validateApplicationForm({
      ...WALIDNE,
      introducedOn: '2026-01-01',
      sunsetOn: '2025-01-01',
    });

    assert.ok(błędy.sunsetOn!.includes('wcześniejsza'));
  });

  it('liczby wymagają formatu liczb i wartości nieujemnych', () => {
    const błędy = validateApplicationForm({
      ...WALIDNE,
      licenseCount: 'dwanaście',
      annualCost: '-5',
    });

    assert.ok(błędy.licenseCount!.includes('liczb'));
    assert.ok(błędy.annualCost!.includes('ujemn'));
  });

  it('puste pola liczbowe są dozwolone i nie błędzą', () => {
    const błędy = validateApplicationForm({
      ...WALIDNE,
      licenseCount: '',
      annualCost: '',
    });

    assert.ok(!('licenseCount' in błędy));
    assert.ok(!('annualCost' in błędy));
  });
});

describe('DELIVERY_TYPE_ORDER — kolejność sekcji w interfejsie', () => {
  it('GENERAL_USE jest pierwszy, bo najprościej wypełnić', () => {
    assert.equal(DELIVERY_TYPE_ORDER[0], 'GENERAL_USE');
    assert.equal(DELIVERY_TYPE_ORDER.length, 4);
    for (const typ of ['SAAS', 'SELF_HOSTED', 'VENDOR_MANAGED'] as const) {
      assert.ok(DELIVERY_TYPE_ORDER.includes(typ), `brak ${typ}`);
    }
  });
});

describe('szkic nowej aplikacji — trwałość w localStorage', () => {
  it('zapisany szkic jest walidowanym JSON-em i wraca po odczycie', () => {
    zapiszSzkic({ ...EMPTY, name: 'Szkic', version: '0.1' });

    assert.equal(odczytajSzkic()?.name, 'Szkic');
    assert.equal(odczytajSzkic()?.version, '0.1');
  });

  it('usunięcie szkicu z powrotem daje brak szkicu', () => {
    zapiszSzkic({ ...EMPTY, name: 'Szkic' });
    usuńSzkic();

    assert.equal(odczytajSzkic(), null);
  });
});
