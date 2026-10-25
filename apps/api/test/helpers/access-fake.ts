/* eslint-disable @typescript-eslint/no-explicit-any -- atrapa przyjmuje
 * argumenty szersze niż prawdziwy port, żeby pilnować kształtu wywołań;
 * wąskie typy każdej metody to osobne zadanie, dziś dawałyby fałszywe
 * `any`-casts w ośmiu miejscach naraz. */
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
  AccessVerificationRow,
  AccessVerificationWithApplication,
  PersonRow,
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
    /** Czyści zapis, żeby test mógł patrzeć tylko na własną operację. */
    wpisypierwszyReset: () => {
      wpisy.length = 0;
    },
  };
}

export type FakeDb = {
  port: AccessPort;
  osoby: PersonRow[];
  granty: ApplicationAccessRow[];
  aplikacje: ApplicationRefRow[];
  weryfikacje: AccessVerificationRow[];
};

/**
 * Atrapa jest **celowo niepobłażliwa**: odrzuca argumenty, których prawdziwy
 * Prisma nie przyjmuje.
 *
 * Pierwsza wersja przyjmowała wszystko — płaski `where: { applicationId,
 * personId }` zamiast złożonego klucza oraz `orderBy: 'lastName'` zamiast
 * obiektu. Wszystkie 863 testy przechodziły, a moduł zwracał 500 przy
 * każdym odczycie i zapisie. Atrapa, która akceptuje wywołanie, którego baza
 * odrzuci, jest gorsza niż brak testu: daje zielone przejście i fałszywy
 * spokój. Dlatego kształt argumentów jest tu pilnowany tak samo jak wynik.
 */
function kluczZlozony(where: unknown): { applicationId: string; personId: string } {
  const zagniezdzone = (where as { applicationId_personId?: { applicationId: string; personId: string } })
    ?.applicationId_personId;
  if (!zagniezdzone) {
    throw new Error(
      'atrapa: oczekiwano złożonego klucza `applicationId_personId`, ' +
        'tak jak wymaga Prisma dla klucza głównego złożonego',
    );
  }
  return zagniezdzone;
}

/** `orderBy` w Prisma to obiekt lub tablica obiektów, nie nazwa pola. */
function poleOrderBy(orderBy: unknown): [string, 'asc' | 'desc'] {
  if (typeof orderBy === 'string') {
    throw new Error(
      `atrapa: orderBy="${orderBy}" — Prisma przyjmuje obiekt, np. { ${orderBy}: 'asc' }`,
    );
  }
  // Tablica obiektów to poprawna postać w Prisma (`[{ a: 'asc' }, { b: 'asc' }]`);
  // bierzemy pierwszy klucz, bo atrapa sortuje jednym polem.
  if (Array.isArray(orderBy)) {
    if (orderBy.length === 0) throw new Error('atrapa: pusta tablica orderBy');
    return poleOrderBy(orderBy[0]);
  }
  const obiekt = (orderBy ?? {}) as Record<string, 'asc' | 'desc'>;
  const klucz = Object.keys(obiekt)[0];
  if (!klucz) throw new Error('atrapa: brak orderBy');
  return [klucz, obiekt[klucz] ?? 'asc'];
}

