/**
 * Zgodność warstwy frontendu z API i schematem.
 *
 * `types.ts` nie da się zaimportować w teście node (Vite po drugiej
 * stronie), więc plik czytamy jako tekst — tak jak robi to
 * `settings-permissions.test.ts`. Chodzi o trzy rzeczy, które rozjeżdżają
 * się po cichu:
 *
 *  - **enum poziomów.** Cztery nazwy z `schema.prisma` muszą być te same
 *    cztery nazwy w interfejsie; brak jednej oznacza badge z surowym
 *    `undefined` zamiast „Właściciel".
 *  - **pola osoby.** Nazwy w `types.ts` to nazwy kolumn w odpowiedzi API.
 *  - **klucze zapytań.** Każdy `qk.*` użyty w komponencie musi istnieć w
 *    `qk` — inaczej unieważnienie po zapisie milcząco nic nie odświeża
 *    i administrator widzi stan sprzed chwili.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { read } from './helpers/repo';

const typy = read('apps', 'web', 'src', 'types.ts');
const schemat = read('apps', 'api', 'prisma', 'schema.prisma');
const queries = read('apps', 'web', 'src', 'lib', 'queries.ts');

describe('Typy frontendu a enum AccessLevel', () => {
  it('cztery poziomy z bazy są tymi samymi czterema nazwami w interfejsie', () => {
    // Wiersze enuma mają komentarze na końcu (`OWNER     // właściciel`),
    // więc dopasowanie musi obejmować część po nazwie.
    const blok = schemat.match(/enum AccessLevel \{[\s\S]*?\n\}/)?.[0] ?? '';
    const zEnumu = [...blok.matchAll(/^ {2}([A-Z_]+)/gm)].map((m) => m[1]!);
    assert.equal(zEnumu.length, 4);

    const typ = typy.match(/export type AccessLevel =\s*([^;]+);/)?.[1] ?? '';
    for (const poziom of zEnumu) {
      assert.ok(typ.includes(`'${poziom}'`), `brak poziomu ${poziom} w types.ts`);
    }
  });

  it('poziomy mają polskie etykiety', () => {
    const etykiety = typy.match(/ACCESS_LEVEL_LABELS[^=]*=\s*\{([\s\S]*?)\n\};/) ?? [];
    const blok = etykiety[1] ?? '';
    for (const [poziom, etykieta] of [
      ['OWNER', 'Właściciel'],
      ['ADMIN', 'Administrator'],
      ['USER', 'Użytkownik'],
      ['READ_ONLY', 'Tylko odczyt'],
    ] as const) {
      assert.ok(blok.includes(`${poziom}: '${etykieta}'`), `brak etykiety ${poziom}`);
    }
  });
});

describe('Typy frontendu a model Person', () => {
  it('interfejs zna wszystkie pola osoby', () => {
    const interfejs = typy.match(/export interface Person \{([\s\S]*?)\n\}/)?.[1] ?? '';
    for (const pole of [
      'id',
      'firstName',
      'lastName',
      'email',
      'position',
      'department',
      'isActive',
      'accessCount',
    ]) {
      assert.ok(interfejs.includes(pole), `brak pola ${pole} w interfejsie Person`);
    }
  });

  it('macierz ma osobę, aplikację, poziom i daty jako tekst', () => {
    const interfejs = typy.match(/export interface AccessMatrixRow \{([\s\S]*?)\n\}/)?.[1] ?? '';
    for (const pole of ['application', 'person', 'level', 'grantedOn', 'expiresOn', 'note']) {
      assert.ok(interfejs.includes(pole), `brak pola ${pole} w AccessMatrixRow`);
    }
    assert.ok(/grantedOn:\s*string/.test(interfejs), 'daty w macierzy to tekst RRRR-MM-DD');
    assert.ok(/expiresOn:\s*string \| null/.test(interfejs));
  });
});

describe('Klucze zapytań modułu access', () => {
  it('są zadeklarowane i używane', () => {
    for (const klucz of ['persons', 'person', 'applicationAccess', 'accessMatrix']) {
      // Klucze funkcji wyglądają inaczej niż klucze-tablica:
      // `person: (id) => ['access', ...]`, więc dopuszczamy oba zapisy.
      const deklaracja = new RegExp(`\\b${klucz}:\\s*(\\([^)]*\\)\\s*=>\\s*)?\\['access'`);
      assert.ok(deklaracja.test(queries), `brak klucza qk.${klucz} w queries.ts`);
    }
  });

  it('każdy użyty klucz access jest zadeklarowany', () => {
    const uzyte = [...queries.matchAll(/qk\.(\w+)/g)].map((m) => m[1]!);
    // Klucze bywają tablicą albo funkcją zwracającą tablicę.
    const deklarowane = [
      ...queries.matchAll(/(\w+):\s*(\([^)]*\)\s*=>\s*)?\[/g),
    ].map((m) => m[1]!);
    for (const klucz of new Set(uzyte)) {
      assert.ok(deklarowane.includes(klucz), `qk.${klucz} użyty, ale niezadeklarowany`);
    }
  });
});

describe('Macierz uprawnień w interfejsie — wybór z katalogu i wyłączenie GENERAL_USE', () => {
  const detail = read('apps', 'web', 'src', 'pages', 'ApplicationDetailPage.tsx');
  const accessPage = read('apps', 'web', 'src', 'pages', 'AccessPage.tsx');
  const modal = read('apps', 'web', 'src', 'components', 'access', 'PersonAccessModal.tsx');

  it('karta szczegółów aplikacji ukrywa macierz uprawnień dla GENERAL_USE', () => {
    assert.ok(
      /can\('access:read'\)\s*&&\s*app\.deliveryType\s*!==\s*'GENERAL_USE'\s*&&[\s\S]*?<ApplicationAccessSection/.test(
        detail,
      ),
      'ApplicationDetailPage musi chować <ApplicationAccessSection /> dla GENERAL_USE',
    );
  });

  it('filtr aplikacji w zakładce Macierz pomija aplikacje GENERAL_USE', () => {
    assert.ok(
      accessPage.includes("deliveryType !== 'GENERAL_USE'"),
      'MatrixTab w AccessPage musi odfiltrować aplikacje GENERAL_USE z listy wyboru',
    );
  });

  it('PersonAccessModal pozwala wybierać wiele osób z listy i blokuje nieaktywne oraz mające już dostęp', () => {
    assert.ok(
      modal.includes('useApplicationAccess('),
      'modal musi znać obecne przypisania aplikacji, aby wyłączyć osoby z dostępem',
    );
    assert.ok(
      modal.includes('type="checkbox"'),
      'modal musi mieć checkboxy do zaznaczania osób z listy',
    );
    assert.ok(
      modal.includes('!osoba.isActive'),
      'modal musi blokować zaznaczenie osób nieaktywnych',
    );
    assert.ok(
      modal.includes('Dodaj nową osobę'),
      'modal musi zachować awaryjny przełącznik do dodania nowej osoby spoza katalogu',
    );
  });
});