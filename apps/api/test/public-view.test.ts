/**
 * Testy publicznego (niezalogowanego) widoku rejestru.
 *
 * `/api/applications` i `/api/applications/:id` są oznaczone `@Public()`,
 * więc docierasz do kodu także bez sesji. Te testy pilnują, żeby ta
 * droga nie zaczęła zwracać pól, które mają zostać ukryte —
 * klasyfikacji bezpieczeństwa, krytyczności i właściciela.
 *
 * Powód, dla którego test jest po stronie serwera, a nie tylko w UI:
 * ukrycie kolumny w HTML nic nie daje, bo rekord i tak leci w JSON-ie
 * i jest widoczny w devtoolsach.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { toPublicView } from '../src/applications/applications.service';

const APP = {
  id: 'a1',
  name: 'System Płacowy',
  version: '2.0',
  status: 'PROD',
  description: 'System wynagrodzeń',
  securityClass: 'CONFIDENTIAL',
  criticality: 4,
  ownerEmail: 'a@firma.local',
  admins: [],
  environments: [],
  annualCost: 48000,
} as const;

describe('toPublicView', () => {
  it('usuwa klasyfikację bezpieczeństwa', () => {
    const view = toPublicView({ ...APP });
    assert.equal('securityClass' in view, false);
  });

  it('usuwa krytyczność', () => {
    const view = toPublicView({ ...APP });
    assert.equal('criticality' in view, false);
  });

  it('usuwa adres właściciela', () => {
    // Adres zamiast identyfikatora — właściciel nie ma konta, więc nie
    // ma czego szukać w `users`. Nadal jest to dana osobowa, więc gość
    // nie ma prawa jej widzieć.
    const view = toPublicView({ ...APP });
    assert.equal('ownerEmail' in view, false);
  });

  it('nie usuwa pól, które mają być widoczne', () => {
    const view = toPublicView({ ...APP });
    assert.equal(view.id, 'a1');
    assert.equal(view.name, 'System Płacowy');
    assert.equal(view.version, '2.0');
    assert.equal(view.status, 'PROD');
    assert.equal(view.description, 'System wynagrodzeń');
  });

  it('nie mutuje rekordu wejściowego', () => {
    const input = { ...APP };
    toPublicView(input);
    // Gdyby rzeczywiście usuwał z obiektu, po serwisie zostałby
    // uszkodzony rekord używany dalej (np. do logowania audytu).
    assert.equal(input.securityClass, 'CONFIDENTIAL');
    assert.equal(input.ownerEmail, 'a@firma.local');
  });

  it('usuwa pola nawet gdy mają wartość null — brak i zakaz to nie to samo', () => {
    // `null` znaczy „pole puste", `brak pola` znaczy „nie wolno ci tego
    // widzieć”. Podmiana jednego na drugie ujawniłaby zaślepkę w UI.
    const view = toPublicView({
      ...APP,
      securityClass: null,
      criticality: null,
      ownerEmail: null,
    } as never);
    assert.equal('securityClass' in view, false);
    assert.equal('criticality' in view, false);
    assert.equal('ownerEmail' in view, false);
  });
});

const HOSTED_APP = {
  ...APP,
  deliveryType: 'SAAS',
  baseUrl: 'https://jira.example.pl',
  hostingLocation: 'k8s-prod-eu',
  adminTeam: 'Zespół Platformy',
  supportOwnerType: 'VENDOR',
  supportOwnerName: 'Atlassian',
  supportEmail: 'support@example.com',
  supportUrl: 'https://example.atlassian.net',
  supportChannel: 'PORTAL',
  supportNotes: 'Zgłoszenia przez Jira IT.',
} as const;

describe('toPublicView — blok dostarczania i wsparcia', () => {
  it('usuwa dane kontaktowe wsparcia', () => {
    // E-mail do wsparcia i portal zgłoszeń to dane, których bezsesyjny
    // czytelnik nie musi dostać — a w skrajnym przypadku (zgłoszenie
    // przez e-mail) pozwalają obciążać cudzy helpdesk.
    const view = toPublicView({ ...HOSTED_APP });
    assert.equal('supportEmail' in view, false);
    assert.equal('supportUrl' in view, false);
    assert.equal('supportNotes' in view, false);
  });

  it('usuwa dane wewnętrzne: kto prowadzi wsparcie i kto administruje', () => {
    const view = toPublicView({ ...HOSTED_APP });
    assert.equal('supportOwnerType' in view, false);
    assert.equal('supportOwnerName' in view, false);
    assert.equal('adminTeam' in view, false);
    assert.equal('hostingLocation' in view, false);
    assert.equal('supportChannel' in view, false);
  });

  it('zostawia typ dostarczenia i adres dostępowy', () => {
    // To informacja techniczna, a nie osobowa: bez niej widok publiczny
    // nie mówi, czy aplikację da się w ogóle otworzyć z sieci.
    const view = toPublicView({ ...HOSTED_APP });
    assert.equal(view.deliveryType, 'SAAS');
    assert.equal(view.baseUrl, 'https://jira.example.pl');
  });
});
