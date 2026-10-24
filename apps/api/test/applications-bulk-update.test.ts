/**
 * Testy masowej aktualizacji aplikacji.
 *
 * Obejmują dwie warstwy: walidację DTO (dokładnie tym samym potokiem,
 * co `ValidationPipe` w `main.ts`) oraz logikę serwisu na atrapie Prisma —
 * tylko podane pola się zmieniają, środowiska nadpisują zestaw,
 * a dziennik dostaje po wpisie na każdą zmienioną aplikację.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { ApplicationsService } from '../src/applications/applications.service';
import { BulkUpdateApplicationDto } from '../src/applications/dto/application.dto';
import { fakeAudit } from './helpers/access-fake';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';
const UUID_ENV = '44444444-4444-4444-8444-444444444444';
const UUID_ENV2 = '55555555-5555-4555-8555-555555555555';
const UUID_ENV_ZLY = '66666666-6666-4666-8666-666666666666';

/** Opcje muszą pokrywać się z `ValidationPipe` w src/main.ts. */
const TRANSFORM_OPTIONS = { enableImplicitConversion: false } as const;

async function check(payload: Record<string, unknown>) {
  const instance = plainToInstance(BulkUpdateApplicationDto, payload, TRANSFORM_OPTIONS);
  const errors = await validate(instance as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return {
    instance,
    errors: errors.map((e) => Object.values(e.constraints ?? {}).join('; ')),
  };
}

// ─── Atrapa Prisma ────────────────────────────────────────────
//
// Atrapa jest celowo uproszczona, ale niepobłażliwa co do kształtu
// wywołań: `$transaction` dostaje funkcję, `update` wymaga `where.id`
// i scalą wyłącznie pola skalarne.

type FakeApp = {
  id: string;
  name: string;
  version: string;
  deliveryType: string;
  status: string;
  securityClass: string;
  criticality: number;
  accessRequestRequired: boolean;
  description: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  owner: null;
  admins: unknown[];
  createdBy: null;
  environments: { environment: { id: string; name: string; color: string; sortOrder: number } }[];
};

function fakePrisma(aplikacje: FakeApp[], srodowiska: { id: string; name: string }[] = []) {
  const updates: { id: string; data: Record<string, unknown> }[] = [];

  return {
    updates,
    environment: {
      count: async ({ where }: { where: { id: { in: string[] } } }) =>
        srodowiska.filter((e) => where.id.in.includes(e.id)).length,
    },
    application: {
      findMany: async ({ where }: { where: { id: { in: string[] }; deletedAt: null } }) =>
        // Kopie, nie referencje: Prisma zwraca snapshot z bazy, a później
        // `update` mutuje rekord. Gdyby testował before i after na tym
        // samym obiekcie, diff dziennika nie widziałby żadnej zmiany.
        aplikacje
          .filter((a) => where.id.in.includes(a.id) && a.deletedAt === null)
          .map((a) => ({ ...a })),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        if (!where?.id) {
          throw new Error('atrapa: update wymaga `where: { id }`');
        }
        updates.push({ id: where.id, data });
        const app = aplikacje.find((a) => a.id === where.id);
        if (!app) throw new Error('atrapa: nie ma takiej aplikacji');
        const { environments, ...skalary } = data;
        Object.assign(app, skalary, { updatedAt: new Date() });
        if (environments) {
          if (
            typeof environments !== 'object' ||
            environments === null ||
            !('deleteMany' in environments)
          ) {
            throw new Error('atrapa: nadpisanie środowisk wymaga `deleteMany` + `create`');
          }
          const { create } = environments as unknown as {
            create: { environment: { connect: { id: string } } }[];
          };
          app.environments = create.map((c) => {
            const env = srodowiska.find((e) => e.id === c.environment.connect.id);
            if (!env) throw new Error('atrapa: connect po nieistniejącym środowisku');
            return { environment: { ...env, color: 'slate', sortOrder: 0 } };
          });
        }
        return { ...app };
      },
    },
    $transaction: async (fn: () => Promise<void>) => fn(),
  };
}

