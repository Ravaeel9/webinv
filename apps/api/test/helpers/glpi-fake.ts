/**
 * Atrapa portu GLPI dla testów serwisu — ta sama filozofia co
 * `access-fake`: liczy tylko to, czego testy dotykają, ale odrzuca
 * wywołania, których prawdziwy Prisma by nie przyjął (np. płaski klucz
 * złożony). Tabela `settings` jest tu prawdziwą mapą klucz→wartość,
 * bo serwis przechowuje w niej konfigurację GLPI. Dziennik (`audit`)
 * jest **obok portu**, tak jak w serwisie — atrapa `fakeAudit` z helpera
 * accessowego zapisuje wpisy do wspólnej listy `wpisy`.
 */
import { randomUUID } from 'node:crypto';
import type { GlpiPort } from '../../src/glpi/glpi.port';
import { fakeAudit } from './access-fake';

export type FakeGlpiDb = {
  port: GlpiPort;
  audit: ReturnType<typeof fakeAudit>;
  ustawienia: Map<string, string>;
  osoby: Array<{ id: string; email: string }>;
  aplikacje: Array<{
    id: string;
    name: string;
    deletedAt: Date | null;
    deliveryType: string | null;
  }>;
  granty: Array<{ applicationId: string; personId: string; level: string }>;
  /** Ten sam zapis co `audit.wpisy` — wygodniejszy dostęp w asercjach. */
  wpisy: ReturnType<typeof fakeAudit>['wpisy'];
};

export function fakeGlpiDb(): FakeGlpiDb {
  const ustawienia = new Map<string, string>();
  const osoby: FakeGlpiDb['osoby'] = [];
  const aplikacje: FakeGlpiDb['aplikacje'] = [];
  const granty: FakeGlpiDb['granty'] = [];
  const audit = fakeAudit();

  const port: GlpiPort = {
    setting: {
      findUnique: async (args) =>
        ustawienia.has(args.where.key)
          ? { value: ustawienia.get(args.where.key)! }
          : null,
      upsert: async (args) => {
        ustawienia.set(args.where.key, args.update.value);
        return {};
      },
    },
    person: {
      findFirst: async (args) =>
        osoby.find((o) => o.email === args.where.email) ?? null,
      create: async (args) => {
        const osoba = { id: randomUUID(), email: args.data.email };
        osoby.push(osoba);
        return osoba;
      },
    },
    application: {
      findFirst: async (args) =>
        aplikacje.find(
          (a) =>
            a.name.toLowerCase() === args.where.name.toLowerCase() &&
            a.deletedAt === null,
        ) ?? null,
      create: async (args) => {
        // Rzut na kształt z `data`: pole `deliveryType` dochodzi dopiero
        // wraz z wyborem typu w imporcie oprogramowania (zanim powstanie,
        // atrapa rejestruje `null` i test patrzBehawioralny widzi to).
        const dane = args.data as { name: string; deliveryType?: string };
        const aplikacja = {
          id: randomUUID(),
          name: dane.name,
          deletedAt: null,
          deliveryType: dane.deliveryType ?? null,
        };
        aplikacje.push(aplikacja);
        return aplikacja;
      },
    },
    applicationAccess: {
      findFirst: async (args) => {
        // Szeroki typ na potrzeby gwardu: skoro port deklaruje filtry
        // skalarne, to wywołanie z kluczem złożonym musi być odrzucone.
        const where = (args?.where ?? {}) as {
          applicationId?: string;
          personId?: string;
          applicationId_personId?: unknown;
        };
        // Prisma `findFirst` NIE przyjmuje skrótu klucza złożonego
        // (`applicationId_personId`) — ta składnia jest wyłącznie dla
        // `findUnique`/`upsert`. Atrapa odrzuca go, żeby regresja
        // wywaliła testy, a nie produkcję (500 od Prisma).
        if (where.applicationId_personId) {
          throw new Error(
            'atrapa: findFirst dostępów nie przyjmuje klucza złożonego — ' +
              'użyj filtrów skalarskich { applicationId, personId }, jak wymaga Prisma',
          );
        }
        return (
          granty.find(
            (g) =>
              g.applicationId === where.applicationId &&
              g.personId === where.personId,
          ) ?? null
        );
      },
      create: async (args) => {
        // Prisma `create` przyjmuje wyłącznie `data` — klucz złożony
        // podajemy jako pola skalarne (applicationId, personId).
        if (!args.data?.applicationId || !args.data?.personId) {
          throw new Error('atrapa: create dostępów wymaga applicationId i personId w `data`');
        }
        const grant = {
          applicationId: args.data.applicationId,
          personId: args.data.personId,
          level: args.data.level,
        };
        granty.push(grant);
        return grant;
      },
    },
    $transaction: async <T>(operacja: () => Promise<T>) => operacja(),
  };

  return { port, audit, ustawienia, osoby, aplikacje, granty, wpisy: audit.wpisy };
}
