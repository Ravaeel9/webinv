/**
 * Seed macierzy uprawnień — idempotentny i niezależny od bazy w teście.
 *
 * Test sprawdza dwie rzeczy, o których najczęściej zapominamy przy seedach:
 *
 *  - **ponowne uruchomienie nie mnoży danych.** Kontener startuje wielokrotnie,
 *    a seed bez upsertu po e-mailu po pięciu restartach pokazałby pięć kopii
 *    tej samej osoby w macierzy;
 *  - **przypisanie wisi na aplikacji po nazwie.** Demo-aplikacje mają losowe
 *    UUID, więc przypisanie po stałym identyfikatorze po prostu nie powstałoby
 *    na nowej instalacji — cicho, bez błędu.
 */
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  DEMO_ACCESS_DATA,
  seedDemoAccess,
  type DemoAccessSeeder,
} from '../src/seed/demo-access';

function atrapa(aplikacje: string[] = ['System kadrowy', 'Platforma do backupu']) {
  const osoby: Array<{ id: string; email: string }> = [];
  const przypisania: Array<{ klucz: string; poziom: string }> = [];

  const prisma: DemoAccessSeeder = {
    person: {
      upsert: async (args) => {
        const istniejaca = osoby.find((o) => o.email === args.where.email);
        if (istniejaca) {
          Object.assign(istniejaca, args.update);
          return istniejaca;
        }
        const nowa = { id: randomUUID(), ...args.create };
        osoby.push(nowa);
        return nowa;
      },
    },
    applicationAccess: {
      upsert: async (args) => {
        const klucz = `${args.where.applicationId_personId.applicationId}:${args.where.applicationId_personId.personId}`;
        const istniejace = przypisania.find((p) => p.klucz === klucz);
        if (istniejace) {
          istniejace.poziom = args.update.level;
          return istniejace;
        }
        przypisania.push({ klucz, poziom: args.create.level });
        return null;
      },
    },
    application: {
      findMany: async () => aplikacje.map((name) => ({ id: randomUUID(), name })),
    },
  };

  return { prisma, osoby, przypisania };
}

describe('Seed macierzy uprawnień', () => {
  it('wstawia osoby demonstracyjne z rozpoznawalną domeną', async () => {
    const { prisma, osoby } = atrapa();

    const wynik = await seedDemoAccess(prisma);

    assert.equal(wynik.persons, 3);
    assert.ok(
      osoby.every((o) => o.email.endsWith('@example.invalid')),
      'adresy demo muszą być rozpoznawalne jako nieprawdziwe',
    );
  });

  it('tworzy przypisania i pokazuje oba ostrzeżenia naraz', async () => {
    const { prisma } = atrapa();

    const wynik = await seedDemoAccess(prisma);

    assert.ok(wynik.grants >= 3, `oczekiwano przypisań, wyszło ${wynik.grants}`);
    assert.ok(
      DEMO_ACCESS_DATA.grants.some((g) => g.expiresOn !== null),
      'demo musi pokazywać wygasłe przypisanie',
    );
    assert.ok(
      DEMO_ACCESS_DATA.persons.some((p) => !p.isActive),
      'demo musi pokazywać osobę nieaktywną',
    );
  });

  it('ponowne uruchomienie nie duplikuje osób ani przypisań', async () => {
    const { prisma, osoby, przypisania } = atrapa();

    await seedDemoAccess(prisma);
    await seedDemoAccess(prisma);

    assert.equal(osoby.length, 3);
    assert.equal(
      przypisania.length,
      new Set(przypisania.map((p) => p.klucz)).size,
      'przypisania muszą być unikalne po parze aplikacja–osoba',
    );
  });

  it('brak aplikacji demo nie wywala seeda', async () => {
    const { prisma } = atrapa([]);

    const wynik = await seedDemoAccess(prisma);

    assert.equal(wynik.grants, 0);
  });
});