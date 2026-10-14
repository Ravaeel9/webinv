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
      upsert: async (args: unknown) => {
        wywolania.upsert.push(args);
        throw new Error('preview nie może wołać upsert');
      },
    },
    $transaction: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
  } as unknown as IpamPort;

  const dziennik = {
    record: async () => {},
  };

  return { p, wywolania, dziennik, adresy };
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
});