export function fakeDb(aplikacje: ApplicationRefRow[] = []): FakeDb {
  const weryfikacje: AccessVerificationRow[] = [];
  const osoby: PersonRow[] = [];
  const granty: ApplicationAccessRow[] = [];
  const aplikacjeMap = new Map(aplikacje.map((a) => [a.id, a]));

  /**
   * Sortowanie grantów wg `orderBy` macierzy (`application.name`, potem
   * `person.lastName`). Bez tego raport nie mógłby sprawdzić kolejności
   * wierszy: prawdziwa baza sortuje przy odczycie, więc atrapa musi odwzorować
   * ten sam skutek — inaczej test kolejności przechodziłby przypadkowo
   * w kolejności wstawiania.
   */
  function posortujGranty(wiersze: AccessGrantWithPerson[], orderBy: unknown): void {
    if (typeof orderBy === 'string') {
      throw new Error('atrapa: granty — orderBy musi być obiektem, nie napisem');
    }
    const warunki = Array.isArray(orderBy) ? orderBy : [orderBy];
    const sciezki = warunki
      .map((o) => {
        const zewnetrzny = Object.keys(o ?? {})[0];
        const wewnetrzny = Object.keys((o as Record<string, unknown>)?.[zewnetrzny!] ?? {})[0];
        return [zewnetrzny!, wewnetrzny!] as const;
      })
      .filter(([, wewnetrzny]) => Boolean(wewnetrzny));
    wiersze.sort((a, b) => {
      for (const [relacja, pole] of sciezki) {
        const odczyt = (g: AccessGrantWithPerson): string => {
          if (relacja === 'person') return String(g.person?.[pole as keyof PersonRow] ?? '');
          if (relacja === 'application') {
            // Sortowanie dzieje się przed dołączeniem relacji aplikacji, więc
            // nazwa czytana wprost z mapy aplikacji — jak robi to baza.
            return String(
              aplikacjeMap.get(g.applicationId)?.[pole as keyof ApplicationRefRow] ?? '',
            );
          }
          return '';
        };
        const porownanie = odczyt(a).localeCompare(odczyt(b));
        if (porownanie !== 0) return porownanie;
      }
      return 0;
    });
  }

  /**
   * Licznik w takim kształcie, w jakim zwraca go Prisma przy
   * `include: { _count: { select: { access: true } } }` — czyli jako `_count.access`.
   *
   * Atrapa, która sama dokładała `accessCount`, sprawiała, że serwis wyglądał
   * na działający, a na żywej bazie kolumna „Aplikacje” w katalogu osób
   * pokazywała `undefined`.
   */
  function zLicznikiem(osoba: PersonRow) {
    return {
      ...osoba,
      _count: { access: granty.filter((g) => g.personId === osoba.id).length },
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
        if (args?.orderBy) wynik.sort(wgOrderBy(args.orderBy));
        return wynik.map(zLicznikiem);
      },
      findFirst: async (args: any) => {
        const where = args?.where ?? {};
        return (
          osoby.find((p) =>
            Object.entries(where).every(([k, v]) => {
              // E-mail w bazie jest `@db.Citext` — „Jan@F.pl" i „jan@f.pl"
              // to jedna osoba, więc atrapa porównuje bez wielkości liter.
              if (k === 'email') return p.email.toLowerCase() === String(v).toLowerCase();
              return (p as Record<string, unknown>)[k] === v;
            }),
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
      delete: async (args: any) => {
        const i = osoby.findIndex((p) => p.id === args?.where?.id);
        if (i === -1) throw new Error('delete: brak osoby');
        // Kaskada — to baza robi `onDelete: Cascade` przy wierszu
        // `ApplicationAccess.person`, atrapa odwzorowuje ten sam skutek.
        for (let g = granty.length - 1; g >= 0; g--) {
          if (granty[g]!.personId === args.where.id) granty.splice(g, 1);
        }
        return osoby.splice(i, 1)[0]!;
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
        if (where.application?.is?.deliveryType?.not !== undefined) {
          const nieTen = where.application.is.deliveryType.not;
          wynik = wynik.filter((g) => aplikacjeMap.get(g.applicationId)?.deliveryType !== nieTen);
        }
        const zOsoba = wynik.map((g) => ({
          ...g,
          person: osoby.find((p) => p.id === g.personId)!,
        })) as AccessGrantWithPerson[];
        if (args?.orderBy) posortujGranty(zOsoba, args.orderBy);
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
        const where = kluczZlozony(args?.where);
        return (
          granty.find(
            (g) =>
              g.applicationId === where.applicationId && g.personId === where.personId,
          ) ?? null
        );
      },
      create: async (args: any) => {
        const grant: ApplicationAccessRow = {
          grantedOn: new Date('2026-01-01T00:00:00Z'),
          level: 'USER',
          note: null,
          expiresOn: null,
          // Nowy grant nie wchodzi zweryfikowany — znacznik stawia dopiero
          // wpis weryfikacji obejmujący ten grant.
          verifiedOn: null,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          ...args.data,
        };
        granty.push(grant);
        return grant;
      },
      update: async (args: any) => {
        const where = kluczZlozony(args.where);
        const i = granty.findIndex(
          (g) => g.applicationId === where.applicationId && g.personId === where.personId,
        );
        if (i === -1) throw new Error('update: brak grantu');
        granty[i] = { ...granty[i]!, ...args.data };
        return granty[i]!;
      },
      delete: async (args: any) => {
        const where = kluczZlozony(args.where);
        const i = granty.findIndex(
          (g) => g.applicationId === where.applicationId && g.personId === where.personId,
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
        // Nazwa aplikacji jest unikalna (`@db.Citext`) — import macierzy
        // rozpoznaje aplikacje z pliku właśnie po niej. Atrapa porównuje
        // bez wielkości liter, dokładnie jak citext w bazie.
        if (args?.where?.name !== undefined) {
          const szukana = String(args.where.name).toLowerCase();
          const aplikacja = [...aplikacjeMap.values()].find(
            (a) => a.name.toLowerCase() === szukana,
          );
          if (!aplikacja) return null;
          return { ...aplikacja };
        }
        const aplikacja = aplikacjeMap.get(args?.where?.id);
        if (!aplikacja) return null;
        // Kopiujemy wiersz, żeby test nie mutował stanu atrapy przez referencję.
        // (Poprzednia wersja nadpisywała `deletedAt` na `null` — eksport musiałby
        // przeoczyć aplikację usuniętą, więc atrapa pokazuje faktyczny rekord.)
        return { ...aplikacja };
      },
      findMany: async (args: any = {}) => {
        const where = args?.where ?? {};
        let wynik = [...aplikacjeMap.values()];
        if (where.deletedAt === null) {
          wynik = wynik.filter((a) => a.deletedAt === null);
        }
        if (where.deliveryType?.not !== undefined) {
          wynik = wynik.filter((a) => a.deliveryType !== where.deliveryType.not);
        }
        return wynik.map((a) => ({ ...a }));
      },
    },
    accessVerification: {
      findMany: async (args: any = {}) => {
        const where = args?.where ?? {};
        let wynik = [...weryfikacje];
        if (where.applicationId) {
          wynik = wynik.filter((w) => w.applicationId === where.applicationId);
        }
        if (where.scope) wynik = wynik.filter((w) => w.scope === where.scope);
        if (where.createdAt?.gt) {
          wynik = wynik.filter((w) => w.createdAt > where.createdAt!.gt!);
        }
        // Relacja aplikacji wchodzi wyłącznie na jawnym `include` — jak w
        // prawdziwym Prisma. Atrapa, która doklejała ją zawsze, zamaskowała
        // brak `include` w serwisie: na żywym API aplikacja wpisu pokazywała
        // się jako `null`.
        const zAplikacja = wynik.map((w) => ({
          ...w,
          application: args?.include?.application
            ? (w.applicationId ? aplikacjeMap.get(w.applicationId) ?? null : null)
            : undefined,
        })) as AccessVerificationWithApplication[];
        // Od najnowszej: `verifiedOn` malejąco, jak w raporcie przeglądów.
        if (args?.orderBy) {
          const warunki = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
          for (const warunek of warunki.slice().reverse()) {
            const [pole, kierunek] = Object.entries(warunek as Record<string, string>)[0]!;
            zAplikacja.sort((a, b) => {
              const odczyt = (w: AccessVerificationWithApplication): string => {
                const wartosc = (w as Record<string, unknown>)[pole];
                // Daty porównujemy po ISO — napisowa postać `Date`
                // sortuje po nazwach dni tygodnia, nie po kalendarzu.
                return wartosc instanceof Date ? wartosc.toISOString() : String(wartosc ?? '');
              };
              const porownanie = odczyt(a).localeCompare(odczyt(b));
              return kierunek === 'desc' ? -porownanie : porownanie;
            });
          }
        }
        return zAplikacja;
      },
      create: async (args: any) => {
        const wpis: AccessVerificationRow = {
          id: randomUUID(),
          // Jak `DEFAULT now()` w bazie: blokada 24 h liczy od createdAt
          // wpisu, więc atrapa musi stawiać **realną chwilę** zapisu,
          // nie stałą z datownika testów. Wpisy wsteczne wstawiają testy
          // wprost do tablicy `weryfikacje`.
          createdAt: new Date(),
          ...args.data,
        };
        weryfikacje.push(wpis);
        return wpis;
      },
    },
  } as unknown as AccessPort;

  return { port, osoby, granty, aplikacje: [...aplikacjeMap.values()], weryfikacje };
}

/** Sortowanie po jednej nazwie pola; wystarczy dla testów. */
function wgOrderBy(orderBy: unknown) {
  const [klucz, kierunek] = poleOrderBy(orderBy);
  return (a: PersonRow, b: PersonRow) => {
    // `person.lastName` z macierzy sortuje po nazwisku osoby — taka sama
    // semantyka, jaką daje Prisma przy `orderBy: { person: { lastName } }`.
    const sciezka = klucz.split('.');
    const wartosc = (osoba: PersonRow) =>
      String((osoba as Record<string, unknown>)[sciezka[sciezka.length - 1]!] ?? '');
    const wynik = wartosc(a).localeCompare(wartosc(b));
    return kierunek === 'desc' ? -wynik : wynik;
  };
}