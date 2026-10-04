/**
 * Kompletność mapy nazw pól w dzienniku zdarzeń.
 *
 * `AuditService.diff` nie ma listy pól — chodzi po kluczach obiektu
 * z bazy. Klucz, dla którego interfejs nie ma polskiej nazwy, wychodzi
 * na ekran jako `mustChangePassword`, czyli surowa nazwa kolumny
 * w środku zdania po polsku.
 *
 * Ta mapa była skopiowana do dwóch stron i kopie się rozjechały —
 * wersja ze szczegółów aplikacji nie znała `count` ani
 * `mustChangePassword`. Dlatego pilnujemy kompletności wobec
 * **schematu bazy**, a nie wobec drugiej kopii: to jedno miejsce,
 * z którego da się wziąć prawdę.
 *
 * Wyjątki to pola, których `diff` nigdy nie pokaże:
 *  - `passwordHash` i `passwordChangedAt` — wyraźnie ignorowane przy diffie,
 *  - `createdAt`/`updatedAt` — metadane, nie zmiana treści przez użytkownika,
 *  - `id` — klucz główny, nigdy się nie zmienia,
 *  - `deletedAt` — zmiana jest własnym zdarzeniem (`app.deleted`),
 *    które samo niesie nazwę encji,
 *  - relacje (`admins`, `environments`, `createdBy`) — diff porównuje je
 *    po ID poza sobą.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { FIELD_LABELS, fieldLabel } from '../../web/src/lib/audit-fields';
import { read } from './helpers/repo';

const schema = read('apps', 'api', 'prisma', 'schema.prisma');

/** Pliki interfejsu, w których definicja mapy byłaby powtórzeniem. */
const webSources = [
  'apps/web/src/lib/audit-fields.ts',
  'apps/web/src/pages/AuditPage.tsx',
  'apps/web/src/pages/ApplicationDetailPage.tsx',
];

/** Nazwa pola w Prisma (camelCase) dla linii typu `  deletedAt DateTime?`. */
function prismaField(line: string): string | null {
  const m = /^ {2}([A-Za-z][A-Za-z0-9]*)\s+\S/.exec(line);
  return m?.[1] ?? null;
}

/**
 * Pola modelu o podanej nazwie.
 *
 * `@@map` zmienia nazwę tabeli, nie nazw pól w Prisma — a `diff`
 * chodzi po nazwach z obiektu Prisma, czyli camelCase. Stąd `@@`
 * traktujemy jako granicę bloku: atrybuty relacji też mają wcięcie
 * dwie spacje, więc odsiewamy je po tym, że kończą się `[]`.
 */
function fieldsOf(model: string): string[] {
  const start = schema.search(new RegExp(`^model ${model} \\{`, 'm'));
  assert.notEqual(start, -1, `brak modelu ${model} w schemacie`);

  const body = schema.slice(start).split('\n').slice(1);
  const fields: string[] = [];

  for (const line of body) {
    if (/^\}/.test(line)) break;
    if (line.trimStart().startsWith('@@')) continue;
    const field = prismaField(line);
    if (!field) continue;
    // Relacje. Jedna lista relacji ma `@relation` (`admins User[]
    // @relation(...)`), druga nie (`sessions Session[]`) — rozpoznajemy
    // je po typie zakończonym `[]`, a nie po `@relation`, bo brak tego
    // oznaczałby, że relacje czytamy jako pola.
    if (line.includes('@relation') || /\w\[\]/.test(line)) continue;
    fields.push(field);
  }

  return fields;
}

/** Pola, których `diff` nie raportuje — patrz komentarz pliku. */
const NOT_A_CHANGE = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'passwordHash',
  'passwordChangedAt',
]);

/**
 * Pola, które `diff` raportuje, a dla których nie ma po polsku.
 *
 * Sprawdzamy **obecność klucza**, a nie `fieldLabel(field) === field`:
 * `status` ma polską nazwę „status", więc porównanie z kluczem zgłosiłoby
 * ją jako brakującą. Brak klucza jest jedynym stanem, którego nie
 * da się odróżnić od celowego tłumaczenia.
 */
function missingLabels(model: string): string[] {
  return fieldsOf(model)
    .filter((field) => !NOT_A_CHANGE.has(field))
    .filter((field) => !(field in FIELD_LABELS));
}

describe('Nazwy pól w dzienniku — kompletność', () => {
  for (const model of ['Application', 'User']) {
    it(`model ${model}: każde zmieniane pole ma polską nazwę`, () => {
      const missing = missingLabels(model);
      assert.deepEqual(
        missing,
        [],
        `pola bez polskiej nazwy (pokazałyby się jako surowe klucze): ${missing.join(', ')}`,
      );
    });
  }

  it('model Application: relacje nie są traktowane jak pola', () => {
    // Gdyby test parsował `admins` jako pole, brak polskiej nazwy
    // zgłosiłby błąd, którego nie ma — albo, co gorsza, ktoś dopisałby
    // do mapy „admins" i relacja stałaby się etykietą.
    const fields = fieldsOf('Application');
    assert.ok(!fields.includes('admins'), 'relacja admins wczytana jako pole');
    assert.ok(!fields.includes('environments'), 'relacja environments wczytana jako pole');
    assert.ok(fields.includes('name'), 'pole name nie wczytane');
  });

  it('mapa jest zdefiniowana dokładnie raz w całym interfejsie', () => {
    // Sedno naprawy: mapa była skopiowana do dwóch stron i kopie się
    // rozjechały. Sama jedna definicja nie wystarczy — ktoś może
    // dodać drugą, żeby „tymczasowo" coś dopasować. Ten test nie
    // broni kompletności (to robią dwa przypisy wyżej), tylko brak
    // powtórki, z której kompletność w ogóle jest wyliczana.
    const definitions: string[] = [];

    for (const file of webSources) {
      const source = read(...file.split('/'));
      if (/const FIELD_LABELS\s*[:=]/.test(source)) definitions.push(file);
    }

    assert.deepEqual(
      definitions,
      ['apps/web/src/lib/audit-fields.ts'],
      'FIELD_LABELS musi mieć jedną definicję; wykryto: ' + definitions.join(', '),
    );
  });
});

describe('Nazwa nieznanego pola', () => {
  it('wraca jako klucz, a nie jako pustka', () => {
    assert.equal(fieldLabel('cosNieznanego'), 'cosNieznanego');
  });

  it('pusta nazwa nie jest nieznaną polem — wraca jako pustka', () => {
    // `''` jako klucz nie pochodzi z bazy, ale `fieldLabel` nie może
    // zwrócić wtedy `undefined`, bo wywołujący wstawia wynik w JSX.
    assert.equal(fieldLabel(''), '');
  });
});