/**
 * Oznaczenie `is_demo` musi być spójne w trzech miejscach.
 *
 * Migracja nadaje flagę istniejącym rekordom **po nazwie**, a seed
 * ustawia ją przy zapisie. Jeśli ktoś dopisze program demonstracyjny
 * do seeda i zapomni o wpisaniu go do migracji, jego dane nigdy nie
 * dostaną flagi — a przycisk „usuń dane demo" pozostawi je w bazie
 * na zawsze. Nie ma żadnego błędu: seed zapisuje poprawnie, migracja
 * jest poprawna, dane są „demo" tylko z perspektywy seeda.
 *
 * Dlatego lista nazw musi mieć trzy zgodne wystąpienia, a ten test
 * pilnuje tego zamiast komentarza.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { DEMO_DATA } from '../src/seed/demo-applications';
import { read } from './helpers/repo';

const migration = read(
  'apps',
  'api',
  'prisma',
  'migrations',
  '20261011120000_settings_demo_mode',
  'migration.sql',
);

/** Nazwy wymienione w `UPDATE ... SET is_demo = true`. */
function nazwyWMigracji(): string[] {
  const start = migration.indexOf('SET "is_demo" = true');
  assert.notEqual(start, -1, 'migracja nie nadaje flagi is_demo');

  const lista = migration.slice(start, migration.indexOf(');', start));

  return [...lista.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('Lista danych demonstracyjnych', () => {
  it('migracja wymienia dokładnie te rekordy, które wstawia seed', () => {
    const zMigracji = nazwyWMigracji().sort();
    const zSeeda = DEMO_DATA.map((r) => r.name).sort();

    const brakWMigracji = zSeeda.filter((n) => !zMigracji.includes(n));
    const brakWSeedicie = zMigracji.filter((n) => !zSeeda.includes(n));

    assert.deepEqual(
      brakWMigracji,
      [],
      'te rekordy dostaną is_demo przy zapisie, ale nie przy migracji — ' +
        'dane istniejące przed migracją zostaną bez flagi i przycisk ' +
        '„usuń dane demo" ich nie skasuje',
    );

    assert.deepEqual(
      brakWSeedicie,
      [],
      'migracja oznacza nazwy, których seed już nie tworzy — mogłyby ' +
        'trafić na rekord prawdziwy o tej nazwie',
    );
  });

  it('kolumna is_demo ma wartość domyślną false', () => {
    // Przypadek odwrotny: `DEFAULT true` oznaczałoby, że każdy rekord
    // dodany ręcznie w przyszłości jest demonstracyjny, a przycisk
    // kasujący zmiotłby prawdziwe dane.
    const schema = read('apps', 'api', 'prisma', 'schema.prisma');
    assert.match(
      schema,
      /isDemo\s+Boolean\s+@default\(false\)/,
      'is_demo bez @default(false) — rekordy tworzone przez człowieka ' +
        'dostałyby flagę demo',
    );
  });

  it('migracja tworzy indeks częściowy, a nie zwykły', () => {
    assert.match(
      migration,
      /CREATE INDEX "applications_is_demo_idx"[\s\S]*?WHERE "is_demo" = true/,
      'indeks ma obejmować tylko is_demo = true — zwykły B-tree na ' +
        'kolumnie wypełnionej głównie false jest prawie bezużyteczny',
    );
  });
});