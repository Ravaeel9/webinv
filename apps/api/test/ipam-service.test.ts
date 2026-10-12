/**
 * Serwis podsieci — kontrakt na kontrolę zakresów.
 *
 * Testy czysto logiczne, bez bazy: `IpamService` rozmawia z Prisma przez
 * wąski port (`IpamPort`), więc cała jego powierzchnia da się sprawdzić
 * atrapą. Rzutowanie atrap na `ConstructorParameters` jest nieuniknione
 * z tego samego powodu co w `settings-demo.test.ts`: w produkcji serwis
 * przyjmuje `PrismaService` (klient z metodami połączenia), a port opisuje
 * tylko to, co serwis faktycznie woła.
 *
 * Dlaczego to pilnuje realnych błędów:
 *
 *  - **Kolizje wykrywamy po zakresie, nie po tekście.** `10.20.5.0/24`
 *    leży w `10.20.0.0/16` — SQL porównujący kolumny `cidr` tego nie
 *    zobaczy, a dwie podsieci na jednym zakresie to dwa katalogi
 *  wskazujące te same adresy.
 *  - **Zapisujemy znormalizowany `cidr.text`, nie surowe wejście.**
 *    `10.20.0.0/016` i `10.20.0.0/16` to ta sama sieć; przy surowym
 *    tekście kontrola kolizji i unikalność widziałyby dwa różne wiersze.
 *  - **Węższy CIDR nie może zostawić adresów za zakresem** — `update`
 *    odrzuca CAŁĄ zmianę, nim cokolwiek zapisze (żadne `subnet.update`).
 *  - **Nazwa kolidującej podsieci w komunikacie** — administrator ma
 *    wiedzieć, którą podsieć poprawić.
 */
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { IpamService } from '../src/ipam/ipam.service';
import { cidrErrorMessage } from '../src/ipam/cidr';
import type {
  IpAddressRow,
  IpAddressStatus,
  IpamPort,
  SubnetRow,
} from '../src/ipam/ipam.port';

/** Aktor testowy — dziennik musi wiedzieć, kto zapisywał. */
const AKTOR = {
  id: 'u-1',
  username: 'admin',
  email: 'admin@firma.pl',
  fullName: 'Administrator Systemu',
  role: 'ADMIN',
  mustChangePassword: false,
} as const;

/** Wiersz podsieci zgodny z modelem Prisma (nazwy kolumn, typy wierszy). */
function subnet(cidr: string, name: string, nadpisz: Partial<SubnetRow> = {}): SubnetRow {
  return {
    id: `id-${name}`,
    name,
    cidr,
    description: null,
    color: 'slate',
    vlan: null,
    location: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...nadpisz,
  };
}