function aplikacja(id: string, nadpisane: Partial<FakeApp> = {}): FakeApp {
  return {
    id,
    name: `Aplikacja ${id.slice(0, 4)}`,
    version: '1.0',
    deliveryType: 'GENERAL_USE',
    status: 'PROD',
    securityClass: 'INTERNAL',
    criticality: 2,
    accessRequestRequired: false,
    description: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    owner: null,
    admins: [],
    createdBy: null,
    environments: [],
    ...nadpisane,
  };
}

function service(prisma: ReturnType<typeof fakePrisma>) {
  return new ApplicationsService(
    prisma as never,
    fakeAudit() as never,
    {} as never,
  );
}

describe('BulkUpdateApplicationDto — walidacja', () => {
  it('przyjmuje poprawny ładunek (ids + jedno pole)', async () => {
    const { errors } = await check({ ids: [UUID_A], status: 'IN_USE' });
    assert.deepEqual(errors, []);
  });

  it('wymaga niepustej listy identyfikatorów', async () => {
    const { errors } = await check({ ids: [], status: 'IN_USE' });
    assert.equal(errors.length > 0, true, 'pusta lista ids powinien być błędem');
  });

  it('wymaga listy identyfikatorów, nie pojedynczej wartości', async () => {
    const { errors } = await check({ ids: UUID_A });
    assert.equal(errors.length > 0, true, 'ids jako string powinien być błędem');
  });

  it('odrzuca identyfikator, który nie jest UUID', async () => {
    const { errors } = await check({ ids: ['nie-uuid'] });
    assert.equal(errors.length > 0, true, 'zły UUID powinien być błędem');
  });

  it('odrzuca pole poza białą listą (np. name)', async () => {
    const { errors } = await check({ ids: [UUID_A], name: 'Nowa nazwa' });
    assert.equal(errors.length > 0, true, 'masowa zmiana nazwy nie jest dozwolona');
  });

  it('odrzuca nieznaną wartość statusu i typu dostarczenia', async () => {
    const { errors } = await check({ ids: [UUID_A], status: 'NIEZNANY' });
    assert.equal(errors.length > 0, true, 'zły status powinien być błędem');
    const { errors: errors2 } = await check({ ids: [UUID_A], deliveryType: 'NIEZNANY' });
    assert.equal(errors2.length > 0, true, 'zły typ dostarczenia powinien być błędem');
  });

  it('odrzuca krytyczność poza zakresem 1-4', async () => {
    const { errors } = await check({ ids: [UUID_A], criticality: 5 });
    assert.equal(errors.length > 0, true, 'krytyczność 5 powinna być błędem');
  });

  it('odrzuca środowisko, które nie jest UUID', async () => {
    const { errors } = await check({ ids: [UUID_A], environmentIds: ['nie-uuid'] });
    assert.equal(errors.length > 0, true, 'zły UUID środowiska powinien być błędem');
  });

  it('transformuje wniosek o dostęp na boolean', async () => {
    const { instance, errors } = await check({ ids: [UUID_A], accessRequestRequired: 'true' });
    assert.deepEqual(errors, []);
    assert.strictEqual(instance.accessRequestRequired, true);
  });
});

