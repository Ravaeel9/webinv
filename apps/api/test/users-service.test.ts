/**
 * Serwis użytkowników — reguły, które chronią konto administracyjne.
 *
 * Testy dotykają trzech decyzji, których drogie byłoby pilnować dopiero
 * na produkcji:
 *
 *  - **Walidacja przed zapisem.** Siła hasła i duplikaty sprawdza się
 *    w serwisie, zanim cokolwiek trafi do bazy (zgodnie z konwencją
 *    z AGENTS.md) — atrapa bazy pilnuje tu tylko kształtu wywołań.
 *  - **Zostaje się z super adminem.** Degradacja, wyłączenie albo
 *    usunięcie ostatniego aktywnego konta SUPER_ADMIN musi być
 *    odrzucone, inaczej panel trafia w martwy punkt bez wyjścia.
 *  - **Sesje gasną natychmiast.** Wyłączenie konta i zmiana roli
 *    cofają wszystkie sesje — stare uprawnienia nie mogą działać
 *    w otwartej przeglądarce.
 */
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from '../src/users/users.service';
import { fakeAudit } from './helpers/access-fake';
import type { AuthUser } from '../src/auth/decorators';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { SessionsService } from '../src/auth/sessions.service';

const ADMIN: AuthUser = {
  id: randomUUID(),
  username: 'admin',
  email: 'admin@firma.pl',
  fullName: 'Anna Administrator',
  role: 'SUPER_ADMIN',
  mustChangePassword: false,
};

const SILNE_HASLO = 'Poprawne-1!Haslo';

