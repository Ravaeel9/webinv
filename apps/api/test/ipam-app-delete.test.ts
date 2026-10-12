/**
 * Soft delete aplikacji a przypisania IP (Review Focus 3 z przeglądu).
 *
 * Testy czysto logiczne, bez bazy. Atrapa jest jedna dla obu serwisów:
 * `ApplicationsService` soft-delete'uje aplikacja, `IpamService` zdejmuje
 * przypisania — a w produkcji obie operacje dzieją się w tej samej bazie.
 * Rzutowanie na `ConstructorParameters` jest nieuniknione z tego samego
 * powodu co w `settings-demo.test.ts`: w produkcji serwisy przyjmują
 * `PrismaService`, którego nie da się napisać atrapą.
 *
 * Dlaczego to pilnuje realnych błędów:
 *
 *  - **Aplikacja znika, adres zostaje zablokowany na zawsze.** Soft delete
 *    sam w sobie zostawia `IN_USE` przy adresie, do którego nie ma już
 *    żadnej aplikacji. Katalog pokazałby zajęty adres bez właściciela,
 *    a `removeAddress` odmawiałby jego skasowania — wyjście z blokady
 *    tylko przez ręczną edycję bazy.
 *  - **Kolejność operacji jest kontraktem.** Statusy adresów czytamy przed
 *    `deleteMany` na przypisaniach, a przestawiamy po nim — dopiero wtedy
 *    wiadomo, czy adres ma jeszcze żywego właściciela.
 *  - **Adres współdzielony musi zostać `IN_USE`, a `DEPRECATED` — nietknięty.**
 *    Nic w systemie nie przywraca `IN_USE` przy przypisaniu, a `DEPRECATED`
 *    jest decyzją katalogu, nie skutkiem przypisania.
 *  - **Transakcja tu nie jest atomowością.** Zapytania idą bazowym klientem
 *    Prisma, którego Prisma nie włącza w `$transaction(fn)`; test pilnuje
 *    kolejności, nie gwarancji „wszystko albo nic”.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { ApplicationsService } from '../src/applications/applications.service';
import { IpamService } from '../src/ipam/ipam.service';
import type { IpAddressStatus } from '../src/ipam/ipam.port';

/** Aktor testowy — dziennik musi wiedzieć, kto usuwał. */
const AKTOR = {
  id: 'u-1',
  username: 'admin',
  email: 'admin@firma.pl',
  fullName: 'Administrator Systemu',
  role: 'ADMIN',
  mustChangePassword: false,
} as const;

type WierszAplikacji = { id: string; name: string; deletedAt: Date | null };
type WierszAdresu = { id: string; address: string; status: IpAddressStatus };
type WierszPrzypisania = { applicationId: string; ipAddressId: string };

type Stan = {
  aplikacje?: WierszAplikacji[];
  adresy?: WierszAdresu[];
  przypisania?: WierszPrzypisania[];
  /** Atrapa rzuca z `ipAddress.updateMany` — symulacja awarii w bazie. */
  awariaPrzyOdblokowaniu?: boolean;
};

/**
 * Atrapa na potrzeby obu serwisów naraz.
 *
 * `$transaction` wycofuje zmiany po błędzie (kopia tablic sprzed
 * transakcji), bo chcemy widzieć, co zostaje po nieudanym `remove()`.
 * To mocniejsze niż brak transakcji w kodzie, więc test opisuje wyraźnie,
 * że chodzi o wycofanie atrapy, a nie o obietnicę atomowości Prisma.
 */