describe('bulkUpdate — logika serwisu', () => {
  it('aktualizuje tylko pola podane w ładunku', async () => {
    const prisma = fakePrisma([aplikacja(UUID_A), aplikacja(UUID_B)]);
    const svc = service(prisma);

    const wynik = await svc.bulkUpdate(
      { ids: [UUID_A, UUID_B], status: 'DEPRECATED' } as BulkUpdateApplicationDto,
      { id: 'u1', username: 'admin' } as never,
    );

    assert.equal(wynik.updated, 2);
    assert.deepEqual(wynik.skipped, []);
    assert.equal(prisma.updates.length, 2);
    // Sedno semantyki: pola nieobecne w ładunku nie mogą zostać nadpisane.
    for (const { data } of prisma.updates) {
      assert.equal('securityClass' in data, false);
      assert.equal('criticality' in data, false);
      assert.equal('deliveryType' in data, false);
      assert.equal('description' in data, false);
      assert.deepEqual(data.status, 'DEPRECATED');
    }
    assert.equal(prisma.updates.every((u) => u.data.status === 'DEPRECATED'), true);
  });

  it('nadpisuje cały zestaw środowisk wybranym', async () => {
    const rekord = aplikacja(UUID_A, {
      environments: [{ environment: { id: UUID_ENV2, name: 'test', color: 'slate', sortOrder: 0 } }],
    });
    const prisma = fakePrisma([rekord], [{ id: UUID_ENV, name: 'prod' }]);
    const svc = service(prisma);

    const wynik = await svc.bulkUpdate(
      { ids: [UUID_A], environmentIds: [UUID_ENV] } as BulkUpdateApplicationDto,
      { id: 'u1', username: 'admin' } as never,
    );

    assert.equal(wynik.updated, 1);
    const zapis = prisma.updates[0];
    assert.equal('environments' in zapis.data, true);
    // Aplikacja miała `test`, a po masowej aktualizacji ma dokładnie `prod`.
    assert.deepEqual(
      rekord.environments.map((e) => e.environment.id),
      [UUID_ENV],
    );
  });

  it('pomija identyfikatory nieistniejących i usuniętych aplikacji', async () => {
    const prisma = fakePrisma([
      aplikacja(UUID_A),
      aplikacja(UUID_B, { deletedAt: new Date() }),
    ]);
    const svc = service(prisma);

    const wynik = await svc.bulkUpdate(
      { ids: [UUID_A, UUID_B, UUID_C], status: 'RETIRED' } as BulkUpdateApplicationDto,
      { id: 'u1', username: 'admin' } as never,
    );

    assert.equal(wynik.updated, 1);
    assert.deepEqual(wynik.skipped.sort(), [UUID_B, UUID_C]);
    assert.equal(prisma.updates.length, 1);
  });

  it('odrzuca żądanie bez żadnego pola do aktualizacji', async () => {
    const prisma = fakePrisma([aplikacja(UUID_A)]);
    const svc = service(prisma);

    await assert.rejects(
      () =>
        svc.bulkUpdate(
          { ids: [UUID_A] } as BulkUpdateApplicationDto,
          { id: 'u1', username: 'admin' } as never,
        ),
      (err: unknown) => err instanceof BadRequestException,
    );
    assert.equal(prisma.updates.length, 0);
  });

  it('odrzuca żądanie ze środowiskiem, które nie istnieje — nic nie zapisuje', async () => {
    const prisma = fakePrisma(
      [aplikacja(UUID_A)],
      [{ id: UUID_ENV, name: 'prod' }],
    );
    const svc = service(prisma);

    await assert.rejects(
      () =>
        svc.bulkUpdate(
          { ids: [UUID_A], environmentIds: [UUID_ENV_ZLY] } as BulkUpdateApplicationDto,
          { id: 'u1', username: 'admin' } as never,
        ),
      (err: unknown) => err instanceof BadRequestException,
    );
    assert.equal(prisma.updates.length, 0);
  });

  it('zapisuje po jednym wpisie dziennika na zmienioną aplikację', async () => {
    const prisma = fakePrisma([aplikacja(UUID_A), aplikacja(UUID_B, { status: 'TEST' })]);
    const audit = fakeAudit();
    const svc = new ApplicationsService(prisma as never, audit as never, {} as never);

    await svc.bulkUpdate(
      { ids: [UUID_A, UUID_B], status: 'DEV' } as BulkUpdateApplicationDto,
      { id: 'u1', username: 'admin' } as never,
    );

    assert.equal(audit.wpisy.length, 2);
    for (const wpis of audit.wpisy) {
      assert.equal(wpis.action, 'app.bulk_updated');
      assert.equal(wpis.entity, 'Application');
      assert.ok(
        wpis.entityId === UUID_A || wpis.entityId === UUID_B,
        'każdy wpis wskazuje zmienioną aplikację',
      );
      assert.ok(wpis.changes && 'status' in wpis.changes, 'diff zawiera zmieniony status');
    }
  });
});
