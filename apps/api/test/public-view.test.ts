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
  owner: 'a@firma.local',
  ownerId: '00000000-0000-0000-0000-0000000000aa',
  admins: [
    {
      id: 'p1',
      firstName: 'Jan',
      lastName: 'Kowalski',
      fullName: 'Jan Kowalski',
      email: 'jan@firma.pl',
      position: 'Administrator',
      department: 'IT',
      isActive: true,
    },
  ],
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

  it('usuwa dane właściciela', () => {
    // Osoba zamiast adresu — właściciel to relacja do `persons`, a
    // jej dane są osobowe. Gość nie ma prawa ich widzieć, więc cały
    // obiekt znika z odpowiedzi.
    const view = toPublicView({ ...APP });
    assert.equal('owner' in view, false);
  });

  it('usuwa identyfikator właściciela (ownerId)', () => {
    // Samo usunięcie obiektu `owner` nie wystarcza: skalarne `ownerId`
    // to stabilny identyfikator, po którym gość rozpozna aplikacje
    // współdzielące właściciela — kolejność wyników zrobi z niego
    // filtr, którego nie kupił.
    const view = toPublicView({ ...APP });
    assert.equal('ownerId' in view, false);
  });

  it('przystrzyga administratorów do kontaktu (id, fullName, email)', () => {
    // Dawniej gość widział konta panelu jako username/fullName/email.
    // Osoby niosą teraz więcej metadanych (stanowisko, dział, aktywność)
    // — to dane pracownicze i w publicznym widoku muszą wrócić do
    // dawnego poziomu ekspozycji, nie dalej.
    const view = toPublicView({ ...APP });
    assert.equal(view.admins.length, 1);
    assert.equal(view.admins[0]!.fullName, 'Jan Kowalski');
    assert.equal(view.admins[0]!.email, 'jan@firma.pl');
    assert.equal('position' in view.admins[0], false);
    assert.equal('department' in view.admins[0], false);
    assert.equal('isActive' in view.admins[0], false);
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
    assert.equal(input.owner, 'a@firma.local');
  });

  it('usuwa pola nawet gdy mają wartość null — brak i zakaz to nie to samo', () => {
    // `null` znaczy „pole puste", `brak pola` znaczy „nie wolno ci tego
    // widzieć”. Podmiana jednego na drugie ujawniłaby zaślepkę w UI.
    const view = toPublicView({
      ...APP,
      securityClass: null,
      criticality: null,
      owner: null,
    } as never);
    assert.equal('securityClass' in view, false);
    assert.equal('criticality' in view, false);
    assert.equal('owner' in view, false);
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
