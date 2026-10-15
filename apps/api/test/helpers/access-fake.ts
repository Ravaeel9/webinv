/**
 * Atrapa `AccessPort` dla testów serwisu macierzy.
 *
 * Serwis rozmawia z bazą przez port (jak `IpamService` przez `IpamPort`),
 * więc całą jego logikę — walidację, kolejność sprawdzeń, budowę
 * `changes` dla dziennika — da się sprawdzić bez bazy. Atrapa jest
 * świadomie uproszczona: liczy tylko to, czego testy faktycznie dotykają.
 */
import { randomUUID } from 'node:crypto';
import type {
  AccessPort,
  PersonRow,
  PersonWithCounts,
  ApplicationAccessRow,
  AccessGrantWithPerson,
  AccessGrantWithRelations,
  ApplicationRefRow,
} from '../../src/access/access.port';

export type FakeAuditEntry = {
  action: string;
  entity: string;
  entityId: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
};

export function fakeAudit() {
  const wpisy: FakeAuditEntry[] = [];
  return {
    wpisy,
    record: async (wpis: FakeAuditEntry) => {
      wpisy.push(wpis);
    },
  };
}

export type FakeDb = {
  port: AccessPort;
  osoby: PersonRow[];
  granty: ApplicationAccessRow[];
  aplikacje: ApplicationRefRow[];
};

export function fakeDb(aplikacje: ApplicationRefRow[] = []): FakeDb {
  const osoby: PersonRow[] = [];
  const granty: ApplicationAccessRow[] = [];
  const aplikacjeMap = new Map(aplikacje.map((a) => [a.id, a]));

  function zLicznikiem(osoba: PersonRow): PersonWithCounts {
    return {
      ...osoba,
      accessCount: granty.filter((g) => g.personId === osoba.id).length,
    };
  }

  const port = {
    person: {
      findMany: async (args: any = {}) => {
        const where = args?.where ?? {};
        let wynik = [...osoby];
        if (where.email) wynik = wynik.filter((p) => p.email === where.email);
        if (where.isActive !== undefined) {
          wynik = wynik.filter((p) => p.isActive === where.isActive);
        }
        if (where.department) wynik = wynik.filter((p) => p.department === where.department);
        if (where.OR) {
          const warunki = where.OR;
          wynik = wynik.filter((p) =>
            warunki.some((w: Record<string, { contains: string }>) =>
              Object.entries(w).every(([pole, filtr]) => {
                const wzor = filtr as { contains: string };
                return String((p as Record<string, unknown>)[pole] ?? '')
                  .toLowerCase()
                  .includes(wzor.contains.toLowerCase());
              }),
            ),
          );
        }
        if (args?.orderBy) wynik.sort(wgOrderBy(args.orderBy, osoby));
        return wynik.map(zLicznikiem);
      },
      findFirst: async (args: any) => {
        const where = args?.where ?? {};
        return (
          osoby.find((p) =>
            Object.entries(where).every(([k, v]) => (p as Record<string, unknown>)[k] === v),
          ) ?? null
        );
      },
      findUnique: async (args: any) =>
        osoby.find((p) => p.id === args?.where?.id) ?? null,
      create: async (args: any) => {
        const osoba: PersonRow = {
          id: randomUUID(),
          isActive: true,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          ...args.data,
        };
        osoby.push(osoba);
        return osoba;
      },
      update: async (args: any) => {
        const i = osoby.findIndex((p) => p.id === args.where.id);
        if (i === -1) throw new Error('update: brak osoby');
        osoby[i] = { ...osoby[i]!, ...args.data, updatedAt: new Date('2026-06-01T00:00:00Z') };
        return osoby[i]!;
      },
      count: async (args: any = {}) => {
        const where = args?.where ?? {};
        return osoby.filter((p) =>
          Object.entries(where).every(([k, v]) => (p as Record<string, unknown>)[k] === v),
        ).length;
      },
    },
    applicationAccess: {
      findMany: async (args: any = {}) => {
        const where = args?.where ?? {};
        let wynik = [...granty];
        if (where.applicationId) {
          wynik = wynik.filter((g) => g.applicationId === where.applicationId);
        }
        if (where.personId) wynik = wynik.filter((g) => g.personId === where.personId);
        if (where.level) wynik = wynik.filter((g) => g.level === where.level);
        if (where.person?.isActive !== undefined) {
          wynik = wynik.filter(
            (g) => osoby.find((p) => p.id === g.personId)?.isActive === where.person.isActive,
          );
        }
        const zOsoba = wynik.map((g) => ({
          ...g,
          person: osoby.find((p) => p.id === g.personId)!,
        })) as AccessGrantWithPerson[];
        if (args?.include?.person === false) {
          return zOsoba.map(({ person: _p, ...reszta }) => reszta);
        }
        if (args?.include?.application) {
          return zOsoba.map(
            (g) =>
              ({
                ...g,
                application: aplikacjeMap.get(g.applicationId)!,
              }) as AccessGrantWithRelations,
          );
        }
        return zOsoba;
      },
      findUnique: async (args: any) => {
        const where = args?.where ?? {};
        return (
          granty.find(
            (g) =>
              Object.entries(where).every(
                ([k, v]) => (g as Record<string, unknown>)[k] === v,
              ),
          ) ?? null
        );
      },
      create: async (args: any) => {
        const grant: ApplicationAccessRow = {
          grantedOn: new Date('2026-01-01T00:00:00Z'),
          level: 'USER',
          note: null,
          expiresOn: null,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          ...args.data,
        };
        granty.push(grant);
        return grant;
      },
      update: async (args: any) => {
        const i = granty.findIndex(
          (g) => g.applicationId === args.where.applicationId && g.personId === args.where.personId,
        );
        if (i === -1) throw new Error('update: brak grantu');
        granty[i] = { ...granty[i]!, ...args.data };
        return granty[i]!;
      },
      delete: async (args: any) => {
        const i = granty.findIndex(
          (g) => g.applicationId === args.where.applicationId && g.personId === args.where.personId,
        );
        if (i === -1) throw new Error('delete: brak grantu');
        const [usuniety] = granty.splice(i, 1);
        return usuniety!;
      },
      count: async (args: any = {}) => {
        const where = args?.where ?? {};
        return granty.filter((g) =>
          Object.entries(where).every(([k, v]) => (g as Record<string, unknown>)[k] === v),
        ).length;
      },
    },
    application: {
      findUnique: async (args: any) => {
        const aplikacja = aplikacjeMap.get(args?.where?.id);
        if (!aplikacja) return null;
        return { ...aplikacja, deletedAt: args?.where?.deletedAt === null ? null : null };
      },
    },
  } as unknown as AccessPort;

  return { port, osoby, granty, aplikacje };
}

/** Sortowanie po jednej nazwie pola; wystarczy dla testów. */
function wgOrderBy(orderBy: string | undefined, _osoby: PersonRow[]) {
  return (a: PersonRow, b: PersonRow) => {
    const klucz = (orderBy ?? 'lastName') as keyof PersonRow;
    const rekord = (osoba: PersonRow) => String(osoba[klucz] ?? '');
    return rekord(a).localeCompare(rekord(b));
  };
}