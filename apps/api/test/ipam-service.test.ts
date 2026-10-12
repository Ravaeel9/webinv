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
 *
 * Adresy mają trzy warstwy własnych reguł: adres musi leżeć w zakresie
 * podsieci i nie może być jej adresem sieciowym ani rozgłoszeniowym
 * (/31 i /32 to wyjątek — tam oba są adresem hosta), a `P2002` z bazy
 * musi trafić do użytkownika jako 409 zamiast 500.
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

/** Aplikacja w atrapie — tylko pola, których wymaga `applicationsForAddress`. */
type AplikacjaAtrapy = {
  id: string;
  name: string;
  baseUrl: string | null;
  /** Soft delete — `null` znaczy aplikacja żywa. */
  deletedAt: Date | null;
};

/** Stan wpuszczany do atrapy portu. */
type StanPortu = {
  podsieci?: SubnetRow[];
  adresy?: IpAddressRow[];
  przypisania?: { ipAddressId: string; applicationId?: string }[];
  aplikacje?: AplikacjaAtrapy[];
  /**
   * Atrapa udaje kolizję unikalności dokładnie tak, jak robi to Prisma:
   * rzuca błędem z kodem `P2002`. Testy sprawdzają, że serwis potrafi
   * przetłumaczyć go na 409 — bez tego użytkownik dostałby 500 i komunikat
   * „Unique constraint failed on the fields: (`subnetId`,`address`)".
   */
  kolizjaWbazie?: boolean;
  /**
   * Kod błędu rzucanego zamiast P2002 przy zapisie adresu. Pozwala udawać
   * INNY błąd bazy niż kolizja, żeby sprawdzić, że serwis nie etykietuje
   * go komunikatem o duplikacie.
   */
  kodBleduPrzyZapisie?: string;
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
  const aplikacje = [...(stan.aplikacje ?? [])];

  const wywolania = {
    create: [] as Record<string, unknown>[],
    update: [] as { where: { id: string }; data: Record<string, unknown> }[],
    deleteArgs: [] as { where: { id: string } }[],
    /** Zapisane `data` z `ipAddress.create` — tu sprawdzamy `lastSeenAt`. */
    utworzoneAdresy: [] as Record<string, unknown>[],
    poprawioneAdresy: [] as { where: { id: string }; data: Record<string, unknown> }[],
    usunieteAdresy: [] as { where: { id: string } }[],
    /** Argumenty `applicationIpAddress.count` — na nich widać brak filtra. */
    liczbyPrzypisan: [] as { ipAddressId: string }[],
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
      findMany: async ({
        where,
      }: { where?: { subnetId?: string; address?: string } } = {}) =>
        adresy
          .filter((a) => !where?.subnetId || a.subnetId === where.subnetId)
          .filter((a) => !where?.address || a.address === where.address)
          .map((a) => ({ ...a })),
      findUnique: async ({ where }: { where: { id: string } }) => {
        const a = adresy.find((x) => x.id === where.id);
        return a ? { ...a } : null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        wywolania.utworzoneAdresy.push(data);
        if (stan.kodBleduPrzyZapisie) {
          // Błąd inny niż kolizja (np. `P2025`) ma dotrzeć do użytkownika
          // w oryginalnej postaci, a nie jako „adres już zarejestrowany”.
          throw Object.assign(new Error('Record not found'), {
            code: stan.kodBleduPrzyZapisie,
          });
        }
        if (stan.kolizjaWbazie) {
          // Kształt zgłoszony przez Prisma dla `@@unique([subnetId, address])`.
          throw Object.assign(
            new Error('Unique constraint failed on the fields: (`subnetId`,`address`)'),
            { code: 'P2002' },
          );
        }
        const wiersz: IpAddressRow = {
          id: `ip-${data.address}`,
          subnetId: String(data.subnetId),
          address: String(data.address),
          status: data.status as IpAddressStatus,
          description: (data.description ?? null) as string | null,
          lastSeenAt: (data.lastSeenAt ?? null) as Date | null,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        };
        adresy.push(wiersz);
        return { ...wiersz };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        wywolania.poprawioneAdresy.push({ where, data });
        if (stan.kolizjaWbazie && data.address !== undefined) {
          // Prisma zgłasza P2002 także przy zmianie kolizyjnego tekstu —
          // mamy to samo ograniczenie co przy `create`.
          throw Object.assign(
            new Error('Unique constraint failed on the fields: (`subnetId`,`address`)'),
            { code: 'P2002' },
          );
        }
        const wiersz = adresy.find((a) => a.id === where.id);
        for (const [pole, wartosc] of Object.entries(data)) {
          // `undefined` to „nie ruszaj pola" — dokładnie semantyka Prisma.
          if (wartosc !== undefined) {
            (wiersz as unknown as Record<string, unknown>)[pole] = wartosc;
          }
        }
        return { ...wiersz };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        wywolania.usunieteAdresy.push({ where });
        const indeks = adresy.findIndex((a) => a.id === where.id);
        const wiersz = adresy.splice(indeks, 1)[0];
        // Kaskada FK z schematu: przypisania znikają razem z adresem.
        for (let i = przypisania.length - 1; i >= 0; i -= 1) {
          if (przypisania[i]?.ipAddressId === where.id) przypisania.splice(i, 1);
        }
        return { ...wiersz };
      },
      count: async ({ where }: { where: { subnetId: string } }) =>
        adresy.filter((a) => a.subnetId === where.subnetId).length,
    },
    applicationIpAddress: {
      findMany: async ({ where }: { where?: { ipAddressId?: string } } = {}) =>
        przypisania
          .filter((x) => !where?.ipAddressId || x.ipAddressId === where.ipAddressId)
          .map((x) => ({ ...x })),
      count: async ({ where }: { where: { ipAddressId: string } }) => {
        wywolania.liczbyPrzypisan.push(where);
        return przypisania.filter((x) => x.ipAddressId === where.ipAddressId).length;
      },
    },
    application: {
      findFirst: async () => null,
      /**
       * Atrapa relacji: `ipAddresses.some` przekładamy na tablicę przypisań,
       * a `deletedAt: null` na pole w wierszu aplikacji. Dzięki temu test
       * widzi, że serwis przestał wypytywać aplikacje usunięte miękko.
       */
      findMany: async ({
        where,
      }: {
        where: { deletedAt: null; ipAddresses: { some: { ipAddressId: string } } };
      }) => {
        const { ipAddressId } = where.ipAddresses.some;
        const uzyte = new Set(
          przypisania
            .filter((x) => x.ipAddressId === ipAddressId && x.applicationId)
            .map((x) => x.applicationId),
        );
        return aplikacje
          .filter((a) => a.deletedAt === null && uzyte.has(a.id))
          .map((a) => ({ id: a.id, name: a.name, baseUrl: a.baseUrl }));
      },
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

/** Podsieć używana w testach adresów: /16 z zarezerwowanym zakresem. */
const PODNET = subnet('10.20.0.0/16', 'Produkcja');

/** Aktor przy zapisach — podpis zgodny z `AuthUser` jak w testach podsieci. */
function aplikacja(
  id: string,
  name: string,
  baseUrl: string | null = null,
  deletedAt: Date | null = null,
): AplikacjaAtrapy {
  return { id, name, baseUrl, deletedAt };
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

// ─── Adresy IP ────────────────────────────────────────────────

describe('Tworzenie adresów', () => {
  it('odrzuca adres spoza podsieci', async () => {
    const { p, wywolania } = port({ podsieci: [PODNET], adresy: [] });
    await assert.rejects(
      () => serwis(p).createAddress(PODNET.id, { address: '10.21.0.5' }, AKTOR),
      (e: Error & { response?: { message: string } }) => {
        // Zakres podsieci w komunikacie — użytkownik ma widzieć, gdzie
        // może dodawać adresy, zamiast zgadywać z samego błędu 400.
        const komunikat = e.response?.message ?? '';
        assert.ok(e instanceof BadRequestException);
        assert.match(komunikat, /poza zakresem/);
        assert.match(komunikat, /10\.20\.0\.0\/16/);
        return true;
      },
    );
    assert.equal(wywolania.utworzoneAdresy.length, 0, 'wiersz nie może powstać mimo błędu');
  });

  it('odrzuca niepoprawny format adresu', async () => {
    const { p, wywolania } = port({ podsieci: [PODNET] });
    await assert.rejects(
      () => serwis(p).createAddress(PODNET.id, { address: '10.20.1' }, AKTOR),
      BadRequestException,
    );
    assert.equal(wywolania.utworzoneAdresy.length, 0);
  });

  it('odrzuca duplikat adresu w podsieci', async () => {
    const { p, wywolania } = port({
      podsieci: [PODNET],
      adresy: [adres(PODNET.id, '10.20.1.5')],
    });
    await assert.rejects(
      () => serwis(p).createAddress(PODNET.id, { address: '10.20.1.5' }, AKTOR),
      (e: Error & { status?: number; response?: { message: string } }) => {
        // Review Focus 4 — wyjątek z bazy (P2002) dałby 500 i komunikat
        // "Unique constraint failed" zamiast zdania dla człowieka.
        const komunikat = e.response?.message ?? '';
        assert.equal(e.status, 409);
        assert.ok(e instanceof ConflictException);
        assert.equal(komunikat, 'Adres 10.20.1.5 jest już zarejestrowany w tej podsieci.');
        return true;
      },
    );
    assert.equal(wywolania.utworzoneAdresy.length, 0);
  });

  it('ten sam adres w innej podsieci nie jest duplikatem', async () => {
    // Unikalność w schemacie to `@@unique([subnetId, address])`, a nie sam
    // `address`: dwa katalogi mogą dzielić adres w różnych podsieciach.
    const inna = subnet('10.30.0.0/16', 'Biuro');
    const { p, wywolania } = port({
      podsieci: [PODNET, inna],
      adresy: [adres(inna.id, '10.20.1.5')],
    });
    await serwis(p).createAddress(PODNET.id, { address: '10.20.1.5' }, AKTOR);
    assert.equal(wywolania.utworzoneAdresy.length, 1);
  });

  it('odrzuca adres sieciowy i rozgłoszeniowy', async () => {
    // Ani 10.20.0.0/16 jako host, ani 10.20.255.255 — to adresy specjalne,
    // a katalog ma opisywać adresy hostów.
    const { p, wywolania } = port({ podsieci: [PODNET] });
    await assert.rejects(
      () => serwis(p).createAddress(PODNET.id, { address: '10.20.0.0' }, AKTOR),
      BadRequestException,
    );
    await assert.rejects(
      () => serwis(p).createAddress(PODNET.id, { address: '10.20.255.255' }, AKTOR),
      BadRequestException,
    );
    assert.equal(wywolania.utworzoneAdresy.length, 0);
  });

  it('dopuszcza oba adresy w podsieci /31 i /32', async () => {
    // Jedyny wyjątek od reguły: w /31 i /32 adres sieciowy i rozgłoszeniowy
    // to ten sam adres hosta (RFC 3021), więc odrzucanie byłoby odejściem
    // od realnych punktów-punkt i adresów zarządzanych.
    const para = subnet('10.20.0.0/31', 'Punkt-punkt');
    const { p: pp, wywolania: ppW } = port({ podsieci: [para] });
    await serwis(pp).createAddress(para.id, { address: '10.20.0.0' }, AKTOR);
    await serwis(pp).createAddress(para.id, { address: '10.20.0.1' }, AKTOR);

    const host = subnet('10.40.0.5/32', 'Host');
    const { p: hp, wywolania: hpW } = port({ podsieci: [host] });
    await serwis(hp).createAddress(host.id, { address: '10.40.0.5' }, AKTOR);

    assert.equal(ppW.utworzoneAdresy.length, 2);
    assert.equal(hpW.utworzoneAdresy.length, 1);
  });

  it('ręcznie dodany adres ma lastSeenAt: null', async () => {
    // `lastSeenAt` to potwierdzenie skanem, a adres wpisany ręcznie skanem
    // nie był — data „teraz” kazałaby katalogowi twierdzić, że host żyje.
    const { p, wywolania } = port({ podsieci: [PODNET] });
    await serwis(p).createAddress(PODNET.id, { address: '10.20.1.5' }, AKTOR);
    assert.equal(wywolania.utworzoneAdresy[0]?.lastSeenAt, null);
  });

  it('zapisuje status domyślny i jawne pola z DTO', async () => {
    const { p, wywolania } = port({ podsieci: [PODNET] });
    await serwis(p).createAddress(
      PODNET.id,
      { address: '10.20.1.5', status: 'DEPRECATED', description: 'wycofywany' },
      AKTOR,
    );
    assert.equal(wywolania.utworzoneAdresy[0]?.status, 'DEPRECATED');
    assert.equal(wywolania.utworzoneAdresy[0]?.description, 'wycofywany');

    const { p: p2, wywolania: w2 } = port({ podsieci: [PODNET] });
    await serwis(p2).createAddress(PODNET.id, { address: '10.20.1.6' }, AKTOR);
    assert.equal(w2.utworzoneAdresy[0]?.status, 'FREE');
    assert.equal(w2.utworzoneAdresy[0]?.description, null);
  });

  it('mapuje P2002 z bazy na 409 z komunikatem dla człowieka', async () => {
    // Kolizja, której nie wykrył własny `findMany` (dwa żądania naraz).
    // Bez tego przetłumaczenia użytkownik dostałby 500.
    const { p } = port({ podsieci: [PODNET], kolizjaWbazie: true });
    await assert.rejects(
      () => serwis(p).createAddress(PODNET.id, { address: '10.20.1.5' }, AKTOR),
      (e: Error & { response?: { message: string } }) => {
        const komunikat = e.response?.message ?? '';
        assert.ok(e instanceof ConflictException);
        assert.equal(komunikat, 'Adres 10.20.1.5 jest już zarejestrowany w tej podsieci.');
        return true;
      },
    );
  });

  it('nie nazywa błędu bazy duplikatem, gdy to nie jest P2002', async () => {
    // Jedna nieostrożna zmiana w `isP2002` zamieniłaby KAŻDY błąd bazy
    // (przerwane połączenie, P2025, cokolwiek) w „adres już zarejestrowany"
    // — użytkownik dostałby 409 z mylącym zdaniem zamiast awarii do zbadania.
    const { p } = port({ podsieci: [PODNET], kodBleduPrzyZapisie: 'P2025' });
    await assert.rejects(
      () => serwis(p).createAddress(PODNET.id, { address: '10.20.1.5' }, AKTOR),
      (e: Error) => {
        assert.ok(!(e instanceof ConflictException));
        assert.equal(e.message, 'Record not found');
        return true;
      },
    );
  });

  it('rzuca NotFound na nieistniejącej podsieci', async () => {
    const { p, wywolania } = port({ podsieci: [PODNET] });
    await assert.rejects(
      () => serwis(p).createAddress(randomUUID(), { address: '10.20.1.5' }, AKTOR),
      NotFoundException,
    );
    assert.equal(wywolania.utworzoneAdresy.length, 0);
  });

  it('loguje utworzenie w dzienniku', async () => {
    const { p, wywolania, dziennik } = port({ podsieci: [PODNET] });
    await serwis(p, dziennik).createAddress(PODNET.id, { address: '10.20.1.5' }, AKTOR);
    assert.equal(wywolania.zdarzenia.length, 1);
    const zdarzenie = wywolania.zdarzenia[0];
    assert.equal(zdarzenie.action, 'address.created');
    assert.equal(zdarzenie.entity, 'IpAddress');
    assert.equal(zdarzenie.actorId, 'u-1');
  });
});

describe('Lista adresów', () => {
  it('zwraca adresy posortowane numerycznie z liczbą łączną', async () => {
    const { p } = port({
      podsieci: [PODNET],
      adresy: [
        adres(PODNET.id, '10.20.0.40'),
        adres(PODNET.id, '10.20.0.5'),
        adres(PODNET.id, '10.20.0.7', 'IN_USE'),
      ],
    });
    const wynik = await serwis(p).listAddresses(PODNET.id);
    assert.deepEqual(
      wynik.addresses.map((a) => a.address),
      ['10.20.0.5', '10.20.0.7', '10.20.0.40'],
    );
    assert.equal(wynik.total, 3);
  });

  it('nie miesza adresów innych podsieci', async () => {
    const inna = subnet('10.30.0.0/16', 'Biuro');
    const { p } = port({
      podsieci: [PODNET, inna],
      adresy: [adres(PODNET.id, '10.20.0.5'), adres(inna.id, '10.30.0.5')],
    });
    const wynik = await serwis(p).listAddresses(PODNET.id);
    assert.equal(wynik.total, 1);
    assert.deepEqual(
      wynik.addresses.map((a) => a.address),
      ['10.20.0.5'],
    );
  });
});

describe('Aktualizacja adresu', () => {
  it('rzuca NotFound na nieistniejącym adresie', async () => {
    const { p, wywolania } = port();
    await assert.rejects(
      () => serwis(p).updateAddress(randomUUID(), { status: 'DEPRECATED' }, AKTOR),
      NotFoundException,
    );
    assert.equal(wywolania.poprawioneAdresy.length, 0);
  });

  it('pusty PATCH nic nie zapisuje i nie pokaże w dzienniku', async () => {
    const a = adres(PODNET.id, '10.20.1.5');
    const { p, wywolania, dziennik } = port({ podsieci: [PODNET], adresy: [a] });
    const wynik = await serwis(p, dziennik).updateAddress(a.id, {}, AKTOR);
    assert.equal(wywolania.poprawioneAdresy.length, 0);
    assert.equal(wywolania.zdarzenia.length, 0);
    assert.equal(wynik.status, 'FREE');
  });

  it('zmienia status i opis', async () => {
    const a = adres(PODNET.id, '10.20.1.5');
    const { p, wywolania } = port({ podsieci: [PODNET], adresy: [a] });
    await serwis(p).updateAddress(
      a.id,
      { status: 'DEPRECATED', description: 'wycofywany' },
      AKTOR,
    );
    assert.deepEqual(wywolania.poprawioneAdresy[0]?.data, {
      status: 'DEPRECATED',
      description: 'wycofywany',
    });
  });

  it('zmiana adresu poza zakres odrzuca CAŁĄ zmianę', async () => {
    // Ten sam kontrakt co przy zwężaniu CIDR podsieci: częściowo zastosowany
    // PATCH (status zapisany, adres odrzucony) zostawia wiersz w stanie,
    // o którym nikt nie prosił.
    const a = adres(PODNET.id, '10.20.1.5');
    const { p, wywolania, dziennik } = port({ podsieci: [PODNET], adresy: [a] });
    await assert.rejects(
      () =>
        serwis(p, dziennik).updateAddress(
          a.id,
          { address: '10.21.0.5', status: 'DEPRECATED' },
          AKTOR,
        ),
      (e: Error) => {
        assert.ok(e instanceof BadRequestException);
        assert.match((e as BadRequestException).message, /poza zakresem/);
        return true;
      },
    );
    assert.equal(wywolania.poprawioneAdresy.length, 0);
    assert.equal(wywolania.zdarzenia.length, 0);
  });

  it('zmiana na adres sieciowy odrzucana jak przy tworzeniu', async () => {
    const a = adres(PODNET.id, '10.20.1.5');
    const { p, wywolania } = port({ podsieci: [PODNET], adresy: [a] });
    await assert.rejects(
      () => serwis(p).updateAddress(a.id, { address: '10.20.0.0' }, AKTOR),
      BadRequestException,
    );
    assert.equal(wywolania.poprawioneAdresy.length, 0);
  });

  it('odrzuca zmianę na adres zajęty w tej samej podsieci', async () => {
    const a = adres(PODNET.id, '10.20.1.5');
    const { p, wywolania } = port({
      podsieci: [PODNET],
      adresy: [a, adres(PODNET.id, '10.20.1.6')],
    });
    await assert.rejects(
      () => serwis(p).updateAddress(a.id, { address: '10.20.1.6' }, AKTOR),
      (e: Error & { status?: number }) => {
        assert.equal(e.status, 409);
        return true;
      },
    );
    assert.equal(wywolania.poprawioneAdresy.length, 0);
  });

  it('nie koliduje sama ze sobą', async () => {
    // Wysłanie niezmienionego tekstu adresu nie jest duplikatem: własny
    // wiersz ma dokładnie ten adres, więc bez pominięcia wartości równej
    // obecnej każdy taki PATCH odrzucałby sam siebie z 409.
    const a = adres(PODNET.id, '10.20.1.5');
    const { p, wywolania } = port({ podsieci: [PODNET], adresy: [a] });
    await serwis(p).updateAddress(a.id, { address: '10.20.1.5' }, AKTOR);
    // Adres bez zmian nie wraca do `data` — nie ma czego zapisywać.
    assert.equal(wywolania.poprawioneAdresy.length, 0);
  });

  it('mapuje P2002 przy zmianie adresu na 409', async () => {
    const a = adres(PODNET.id, '10.20.1.5');
    const { p } = port({ podsieci: [PODNET], adresy: [a], kolizjaWbazie: true });
    await assert.rejects(
      () => serwis(p).updateAddress(a.id, { address: '10.20.1.9' }, AKTOR),
      ConflictException,
    );
  });

  it('audytuje zmianę diffem przed/po', async () => {
    const a = adres(PODNET.id, '10.20.1.5');
    const { p, wywolania, dziennik } = port({ podsieci: [PODNET], adresy: [a] });
    await serwis(p, dziennik).updateAddress(a.id, { status: 'DEPRECATED' }, AKTOR);
    assert.equal(wywolania.zdarzenia.length, 1);
    const zdarzenie = wywolania.zdarzenia[0];
    assert.equal(zdarzenie.action, 'address.updated');
    assert.equal(zdarzenie.entity, 'IpAddress');
    assert.equal(zdarzenie.entityId, a.id);
    assert.deepEqual(zdarzenie.changes, { status: { from: 'FREE', to: 'DEPRECATED' } });
  });
});

describe('Usuwanie adresu', () => {
  it('odmawia, gdy adres ma przypisane aplikacje', async () => {
    // `onDelete: Cascade` i tak by posadził `IN_USE` bez aplikacji, a wpis
    // zniknąłby dopiero razem z aplikacją — użytkownik straciłby
    // powiązanie bez ostrzeżenia. Liczba w komunikacie mówi, ile trzeba
    // zdjąć, a podpowiedź wskazuje miejsce.
    const a = adres(PODNET.id, '10.20.1.5', 'IN_USE');
    const { p, wywolania, dziennik } = port({
      podsieci: [PODNET],
      adresy: [a],
      przypisania: [
        { ipAddressId: a.id, applicationId: 'app-1' },
        { ipAddressId: a.id, applicationId: 'app-2' },
      ],
    });
    await assert.rejects(
      () => serwis(p, dziennik).removeAddress(a.id, AKTOR),
      (e: Error & { response?: { message: string } }) => {
        const komunikat = e.response?.message ?? '';
        assert.ok(e instanceof ConflictException);
        // Sama liczba z kropki nie wystarczy: „2" jest też w adresie `10.20.1.5`,
        // więc samo `/2/` przeszłoby nawet po usunięciu liczby z komunikatu.
        assert.match(komunikat, /2 aplikacje/);
        assert.match(komunikat, /10\.20\.1\.5/);
        assert.match(komunikat, /aplikacj/i);
        return true;
      },
    );
    assert.deepEqual(wywolania.usunieteAdresy, [], 'adres musi zostać w bazie');
    assert.equal(wywolania.zdarzenia.length, 0);
  });

  it('mówi „1 aplikacja" dla pojedynczego przypisania', async () => {
    // Polska liczba pojedyncza to „aplikacja", nie „aplikacji" — komunikat
    // o jednym przypisaniu brzmiałby wtedy jak maszynowy.
    const a = adres(PODNET.id, '10.20.1.5', 'IN_USE');
    const { p } = port({
      podsieci: [PODNET],
      adresy: [a],
      przypisania: [{ ipAddressId: a.id, applicationId: 'app-1' }],
    });
    await assert.rejects(
      () => serwis(p).removeAddress(a.id, AKTOR),
      (e: Error & { response?: { message: string } }) => {
        assert.match(e.response?.message ?? '', /1 aplikacja\./);
        return true;
      },
    );
  });

  it('liczy przypisania z uwzględnieniem adresu, nie całej tabeli', async () => {
    // Bez filtra `ipAddressId` serwis widziałby cudze przypisania i blokował
    // kasowanie adresu wolnego, a patrzenie na wywołanie portu pilnuje tego,
    // czy w zapytaniu w ogóle trafił identyfikator.
    const a = adres(PODNET.id, '10.20.1.5');
    const b = adres(PODNET.id, '10.20.1.6', 'IN_USE');
    const { p } = port({
      podsieci: [PODNET],
      adresy: [a, b],
      przypisania: [{ ipAddressId: b.id, applicationId: 'app-1' }],
    });
    await serwis(p).removeAddress(a.id, AKTOR);
    assert.deepEqual(
      await serwis(p).listAddresses(PODNET.id).then((r) => r.addresses.map((x) => x.address)),
      ['10.20.1.6'],
    );
  });

  it('kasuje wolny adres z wpisem w dzienniku', async () => {
    const a = adres(PODNET.id, '10.20.1.5');
    const { p, wywolania, dziennik } = port({ podsieci: [PODNET], adresy: [a] });
    await serwis(p, dziennik).removeAddress(a.id, AKTOR);
    assert.deepEqual(wywolania.usunieteAdresy, [{ where: { id: a.id } }]);
    assert.equal(wywolania.zdarzenia.length, 1);
    const zdarzenie = wywolania.zdarzenia[0];
    assert.equal(zdarzenie.action, 'address.deleted');
    assert.equal(zdarzenie.entity, 'IpAddress');
    assert.deepEqual(zdarzenie.changes, { address: { from: '10.20.1.5', to: null } });
  });

  it('rzuca NotFound i nie kasuje nieistniejącego adresu', async () => {
    const { p, wywolania } = port();
    await assert.rejects(() => serwis(p).removeAddress(randomUUID(), AKTOR), NotFoundException);
    assert.equal(wywolania.usunieteAdresy.length, 0);
  });
});

describe('Aplikacje przypisane do adresu', () => {
  it('pomija aplikacje usunięte miękko i wystawia ich URL', async () => {
    // Usunięta aplikacja to śmieć w katalogu — na karcie adresu nie ma po co
    // jej pokazywać; jej usunięcie obsługuje Task 7 (zdejmuje też przypisania).
    const a = adres(PODNET.id, '10.20.1.5', 'IN_USE');
    const { p } = port({
      podsieci: [PODNET],
      adresy: [a],
      aplikacje: [
        aplikacja('app-1', 'Panel klienta', 'https://panel.example.pl'),
        aplikacja('app-2', 'Wyrzucona', 'https://nie.ma', new Date('2026-02-01')),
      ],
      przypisania: [
        { ipAddressId: a.id, applicationId: 'app-1' },
        { ipAddressId: a.id, applicationId: 'app-2' },
      ],
    });
    assert.deepEqual(await serwis(p).applicationsForAddress(a.id), [
      { id: 'app-1', name: 'Panel klienta', url: 'https://panel.example.pl' },
    ]);
  });

  it('zastępuje brak adresu bazowego pustym tekstem, nie undefined', async () => {
    // Sygnatura obiecuje `url: string`, a kolumna jest nullable — `undefined`
    // trafiłoby do frontu jako brakujące pole i rozjechało typy.
    const a = adres(PODNET.id, '10.20.1.5', 'IN_USE');
    const { p } = port({
      podsieci: [PODNET],
      adresy: [a],
      aplikacje: [aplikacja('app-1', 'Bez adresu bazowego')],
      przypisania: [{ ipAddressId: a.id, applicationId: 'app-1' }],
    });
    assert.deepEqual(await serwis(p).applicationsForAddress(a.id), [
      { id: 'app-1', name: 'Bez adresu bazowego', url: '' },
    ]);
  });

  it('nie miesza przypisań innych adresów', async () => {
    const a = adres(PODNET.id, '10.20.1.5');
    const b = adres(PODNET.id, '10.20.1.6', 'IN_USE');
    const { p } = port({
      podsieci: [PODNET],
      adresy: [a, b],
      aplikacje: [aplikacja('app-1', 'Panel klienta')],
      przypisania: [{ ipAddressId: b.id, applicationId: 'app-1' }],
    });
    assert.deepEqual(await serwis(p).applicationsForAddress(a.id), []);
  });
});