function atrapa(stan: Stan = {}) {
  const aplikacje = [...(stan.aplikacje ?? [])];
  const adresy = [...(stan.adresy ?? [])];
  const przypisania = [...(stan.przypisania ?? [])];

  const wywolania = {
    /** `application.update` z soft delete'em. */
    softDelete: [] as { where: { id: string }; data: { deletedAt: Date | null } }[],
    /** Filtry `application.findFirst` — na nich widać warunek `deletedAt`. */
    szukaneAplikacje: [] as { id: string; deletedAt?: null }[],
    /** `ipAddress.updateMany` — odblokowanie statusów. */
    odblokowaneAdresy: [] as { where: { id: { in: string[] } }; data: { status: string } }[],
    /** Filtry `applicationIpAddress.deleteMany`. */
    usunietePrzypisania: [] as { applicationId?: string }[],
    /** Kolejność operacji, po nazwie metody. */
    kolejnosc: [] as string[],
    transakcje: 0,
    zdarzenia: [] as { action: string; entityId?: string | null }[],
  };

  const prisma = {
    application: {
      findFirst: async ({ where }: { where: { id: string; deletedAt: null } }) => {
        wywolania.szukaneAplikacje.push(where);
        const znaleziona = aplikacje.find((a) => a.id === where.id);
        if (!znaleziona) return null;
        if (where.deletedAt === null && znaleziona.deletedAt !== null) return null;
        return { ...znaleziona };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { deletedAt: Date | null };
      }) => {
        wywolania.softDelete.push({ where, data });
        wywolania.kolejnosc.push('application.update');
        const wiersz = aplikacje.find((a) => a.id === where.id);
        if (!wiersz) throw new Error(`Brak aplikacji ${where.id}`);
        wiersz.deletedAt = data.deletedAt;
        return { ...wiersz };
      },
      /**
       * Odczyt „kto używa tego adresu": `ipAddresses.some` przekładamy na
       * tablicę przypisań, a `deletedAt: null` na pole w wierszu aplikacji.
       */
      findMany: async ({
        where,
      }: {
        where: { deletedAt: null; ipAddresses: { some: { ipAddressId: string } } };
      }) => {
        const { ipAddressId } = where.ipAddresses.some;
        return aplikacje
          .filter(
            (a) =>
              a.deletedAt === null &&
              przypisania.some((x) => x.applicationId === a.id && x.ipAddressId === ipAddressId),
          )
          .map((a) => ({ id: a.id, name: a.name, baseUrl: null }));
      },
    },
    applicationIpAddress: {
      findMany: async ({
        where,
      }: {
        where?: {
          applicationId?: string;
          ipAddressId?: string | { in: string[] };
          application?: { deletedAt: null };
        };
      } = {}) => {
        wywolania.kolejnosc.push('applicationIpAddress.findMany');
        return przypisania
          .filter((x) => !where?.applicationId || x.applicationId === where.applicationId)
          .filter((x) =>
            where?.ipAddressId === undefined
              ? true
              : typeof where.ipAddressId === 'string'
                ? x.ipAddressId === where.ipAddressId
                : where.ipAddressId.in.includes(x.ipAddressId),
          )
          // `application: { deletedAt: null }` to w SQL filtr po żywej
          // aplikacji — tu sprawdzamy go po wierszu aplikacji.
          .filter(
            (x) =>
              where?.application === undefined ||
              aplikacje.some((a) => a.id === x.applicationId && a.deletedAt === null),
          )
          .map((x) => ({ ...x }));
      },
      count: async ({ where }: { where: { ipAddressId: string } }) =>
        przypisania.filter((x) => x.ipAddressId === where.ipAddressId).length,
      deleteMany: async ({ where }: { where: { applicationId?: string } }) => {
        wywolania.usunietePrzypisania.push(where);
        wywolania.kolejnosc.push('applicationIpAddress.deleteMany');
        let usuniete = 0;
        for (let i = przypisania.length - 1; i >= 0; i -= 1) {
          const wiersz = przypisania[i];
          if (!wiersz) continue;
          if (where.applicationId !== undefined && wiersz.applicationId !== where.applicationId) {
            continue;
          }
          przypisania.splice(i, 1);
          usuniete += 1;
        }
        return usuniete;
      },
    },
    ipAddress: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const wiersz = adresy.find((a) => a.id === where.id);
        return wiersz ? { ...wiersz } : null;
      },
      // Statusy czytane PRZED skasowaniem przypisań — z nich widać, czy
      // adres był świadomie `DEPRECATED`.
      findMany: async ({ where }: { where?: { id?: { in: string[] } } } = {}) => {
        wywolania.kolejnosc.push('ipAddress.findMany');
        return adresy.filter((a) => !where?.id || where.id.in.includes(a.id)).map((a) => ({ ...a }));
      },
      delete: async ({ where }: { where: { id: string } }) => {
        wywolania.kolejnosc.push('ipAddress.delete');
        const indeks = adresy.findIndex((a) => a.id === where.id);
        const wiersz = adresy.splice(indeks, 1)[0];
        if (!wiersz) throw new Error(`Brak adresu ${where.id}`);
        for (let i = przypisania.length - 1; i >= 0; i -= 1) {
          if (przypisania[i]?.ipAddressId === where.id) przypisania.splice(i, 1);
        }
        return { ...wiersz };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: { in: string[] } };
        data: { status: IpAddressStatus };
      }) => {
        wywolania.odblokowaneAdresy.push({ where, data: { status: data.status } });
        wywolania.kolejnosc.push('ipAddress.updateMany');
        if (stan.awariaPrzyOdblokowaniu) throw new Error('Połączenie zerwane');
        let zmienione = 0;
        for (const wiersz of adresy) {
          if (!where.id.in.includes(wiersz.id)) continue;
          wiersz.status = data.status;
          zmienione += 1;
        }
        return zmienione;
      },
    },
    $transaction: async <T>(operacja: () => Promise<T>): Promise<T> => {
      wywolania.transakcje += 1;
      const kopiaAplikacji = aplikacje.map((a) => ({ ...a }));
      const kopiaAdresow = adresy.map((a) => ({ ...a }));
      const kopiaPrzypisan = przypisania.map((x) => ({ ...x }));
      try {
        return await operacja();
      } catch (e) {
        // Wycofanie transakcji — tak działa Prisma po błędzie w `$transaction`.
        aplikacje.splice(0, aplikacje.length, ...kopiaAplikacji);
        adresy.splice(0, adresy.length, ...kopiaAdresow);
        przypisania.splice(0, przypisania.length, ...kopiaPrzypisan);
        throw e;
      }
    },
  };

  const dziennik = {
    record: async (e: { action: string; entityId?: string | null }) => {
      wywolania.zdarzenia.push(e);
    },
  };

  const ipam = new IpamService(
    prisma as unknown as ConstructorParameters<typeof IpamService>[0],
    dziennik as never,
  );
  const apps = new ApplicationsService(
    prisma as unknown as ConstructorParameters<typeof ApplicationsService>[0],
    dziennik as never,
    ipam,
  );

  return { apps, ipam, wywolania, aplikacje, adresy, przypisania };
}