/** Wiersz adresu — pola dokładnie z modelu `IpAddress`. */
function adres(
  subnetId: string,
  address: string,
  status: IpAddressStatus = 'FREE',
): IpAddressRow {
  return {
    id: `ip-${address}`,
    subnetId,
    address,
    status,
    description: null,
    lastSeenAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
}

/** Stan wpuszczany do atrapy portu. */
type StanPortu = {
  podsieci?: SubnetRow[];
  adresy?: IpAddressRow[];
  przypisania?: { ipAddressId: string }[];
};

/**
 * Atrap portu plus zapisane wywołania.
 *
 * Atrap nie udaje bazy idealnej — trzyma wiersze w tablicach i emuluje
 * kaskadę FK przy delete, bo testy `removeSubnet` mają widzieć, że
 * podsieci faktycznie zniknęła, a nie tylko że serwis zawołał `delete`.
 */
function port(stan: StanPortu = {}) {
  const podsieci = [...(stan.podsieci ?? [])];
  const adresy = [...(stan.adresy ?? [])];
  const przypisania = [...(stan.przypisania ?? [])];

  const wywolania = {
    create: [] as Record<string, unknown>[],
    update: [] as { where: { id: string }; data: Record<string, unknown> }[],
    deleteArgs: [] as { where: { id: string } }[],
    transakcje: 0,
    zdarzenia: [] as {
      action: string;
      entity: string;
      entityId?: string | null;
      actorId?: string | null;
      changes?: unknown;
    }[],
  };

  const p = {
    subnet: {
      findMany: async () => podsieci.map((s) => ({ ...s })),
      findUnique: async ({ where }: { where: { id: string } }) => {
        const s = podsieci.find((x) => x.id === where.id);
        return s ? { ...s } : null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        wywolania.create.push(data);
        const wiersz: SubnetRow = {
          id: `id-${data.name}`,
          name: String(data.name),
          cidr: String(data.cidr),
          description: (data.description ?? null) as string | null,
          color: (data.color as string) ?? 'slate',
          vlan: (data.vlan ?? null) as number | null,
          location: (data.location ?? null) as string | null,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        };
        podsieci.push(wiersz);
        return { ...wiersz };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        wywolania.update.push({ where, data });
        const indeks = podsieci.findIndex((s) => s.id === where.id);
        const wiersz = podsieci[indeks];
        for (const [pole, wartosc] of Object.entries(data)) {
          // `undefined` to „nie ruszaj pola" — dokładnie semantyka Prisma.
          if (wartosc !== undefined) {
            (wiersz as unknown as Record<string, unknown>)[pole] = wartosc;
          }
        }
        return { ...wiersz };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        wywolania.deleteArgs.push({ where });
        const indeks = podsieci.findIndex((s) => s.id === where.id);
        const wiersz = podsieci.splice(indeks, 1)[0];
        // Kaskada FK z schematu: adresy i ich przypisania znikają razem.
        for (const a of adresy.filter((x) => x.subnetId === where.id)) {
          adresy.splice(adresy.indexOf(a), 1);
          for (const p of przypisania.filter((x) => x.ipAddressId === a.id)) {
            przypisania.splice(przypisania.indexOf(p), 1);
          }
        }
        return { ...wiersz };
      },
    },
    ipAddress: {
      findMany: async ({ where }: { where?: { subnetId?: string } } = {}) =>
        adresy
          .filter((a) => !where?.subnetId || a.subnetId === where.subnetId)
          .map((a) => ({ ...a })),
      count: async ({ where }: { where: { subnetId: string } }) =>
        adresy.filter((a) => a.subnetId === where.subnetId).length,
    },
    applicationIpAddress: {
      findMany: async () => przypisania.map((x) => ({ ...x })),
    },
    $transaction: async <T>(operacja: () => Promise<T>): Promise<T> => {
      wywolania.transakcje++;
      return operacja();
    },
  } as unknown as IpamPort;

  // Dziennik to osobne wstrzyknięcie (`AuditService`), jak w `SettingsService`.
  const dziennik = {
    record: async (e: {
      action: string;
      entity: string;
      entityId?: string | null;
      actorId?: string | null;
      changes?: unknown;
    }) => {
      wywolania.zdarzenia.push(e);
    },
  };

  return { p, wywolania, dziennik };
}

/** Serwis z portem-atrap, bez bazy — wzorzec z `settings-demo.test.ts`. */
function serwis(p: IpamPort, dziennik: unknown = { record: async () => {} }) {
  return new IpamService(
    p as unknown as ConstructorParameters<typeof IpamService>[0],
    dziennik as never,
  );
}

describe('Tworzenie podsieci', () => {
  it('odrzuca podsieć nakładającą się na istniejącą', async () => {
    await assert.rejects(
      () =>
        serwis(port({ podsieci: [subnet('10.20.0.0/16', 'Produkcja')] }).p).createSubnet(
          { name: 'DMZ', cidr: '10.20.5.0/24' } as never,
          AKTOR,
        ),
      (e: Error & { response?: { message: string } }) => {
        // Nazwa kolidującej podsieci musi być w komunikacie — administrator
        // ma wiedzieć, którą podsieć powiększyć albo zmienić.
        const komunikat = e.response?.message ?? '';
        assert.match(komunikat, /Produkcja/);
        assert.match(komunikat, /\(10\.20\.0\.0\/16\)/);
        // Nakładanie zakresu to konflikt stanu z istniejącym zasobem —
        // spec §3 „Błędy" wymaga 409, nie 400.
        assert.ok(e instanceof ConflictException);
        return true;
      },
    );
  });

  it('nic nie zapisuje przy kolizji', async () => {
    const { p, wywolania } = port({ podsieci: [subnet('10.20.0.0/16', 'Produkcja')] });
    await assert.rejects(() =>
      serwis(p).createSubnet({ name: 'DMZ', cidr: '10.20.5.0/24' } as never, AKTOR),
    );
    assert.equal(wywolania.create.length, 0);
    assert.equal(wywolania.zdarzenia.length, 0);
  });

  it('dopuszcza podsieci rozłączne', async () => {
    const { p, wywolania } = port({ podsieci: [subnet('10.20.0.0/16', 'A')] });
    const detal = await serwis(p).createSubnet({ name: 'B', cidr: '10.30.0.0/16' } as never, AKTOR);
    assert.equal(detal.name, 'B');
    assert.deepEqual(detal.addresses, []);
    assert.equal(wywolania.create.length, 1);
  });

  it('odrzuca zły CIDR komunikatem prosto z cidr.ts', async () => {
    // Delegacja bez otoczki: to samo zdanie ma paść w DTO i w serwisie,
    // dwa źródła prawdy o jednym błędzie rozmijają się przy pierwszej zmianie.
    const { p, wywolania } = port();
    await assert.rejects(
      () => serwis(p).createSubnet({ name: 'X', cidr: '10.20.1.5/24' } as never, AKTOR),
      (e: Error & { response?: { message: string } }) => {
        assert.equal(e.response?.message, cidrErrorMessage('10.20.1.5/24'));
        return true;
      },
    );
    assert.equal(wywolania.create.length, 0);
  });

  it('zapisuje znormalizowany CIDR, nie surowe wejście', async () => {
    // Decyzja z przeglądu Task 4: „/016" i „/16" to ta sama sieć.
    // Gdyby trafił do bazy surowy tekst, kontrola kolizji i unikalność
    // widziałyby dwa różne wiersze dla jednego zakresu.
    const { p, wywolania } = port();
    await serwis(p).createSubnet({ name: 'A', cidr: '10.20.0.0/016' } as never, AKTOR);
    assert.equal(wywolania.create[0]?.cidr, '10.20.0.0/16');
  });

  it('dostrzega kolizję nawet wtedy, gdy zapisano ją jako /016', async () => {
    // Druga strona tej samej monety: walidacja musi porównywać zakresy
    // z parsera, a nie stringi — inaczej wariant z zerem wiodącym
    // przeszedłby obok istniejącej podsieci.
    const { p } = port({ podsieci: [subnet('10.20.0.0/16', 'Produkcja')] });
    await assert.rejects(
      () => serwis(p).createSubnet({ name: 'Duplikat', cidr: '10.20.0.0/016' } as never, AKTOR),
      (e: Error & { response?: { message: string } }) => {
        assert.match(e.response?.message ?? '', /Produkcja/);
        return true;
      },
    );
  });

  it('loguje utworzenie w dzienniku', async () => {
    const { p, wywolania, dziennik } = port();
    await serwis(p, dziennik).createSubnet({ name: 'A', cidr: '10.20.0.0/16' } as never, AKTOR);
    assert.equal(wywolania.zdarzenia.length, 1);
    const zdarzenie = wywolania.zdarzenia[0];
    assert.equal(zdarzenie.action, 'subnet.created');
    assert.equal(zdarzenie.entity, 'Subnet');
    assert.equal(zdarzenie.actorId, 'u-1');
  });
});

describe('Lista podsieci', () => {
  it('liczy adresy, przypisania i wolne adresy osobno na podsieć', async () => {
    const a = subnet('10.20.0.0/24', 'A');
    const b = subnet('10.30.0.0/24', 'B');
    const { p } = port({
      // Odwrotna kolejność w bazie niż oczekiwana na liście — sort
      // musi wychodzić po zakresie, nie po kolejności wierszy.
      podsieci: [b, a],
      adresy: [
        adres(a.id, '10.20.0.5', 'FREE'),
        adres(a.id, '10.20.0.6', 'IN_USE'),
        adres(a.id, '10.20.0.7', 'IN_USE'),
      ],
      // Adres .7 z dwiema aplikacjami to nadal JEDNO przypisane miejsce —
      // licznik liczy adresy z co najmniej jednym przypisaniem.
      przypisania: [
        { ipAddressId: 'ip-10.20.0.6' },
        { ipAddressId: 'ip-10.20.0.7' },
        { ipAddressId: 'ip-10.20.0.7' },
      ],
    });

    const lista = await serwis(p).listSubnets();
    assert.deepEqual(
      lista.map((s) => ({
        name: s.name,
        addressCount: s.addressCount,
        applicationCount: s.applicationCount,
        freeCount: s.freeCount,
      })),
      [
        { name: 'A', addressCount: 3, applicationCount: 2, freeCount: 1 },
        { name: 'B', addressCount: 0, applicationCount: 0, freeCount: 0 },
      ],
    );
  });
});

describe('Pobieranie podsieci', () => {
  it('zwraca adresy posortowane numerycznie', async () => {
    const a = subnet('10.20.0.0/24', 'A');
    const { p } = port({
      podsieci: [a],
      // Leksykograficznie „10.20.0.40" < „10.20.0.5" — katalog pokazywałby
      // adresy w szyfrującej kolejności, więc sort musi iść po liczbie.
      adresy: [adres(a.id, '10.20.0.40'), adres(a.id, '10.20.0.5')],
    });
    const detal = await serwis(p).getSubnet(a.id);
    assert.deepEqual(detal.addresses.map((x) => x.address), ['10.20.0.5', '10.20.0.40']);
  });

  it('rzuca NotFound na nieistniejący identyfikator', async () => {
    const { p } = port();
    await assert.rejects(
      () => serwis(p).getSubnet(randomUUID()),
      (e: Error) => {
        assert.ok(e instanceof NotFoundException);
        assert.match((e as NotFoundException).message, /Podsieć nie istnieje\./);
        return true;
      },
    );
  });
});

describe('Aktualizacja podsieci', () => {
  it('węższy CIDR nieobejmujący adresów odrzuca CAŁĄ zmianę', async () => {
    // Review Focus 2: PATCH zmieniający nazwę I zwężający zakres do
    // postaci bez adresu 10.20.5.5 nie może zapisać ani nazwy —
    // częściowo zastosowany PATCH byłby gorszy niż brak PATCH-u.
    const a = subnet('10.20.0.0/16', 'Produkcja');
    const { p, wywolania, dziennik } = port({
      podsieci: [a],
      adresy: [adres(a.id, '10.20.5.5')],
    });

    await assert.rejects(
      () =>
        serwis(p, dziennik).updateSubnet(
          a.id,
          { name: 'Po zmianie', cidr: '10.20.0.0/24' } as never,
          AKTOR,
        ),
      (e: Error) => {
        assert.ok(e instanceof BadRequestException);
        assert.match((e as BadRequestException).message, /10\.20\.5\.5/);
        return true;
      },
    );
    assert.equal(
      wywolania.update.length,
      0,
      'subnet.update nie może zostać wywołany, skoro zmiana odrzucona',
    );
    assert.equal(wywolania.zdarzenia.length, 0);
  });

  it('węższy CIDR obejmujący wszystkie adresy przechodzi i normalizuje', async () => {
    const a = subnet('10.20.0.0/16', 'Produkcja');
    const { p, wywolania } = port({ podsieci: [a], adresy: [adres(a.id, '10.20.0.5')] });
    await serwis(p).updateSubnet(a.id, { cidr: '10.20.0.0/024' } as never, AKTOR);
    assert.equal(wywolania.update[0]?.data.cidr, '10.20.0.0/24');
  });

  it('odrzuca CIDR kolidujący z inną podsiecią', async () => {
    const { p, wywolania } = port({
      podsieci: [subnet('10.20.0.0/16', 'Produkcja'), subnet('10.30.0.0/16', 'Biuro')],
    });
    await assert.rejects(
      () =>
        serwis(p).updateSubnet('id-Biuro', { cidr: '10.20.0.0/16' } as never, AKTOR),
      (e: Error & { response?: { message: string } }) => {
        assert.match(e.response?.message ?? '', /Produkcja/);
        // Ścieżka PATCH sygnalizuje kolizję tak samo jak create: 409.
        assert.ok(e instanceof ConflictException);
        return true;
      },
    );
    assert.equal(wywolania.update.length, 0);
  });

  it('nie koliduje sama ze sobą', async () => {
    // Wykluczenie własnego wiersza jest konieczne: każdy PATCH z CIDR
    // (nawet niezmienionym) kolizowałby z zapisanym wcześniej sobą.
    const a = subnet('10.20.0.0/16', 'Produkcja');
    const { p, wywolania } = port({ podsieci: [a], adresy: [adres(a.id, '10.20.5.5')] });
    await serwis(p).updateSubnet(a.id, { cidr: '10.20.0.0/16' } as never, AKTOR);
    assert.equal(wywolania.update.length, 1);
  });

  it('audytuje zmianę diffem przed/po', async () => {
    const a = subnet('10.20.0.0/16', 'Produkcja');
    const { p, wywolania, dziennik } = port({ podsieci: [a] });
    await serwis(p, dziennik).updateSubnet(a.id, { name: 'Core' } as never, AKTOR);
    assert.equal(wywolania.zdarzenia.length, 1);
    const zdarzenie = wywolania.zdarzenia[0];
    assert.equal(zdarzenie.action, 'subnet.updated');
    assert.equal(zdarzenie.entityId, a.id);
    assert.deepEqual(zdarzenie.changes, { name: { from: 'Produkcja', to: 'Core' } });
  });

  it('pusty PATCH nic nie zapisuje', async () => {
    const a = subnet('10.20.0.0/16', 'Produkcja');
    const { p, wywolania, dziennik } = port({ podsieci: [a] });
    const detal = await serwis(p, dziennik).updateSubnet(a.id, {} as never, AKTOR);
    assert.equal(wywolania.update.length, 0);
    assert.equal(detal.name, 'Produkcja');
  });

  it('rzuca NotFound na nieistniejącej podsieci', async () => {
    const { p } = port();
    await assert.rejects(
      () => serwis(p).updateSubnet(randomUUID(), { name: 'X' } as never, AKTOR),
      NotFoundException,
    );
  });
});

describe('Usuwanie podsieci', () => {
  it('kasuje kaskadowo w transakcji z jednym wpisem do dziennika', async () => {
    const a = subnet('10.20.0.0/16', 'Produkcja');
    const { p, wywolania, dziennik } = port({
      podsieci: [a],
      adresy: [adres(a.id, '10.20.5.5')],
      przypisania: [{ ipAddressId: 'ip-10.20.5.5' }],
    });

    await serwis(p, dziennik).removeSubnet(a.id, AKTOR);

    assert.deepEqual(wywolania.deleteArgs, [{ where: { id: a.id } }]);
    assert.equal(wywolania.transakcje, 1, 'kasowanie i dziennik w jednej transakcji');
    assert.equal(wywolania.zdarzenia.length, 1, 'jeden wpis zbiorczy');
    assert.equal(wywolania.zdarzenia[0].action, 'subnet.deleted');
    assert.equal(wywolania.zdarzenia[0].entity, 'Subnet');
    // Kaskada FK usunęła adresy razem z podsiecią.
    assert.equal((await serwis(p).listSubnets()).length, 0);
  });

  it('rzuca NotFound i nie kasuje nieistniejącej podsieci', async () => {
    const { p, wywolania } = port();
    await assert.rejects(() => serwis(p).removeSubnet(randomUUID(), AKTOR), NotFoundException);
    assert.equal(wywolania.deleteArgs.length, 0);
  });
});
