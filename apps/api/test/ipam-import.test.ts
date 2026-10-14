import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { IpamService } from '../src/ipam/ipam.service';
import { NmapXmlError } from '../src/ipam/nmap-xml';
import type {
  IpAddressRow,
  IpAddressStatus,
  IpamPort,
  SubnetRow,
} from '../src/ipam/ipam.port';

function subnet(
  cidr: string,
  name: string,
  nadpisz: Partial<SubnetRow> = {},
): SubnetRow {
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

function adres(
  address: string,
  description: string | null = null,
  subnetId = 'id-Sieć',
  status: IpAddressStatus = 'FREE',
): IpAddressRow {
  return {
    id: `ip-${address}`,
    subnetId,
    address,
    status,
    description,
    lastSeenAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
}

function xmlZHostem(address: string, hostname: string | null): string {
  const hn = hostname
    ? `<hostnames><hostname name="${hostname}"/></hostnames>`
    : '<hostnames/>';
  return `<nmaprun><host><status state="up"/><address addr="${address}" addrtype="ipv4"/>${hn}</host></nmaprun>`;
}

type StanImportu = {
  podsieci?: SubnetRow[];
  ipAddresses?: IpAddressRow[];
};

function port(stan: StanImportu = {}) {
  const podsieci = [...(stan.podsieci ?? [])];
  const adresy = [...(stan.ipAddresses ?? [])];
  const wywolania = {
    create: [] as unknown[],
    update: [] as unknown[],
    upsert: [] as unknown[],
    findManySubnetIds: [] as unknown[],
  };

  const p = {
    subnet: {
      findMany: async () => podsieci.map((s) => ({ ...s })),
      findUnique: async ({ where }: { where: { id: string } }) =>
        podsieci.find((s) => s.id === where.id) ?? null,
    },
    ipAddress: {
      findMany: async ({
        where,
      }: {
        where?: {
          subnetId?: string | { in: string[] };
          address?: string;
          id?: { in: string[] };
        };
      } = {}) => {
        wywolania.findManySubnetIds.push(where?.subnetId);
        return adresy.filter((a) => {
          if (!where?.subnetId) return true;
          if (typeof where.subnetId === 'string') {
            return a.subnetId === where.subnetId;
          }
          return where.subnetId.in.includes(a.subnetId);
        });
      },
      create: async (args: unknown) => {
        wywolania.create.push(args);
        throw new Error('preview nie może wołać create');
      },
      update: async (args: unknown) => {
        wywolania.update.push(args);
        throw new Error('preview nie może wołać update');
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { subnetId_address: { subnetId: string; address: string } };
        create: IpAddressRow;
        update: Partial<IpAddressRow>;
      }) => {
        wywolania.upsert.push({ where, create, update });
        const { subnetId, address } = where.subnetId_address;
        const istniejacy = adresy.find(
          (a) => a.subnetId === subnetId && a.address === address,
        );
        if (istniejacy) {
          if (update.lastSeenAt !== undefined) {
            istniejacy.lastSeenAt = update.lastSeenAt;
          }
          if (update.description !== undefined) {
            istniejacy.description = update.description;
          }
          return { ...istniejacy };
        }
        const nowy: IpAddressRow = {
          id: `ip-${address}`,
          subnetId: create.subnetId,
          address: create.address,
          status: create.status,
          description: create.description ?? null,
          lastSeenAt: create.lastSeenAt ?? null,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        };
        adresy.push(nowy);
        return { ...nowy };
      },
    },
    $transaction: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
  } as unknown as IpamPort;

  const zdarzenia: Array<{
    action: string;
    entity: string;
    changes?: unknown;
  }> = [];

  const dziennik = {
    record: async (e: {
      action: string;
      entity: string;
      changes?: unknown;
    }) => {
      zdarzenia.push(e);
    },
  };

  return { p, wywolania, dziennik, zdarzenia, adresy };
}

function serwis(
  zestaw: ReturnType<typeof port>,
): IpamService {
  return new IpamService(
    zestaw.p as unknown as ConstructorParameters<typeof IpamService>[0],
    zestaw.dziennik as never,
  );
}

describe('IpamService.previewImport', () => {
  // Podsiej `/16` i `/24` naraz nie wchodzi w grę: `assertZakresWolny` w
  // `ipam.service.ts` rzuca `409` dla zakresów zachodzących na siebie. W
  // katalogu nie ma dwóch podsieci zawierających ten sam adres, więc wybór
  // „najwęższej" jest nieosiągalny, a poprzednia wersja tego testu opisywała
  // stan, którego baza nie dopuszcza.
  it('kwalifikuje nowy adres do podsieci, w której leży', async () => {
    const r = await serwis(
      port({ podsieci: [subnet('10.20.5.0/24', 'Serwery')] }),
    ).previewImport(xmlZHostem('10.20.5.7', 'jenkins'));
    assert.equal(r.new.length, 1);
    assert.equal(r.new[0]?.subnetName, 'Serwery');
    assert.equal(r.new[0]?.hostname, 'jenkins');
  });

  it('kwalifikuje istniejący adres do grupy existing', async () => {
    const r = await serwis(
      port({
        podsieci: [subnet('10.20.0.0/16', 'Sieć')],
        ipAddresses: [adres('10.20.5.7', 'stary opis')],
      }),
    ).previewImport(xmlZHostem('10.20.5.7', 'jenkins'));
    assert.equal(r.existing.length, 1);
    assert.equal(r.existing[0]?.existingDescription, 'stary opis');
  });

  it('daje adres spoza wszystkich podsieci do unmatched', async () => {
    const r = await serwis(
      port({ podsieci: [subnet('10.20.0.0/16', 'Sieć')] }),
    ).previewImport(xmlZHostem('192.168.5.7', null));
    assert.equal(r.unmatched.length, 1);
  });

  it('pusty katalog daje cały plik jako unmatched', async () => {
    // Review Focus 4 — to pierwszy import realnej sieci i najczęstszy scenariusz.
    // Ekran musi wymusić ręczny wybór podsieci dla każdego adresu.
    const r = await serwis(port({})).previewImport(
      xmlZHostem('10.20.5.7', 'jenkins'),
    );
    assert.equal(r.unmatched.length, 1);
    assert.equal(r.new.length + r.existing.length, 0);
  });

  it('przekazuje NmapXmlError na uszkodzonym pliku XML', async () => {
    await assert.rejects(
      () => serwis(port({})).previewImport('<nmaprun><host>'),
      NmapXmlError,
    );
  });

  it('nie wykonuje żadnego zapisu podczas podglądu', async () => {
    const zestaw = port({
      podsieci: [subnet('10.20.0.0/16', 'Sieć')],
      ipAddresses: [adres('10.20.5.7', 'stary opis')],
    });
    await serwis(zestaw).previewImport(
      '<nmaprun>' +
        '<host><address addr="10.20.5.7" addrtype="ipv4"/></host>' +
        '<host><address addr="10.20.5.8" addrtype="ipv4"/></host>' +
        '<host><address addr="192.168.1.1" addrtype="ipv4"/></host>' +
        '</nmaprun>',
    );
    assert.equal(zestaw.wywolania.create.length, 0);
    assert.equal(zestaw.wywolania.update.length, 0);
    assert.equal(zestaw.wywolania.upsert.length, 0);
  });

  it('pomija adres sieciowy i rozgłoszeniowy podsieci podczas podglądu', async () => {
    const r = await serwis(
      port({ podsieci: [subnet('10.20.5.0/24', 'Serwery')] }),
    ).previewImport(
      '<nmaprun>' +
        '<host><address addr="10.20.5.0" addrtype="ipv4"/></host>' +
        '<host><address addr="10.20.5.7" addrtype="ipv4"/></host>' +
        '<host><address addr="10.20.5.255" addrtype="ipv4"/></host>' +
        '</nmaprun>',
    );
    assert.deepEqual(
      r.new.map((x) => x.address),
      ['10.20.5.7'],
    );
    assert.equal(r.unmatched.length, 0);
    assert.equal(r.skipped, 2);
  });
});

const AKTOR = {
  id: 'u-1',
  username: 'admin',
  email: 'admin@firma.pl',
  fullName: 'Administrator Systemu',
  role: 'ADMIN',
  mustChangePassword: false,
} as const;

const PODNET_ID = 'id-Sieć';

describe('IpamService.applyImport', () => {
  it('odrzuca pozycję z nieznanym adresem podsieci', async () => {
    await assert.rejects(
      () =>
        serwis(port({})).applyImport(
          { selections: [{ address: '10.20.5.7', subnetId: 'nie-uuid' }] },
          AKTOR,
        ),
      /nie istnieje/,
    );
  });

  it('odrzuca adres spoza wskazanej podsieci', async () => {
    // Administrator mógł wybrać podsieć z rozwijanej listy, ale lista
    // pochodzi z podglądu sprzed godziny — dane mogły się rozjechać.
    await assert.rejects(
      () =>
        serwis(
          port({ podsieci: [subnet('10.20.0.0/16', 'Sieć')] }),
        ).applyImport(
          { selections: [{ address: '192.168.1.5', subnetId: PODNET_ID }] },
          AKTOR,
        ),
      /poza zakresem/,
    );
  });

  it('zapisuje zatwierdzone adresy i ustawia lastSeenAt', async () => {
    const zestaw = port({ podsieci: [subnet('10.20.0.0/16', 'Sieć')] });
    await serwis(zestaw).applyImport(
      { selections: [{ address: '10.20.5.7', subnetId: PODNET_ID }] },
      AKTOR,
    );
    assert.equal(zestaw.adresy.length, 1);
    assert.ok(zestaw.adresy[0]?.lastSeenAt instanceof Date);
  });

  it('drugie wgranie tego samego pliku nie tworzy duplikatu i zachowuje ręczny opis', async () => {
    // Review Focus 2 — upsert, nie create. Wywołanie apply dwa razy
    // z tym samym wejściem daje ten sam stan, bez wyjątku.
    const zestaw = port({
      podsieci: [subnet('10.20.0.0/16', 'Sieć')],
      ipAddresses: [adres('10.20.5.7', 'ręczny opis administratora')],
    });
    const dto = {
      selections: [{ address: '10.20.5.7', subnetId: PODNET_ID }],
    };
    await serwis(zestaw).applyImport(dto, AKTOR);
    await serwis(zestaw).applyImport(dto, AKTOR);
    assert.equal(zestaw.adresy.length, 1);
    assert.equal(zestaw.adresy[0]?.description, 'ręczny opis administratora');
  });

  it('loguje jeden wpis audytu dla całego importu', async () => {
    const zestaw = port({ podsieci: [subnet('10.20.0.0/16', 'Sieć')] });
    const trzyPozycje = [
      { address: '10.20.5.7', subnetId: PODNET_ID, description: 'jenkins' },
      { address: '10.20.5.8', subnetId: PODNET_ID },
      { address: '10.20.5.9', subnetId: PODNET_ID },
    ];
    await serwis(zestaw).applyImport({ selections: trzyPozycje }, AKTOR);
    assert.equal(zestaw.zdarzenia.length, 1);
    assert.equal(zestaw.zdarzenia[0]?.action, 'ip_addresses.import');
  });

  it('deduplikuje powtórzone pozycje w applyImport i zapisuje unikalną liczbę w audycie', async () => {
    const zestaw = port({ podsieci: [subnet('10.20.0.0/16', 'Sieć')] });
    const wynik = await serwis(zestaw).applyImport(
      {
        selections: [
          { address: '10.20.5.7', subnetId: PODNET_ID },
          { address: '10.20.5.7', subnetId: PODNET_ID, description: 'jenkins' },
        ],
      },
      AKTOR,
    );
    assert.equal(wynik.imported, 1);
    assert.equal(zestaw.wywolania.upsert.length, 1);
    assert.equal(zestaw.adresy[0]?.description, 'jenkins');
  });
});