describe('Soft delete aplikacji zwalnia przypisane adresy', () => {
  it('zdejmuje przypisania i odblokowuje statusy w jednym wywołaniu transakcji', async () => {
    const { apps, wywolania, przypisania, adresy } = atrapa({
      aplikacje: [{ id: 'app-1', name: 'Panel klienta', deletedAt: null }],
      adresy: [
        { id: 'ip-a', address: '10.20.1.5', status: 'IN_USE' },
        { id: 'ip-b', address: '10.20.1.6', status: 'IN_USE' },
      ],
      przypisania: [
        { applicationId: 'app-1', ipAddressId: 'ip-a' },
        { applicationId: 'app-1', ipAddressId: 'ip-b' },
      ],
    });

    await apps.remove('app-1', AKTOR);

    // Kolejność, nie tylko stan końcowy: statusy czytamy PRZED
    // `deleteMany` (potem nie ma skąd), a przestawiamy PO nim — dopiero
    // wtedy wiadomo, czy adres ma jeszcze żywego właściciela.
    assert.deepEqual(wywolania.kolejnosc, [
      'application.update',
      'applicationIpAddress.findMany',
      'ipAddress.findMany',
      'applicationIpAddress.deleteMany',
      'applicationIpAddress.findMany',
      'ipAddress.updateMany',
    ]);
    assert.deepEqual(wywolania.odblokowaneAdresy, [
      { where: { id: { in: ['ip-a', 'ip-b'] } }, data: { status: 'FREE' } },
    ]);
    assert.deepEqual(przypisania, []);
    assert.deepEqual(
      adresy.map((a) => a.status),
      ['FREE', 'FREE'],
    );
    assert.equal(wywolania.transakcje, 1);
    assert.equal(wywolania.zdarzenia.filter((z) => z.action === 'app.deleted').length, 1);
  });

  it('adres współdzielony z żywą aplikacją zostaje IN_USE', async () => {
    // Bezwarunkowe `FREE` po zdejmowaniu jednego przypisania ustawiłoby ten
    // adres jako wolny mimo żywego przypisania — i nic w systemie nie
    // wróciłoby mu `IN_USE` (przypisanie statusu nie zmienia), więc błąd
    // zostawałby do poprawki ręcznej w bazie.
    const { apps, wywolania, adresy } = atrapa({
      aplikacje: [
        { id: 'app-1', name: 'Panel klienta', deletedAt: null },
        { id: 'app-2', name: 'Inna aplikacja', deletedAt: null },
      ],
      adresy: [{ id: 'ip-a', address: '10.20.1.5', status: 'IN_USE' }],
      przypisania: [
        { applicationId: 'app-1', ipAddressId: 'ip-a' },
        { applicationId: 'app-2', ipAddressId: 'ip-a' },
      ],
    });

    await apps.remove('app-1', AKTOR);

    assert.deepEqual(wywolania.odblokowaneAdresy, [
      { where: { id: { in: ['ip-a'] } }, data: { status: 'IN_USE' } },
    ]);
    assert.equal(adresy[0]?.status, 'IN_USE');
    assert.deepEqual(wywolania.usunietePrzypisania, [{ applicationId: 'app-1' }]);
  });

  it('nie cofa świadomie DEPRECATED przy zdejmowaniu przypisania', async () => {
    // `DEPRECATED` znaczy „wycofywany, czeka na zwolnienie" — decyzja
    // katalogu, a nie skutek przypisania. Zdjęcie przypisania nie ma jej
    // cofać, bo administrator kazał czekać.
    const { apps, wywolania, adresy } = atrapa({
      aplikacje: [{ id: 'app-1', name: 'Panel klienta', deletedAt: null }],
      adresy: [{ id: 'ip-a', address: '10.20.1.5', status: 'DEPRECATED' }],
      przypisania: [{ applicationId: 'app-1', ipAddressId: 'ip-a' }],
    });

    await apps.remove('app-1', AKTOR);

    assert.deepEqual(wywolania.odblokowaneAdresy, []);
    assert.equal(adresy[0]?.status, 'DEPRECATED');
    assert.deepEqual(wywolania.usunietePrzypisania, [{ applicationId: 'app-1' }]);
  });

  it('zamyka blokadę z Task 6: po usunięciu aplikacji adres da się skasować', async () => {
    // `removeAddress` liczy przypisania bez filtra `deletedAt`. Dopóki
    // przypisania usuniętej aplikacji zostają w bazie, odmawiałby skasowania
    // adresu, do którego nie ma już żadnej aplikacji — wyjście z blokady
    // tylko przez ręczną edycję bazy. Soft delete ma je zdejmować fizycznie.
    const { apps, ipam, wywolania } = atrapa({
      aplikacje: [{ id: 'app-1', name: 'Panel klienta', deletedAt: null }],
      adresy: [{ id: 'ip-a', address: '10.20.1.5', status: 'IN_USE' }],
      przypisania: [{ applicationId: 'app-1', ipAddressId: 'ip-a' }],
    });

    await apps.remove('app-1', AKTOR);

    // Karta adresu nie pokazuje już aplikacji usuniętej (filtr `deletedAt`).
    assert.deepEqual(await ipam.applicationsForAddress('ip-a'), []);
    await ipam.removeAddress('ip-a', AKTOR);
    assert.ok(wywolania.kolejnosc.includes('ipAddress.delete'));
  });

  it('nie usuwa aplikacji nieistniejącej ani usuniętej już wcześniej', async () => {
    const { apps, wywolania } = atrapa({
      aplikacje: [{ id: 'app-1', name: 'Panel klienta', deletedAt: new Date('2026-01-01') }],
    });
    await assert.rejects(() => apps.remove('app-nie-ma', AKTOR), NotFoundException);
    await assert.rejects(() => apps.remove('app-1', AKTOR), NotFoundException);
    // Warunek `deletedAt: null` musi być w zapytaniu — aplikacja usunięta
    // wcześniej istnieje w bazie i powtórne `remove()` musi ją zignorować.
    assert.deepEqual(wywolania.szukaneAplikacje[0], { id: 'app-nie-ma', deletedAt: null });
    assert.equal(wywolania.softDelete.length, 0);
    assert.equal(wywolania.transakcje, 0);
  });

  it('awaria przy przestawianiu statusów nie zostawia usuniętej aplikacji', async () => {
    // Atrapa wycofuje stan przy błędzie, emulując transakcję jednego
    // klienta. W produkcji zapytania idą bazowym klientem, którego Prisma
    // nie włącza w `$transaction(fn)` — atomowości nie ma, a to test
    // pilnuje tylko kolejności i tego, że wyjątek nie zostawia w dzienniku
    // zdarzenia o usunięciu, które się nie odbyło.
    const { apps, wywolania, aplikacje, przypisania, adresy } = atrapa({
      aplikacje: [{ id: 'app-1', name: 'Panel klienta', deletedAt: null }],
      adresy: [{ id: 'ip-a', address: '10.20.1.5', status: 'IN_USE' }],
      przypisania: [{ applicationId: 'app-1', ipAddressId: 'ip-a' }],
      awariaPrzyOdblokowaniu: true,
    });

    await assert.rejects(() => apps.remove('app-1', AKTOR));

    assert.equal(aplikacje[0]?.deletedAt, null, 'aplikacja musi zostać żywa');
    assert.deepEqual(przypisania, [{ applicationId: 'app-1', ipAddressId: 'ip-a' }]);
    assert.equal(adresy[0]?.status, 'IN_USE');
    assert.equal(wywolania.transakcje, 1);
    assert.equal(
      wywolania.zdarzenia.filter((z) => z.action === 'app.deleted').length,
      0,
      'dziennik nie mówi o usunięciu, które się nie odbyło',
    );
  });

  it('aplikacja bez przypisań nie odblokowuje żadnego adresu', async () => {
    const { apps, wywolania } = atrapa({
      aplikacje: [{ id: 'app-1', name: 'Panel klienta', deletedAt: null }],
      adresy: [{ id: 'ip-a', address: '10.20.1.5', status: 'DEPRECATED' }],
    });

    await apps.remove('app-1', AKTOR);

    assert.equal(wywolania.odblokowaneAdresy.length, 0);
    assert.equal(wywolania.usunietePrzypisania.length, 0);
  });

  it('nie zdejmuje przypisań innych aplikacji', async () => {
    const { apps, wywolania, przypisania } = atrapa({
      aplikacje: [
        { id: 'app-1', name: 'Panel klienta', deletedAt: null },
        { id: 'app-2', name: 'Inna aplikacja', deletedAt: null },
      ],
      adresy: [{ id: 'ip-b', address: '10.20.1.6', status: 'IN_USE' }],
      przypisania: [{ applicationId: 'app-2', ipAddressId: 'ip-b' }],
    });

    await apps.remove('app-1', AKTOR);

    assert.deepEqual(przypisania, [{ applicationId: 'app-2', ipAddressId: 'ip-b' }]);
    assert.equal(wywolania.odblokowaneAdresy.length, 0);
  });
});