type UserRow = {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'VIEWER';
  isActive: boolean;
  mustChangePassword: boolean;
  passwordHash?: string;
  passwordChangedAt?: Date;
  lastLoginAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function wiersz(nadpisz: Partial<UserRow> = {}): UserRow {
  return {
    id: randomUUID(),
    username: 'jan',
    email: 'jan@firma.pl',
    fullName: 'Jan Kowalski',
    role: 'VIEWER',
    isActive: true,
    mustChangePassword: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...nadpisz,
  };
}

/**
 * Atrapa modelu `user` — obsługuje wyłącznie zapytania, których serwis
 * faktycznie używa. Świadomie niepobłażliwa wobec `where` innego niż
 * `{ id }` (findUnique/update/delete) albo `{ OR | id: { not } }`
 * (findFirst), bo atrapa przyjmująca wszystko ukryłaby błędy zapytań.
 */
function fakeUsers(seed: UserRow[] = []) {
  const users = [...seed];
  const revoked: string[] = [];
  const usunieci: string[] = [];

  const whereId = (where: unknown) => {
    const id = (where as { id?: string } | undefined)?.id;
    if (!id) throw new Error('atrapa: oczekiwano where: { id }');
    return id;
  };

  const prisma = {
    user: {
      findUnique: async (args: { where: { id: string } }) =>
        users.find((u) => u.id === whereId(args.where)) ?? null,
      findFirst: async (args: { where: Record<string, unknown> }) => {
        const where = args.where;
        const warunki = (where.OR as Record<string, unknown>[]) ?? [where];
        return (
          users.find((u) =>
            warunki.some((w) =>
              Object.entries(w).every(([k, v]) => {
                const wartosc = (u as Record<string, unknown>)[k];
                if (typeof v === 'object' && v !== null && 'not' in v) {
                  return wartosc !== (v as { not: unknown }).not;
                }
                // `username` to CITEXT — baza porównuje bez względu
                // na wielkość liter, atrapa musi robić to samo.
                if (k === 'username') {
                  return String(wartosc).toLowerCase() === String(v).toLowerCase();
                }
                return wartosc === v;
              }),
            ),
          ) ?? null
        );
      },
      create: async (args: { data: Record<string, unknown> }) => {
        const zapisany: UserRow = {
          ...wiersz(),
          ...args.data,
        } as UserRow;
        users.push(zapisany);
        // Serwis zwraca przez `select: USER_SELECT` — bez pola hasła.
        const { passwordHash: _h, passwordChangedAt: _c, ...widoczny } = zapisany;
        return widoczny as UserRow;
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const i = users.findIndex((u) => u.id === whereId(args.where));
        if (i === -1) throw new Error('update: brak użytkownika');
        users[i] = { ...users[i]!, ...args.data } as UserRow;
        return users[i]!;
      },
      delete: async (args: { where: { id: string } }) => {
        const id = whereId(args.where);
        const i = users.findIndex((u) => u.id === id);
        if (i === -1) throw new Error('delete: brak użytkownika');
        const [usuniety] = users.splice(i, 1);
        usunieci.push(id);
        return usuniety!;
      },
      count: async (args: { where: Record<string, unknown> }) => {
        const where = args.where;
        return users.filter((u) =>
          Object.entries(where).every(
            ([k, v]) => (u as Record<string, unknown>)[k] === v,
          ),
        ).length;
      },
    },
  } as unknown as PrismaService;

  const sessions = {
    revokeAllForUser: async (id: string) => {
      revoked.push(id);
      return 1;
    },
  } as unknown as SessionsService;

  return { prisma, sessions, users, revoked, usunieci };
}

function serwis(dane: ReturnType<typeof fakeUsers>) {
  return new UsersService(dane.prisma, fakeAudit() as never, dane.sessions);
}

const NOWE_KONTO = {
  username: 'jan.nowak',
  email: 'jan.nowak@firma.pl',
  fullName: 'Jan Nowak',
  password: SILNE_HASLO,
};

describe('UsersService — tworzenie konta', () => {
  it('tworzy konto z domyślną rolą VIEWER i wymogą zmiany hasła', async () => {
    const dane = fakeUsers();
    const s = serwis(dane);

    const user = await s.create(NOWE_KONTO, ADMIN);

    assert.equal(user.role, 'VIEWER');
    assert.equal(user.mustChangePassword, true);
    assert.equal(user.isActive, true);
    assert.ok(!(user as { passwordHash?: string }).passwordHash);
  });

  it('odrzuca zbyt słabe hasło, zanim cokolwiek trafi do bazy', async () => {
    const dane = fakeUsers();
    const s = serwis(dane);

    await assert.rejects(
      () => s.create({ ...NOWE_KONTO, password: 'slabe' }, ADMIN),
      BadRequestException,
    );
    assert.equal(dane.users.length, 0, 'atrapa bazy nie powinna zobaczyć zapisu');
  });

  it('odrzuca duplikat nazwy użytkownika bez względu na wielkość liter', async () => {
    const dane = fakeUsers([wiersz({ username: 'Jan.Nowak' })]);
    const s = serwis(dane);

    await assert.rejects(
      () => s.create({ ...NOWE_KONTO, email: 'inne@firma.pl' }, ADMIN),
      ConflictException,
    );
  });

  it('odrzuca duplikat adresu e-mail', async () => {
    const dane = fakeUsers([wiersz({ email: NOWE_KONTO.email })]);
    const s = serwis(dane);

    await assert.rejects(() => s.create(NOWE_KONTO, ADMIN), ConflictException);
  });
});

describe('UsersService — samookaleczenie i ostatni super admin', () => {
  it('nie pozwala wyłączyć własnego konta', async () => {
    const dane = fakeUsers([wiersz({ id: ADMIN.id, role: 'ADMIN' })]);
    const s = serwis(dane);

    await assert.rejects(
      () => s.update(ADMIN.id, { isActive: false }, ADMIN),
      BadRequestException,
    );
  });

  it('nie pozwala zmienić własnej roli', async () => {
    const dane = fakeUsers([wiersz({ id: ADMIN.id, role: 'ADMIN' })]);
    const s = serwis(dane);

    await assert.rejects(
      () => s.update(ADMIN.id, { role: 'VIEWER' }, ADMIN),
      BadRequestException,
    );
  });

  it('nie pozwala usunąć własnego konta', async () => {
    const dane = fakeUsers([wiersz({ id: ADMIN.id, role: 'ADMIN' })]);
    const s = serwis(dane);

    await assert.rejects(() => s.remove(ADMIN.id, ADMIN), BadRequestException);
    assert.equal(dane.usunieci.length, 0);
  });

  it('blokuje degradację ostatniego aktywnego super admina', async () => {
    const dane = fakeUsers([wiersz({ id: ADMIN.id, role: 'SUPER_ADMIN' })]);
    const s = serwis(dane);

    await assert.rejects(
      () => s.update(ADMIN.id, { role: 'ADMIN' }, ADMIN),
      (blad: unknown) => {
        assert.ok(blad instanceof BadRequestException);
        assert.match(blad.message, /super administratora/);
        return true;
      },
    );
  });

  it('pozwala zdegradować super admina, gdy istnieje drugi aktywny', async () => {
    const dane = fakeUsers([
      wiersz({ id: ADMIN.id, role: 'SUPER_ADMIN' }),
      wiersz({ role: 'SUPER_ADMIN' }),
    ]);
    const s = serwis(dane);
    const drugi = dane.users.find((u) => u.id !== ADMIN.id)!;

    const user = await s.update(drugi.id, { role: 'ADMIN' }, ADMIN);
    assert.equal(user.role, 'ADMIN');
  });

  it('blokuje usunięcie ostatniego aktywnego super admina', async () => {
    const dane = fakeUsers([wiersz({ id: ADMIN.id, role: 'SUPER_ADMIN' })]);
    const s = serwis(dane);

    await assert.rejects(
      () => s.remove(randomUUID(), ADMIN),
      NotFoundException,
    );
    await assert.rejects(
      () => s.remove(dane.users[0]!.id, ADMIN),
      BadRequestException,
    );
  });
});

describe('UsersService — sesje i audyt', () => {
  it('wyłączenie konta cofa sesje i zapisuje to w audycie', async () => {
    const cel = wiersz();
    const dane = fakeUsers([cel]);
    const audyt = fakeAudit();
    const s = new UsersService(dane.prisma, audyt as never, dane.sessions);

    const user = await s.update(cel.id, { isActive: false }, ADMIN);

    assert.equal(user.isActive, false);
    assert.deepEqual(dane.revoked, [cel.id]);
    const akcje = audyt.wpisy.map((w) => w.action);
    assert.ok(akcje.includes('user.sessions_revoked'), `akcje: ${akcje.join(', ')}`);
  });

  it('zmiana roli również cofa sesje', async () => {
    const cel = wiersz({ role: 'ADMIN' });
    const dane = fakeUsers([cel]);
    const s = serwis(dane);

    await s.update(cel.id, { role: 'VIEWER' }, ADMIN);

    assert.deepEqual(dane.revoked, [cel.id]);
  });

  it('zwykła edycja (imię i nazwisko) nie rusza sesji', async () => {
    const cel = wiersz();
    const dane = fakeUsers([cel]);
    const s = serwis(dane);

    await s.update(cel.id, { fullName: 'Jan K. Nowak' }, ADMIN);

    assert.deepEqual(dane.revoked, []);
  });

  it('usunięcie konta cofa sesje, kasuje wiersz i zapisuje audyt', async () => {
    const cel = wiersz({ role: 'ADMIN' });
    const dane = fakeUsers([cel]);
    const audyt = fakeAudit();
    const s = new UsersService(dane.prisma, audyt as never, dane.sessions);

    await s.remove(cel.id, ADMIN);

    assert.equal(dane.usunieci.length, 1);
    assert.deepEqual(dane.revoked, [cel.id]);
    assert.ok(audyt.wpisy.some((w) => w.action === 'user.deleted'));
  });

  it('odrzuca operacje na nieistniejącym koncie', async () => {
    const dane = fakeUsers();
    const s = serwis(dane);

    await assert.rejects(
      () => s.update(randomUUID(), { fullName: 'X Y' }, ADMIN),
      NotFoundException,
    );
    await assert.rejects(() => s.get(randomUUID()), NotFoundException);
  });
});
