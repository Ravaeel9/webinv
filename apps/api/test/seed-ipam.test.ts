/**
 * Seed danych demonstracyjnych IPAM — podsieci, adresy i powiązania
 * aplikacja–adres.
 *
 * Test sprawdza to samo, co `seed-access.test.ts` dla macierzy uprawnień:
 *
 *  - **ponowne uruchomienie nie mnoży danych** — kontener startuje
 *    wielokrotnie, a seed bez upsertu dodałby kopie podsieci przy każdym
 *    restarcie;
 *  - **powiązanie adresu z aplikacją wisi na nazwach** — podsieć szukamy
 *    po nazwie, aplikację po nazwie, bo identyfikatory demo zmieniają się
 *    przy każdym seedzie na czystej bazie;
 *  - **dane w pliku są technicznie poprawne** — CIDR daje się sparsować
 *    walidatorem projektu, a każdy adres leży w swojej podsieci. Bez tego
 *    literówka w danych demo wyszłaby dopiero w interfejsie.
 */
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { ipInCidr, isValidIpv4, parseCidr } from '../src/ipam/cidr';
import { read } from './helpers/repo';
import {
  DEMO_IPAM_DATA,
  seedDemoIpam,
  type DemoIpamSeeder,
} from '../src/seed/demo-ipam';

/** Nazwy aplikacji z plików seeda — czytane tekstem, bo to dane, nie kod API. */
function zrodloAplikacjiDemo(): string {
  return ['demo-applications.ts', 'demo-services.ts']
    .map((plik) => read('apps', 'api', 'src', 'seed', plik))
    .join('\n');
}

/**
 * Atrapa Prisma dla seeda IPAM: trzyma podsieci po nazwie, adresy po parze
 * (podsieć, adres) i powiązania po parze (aplikacja, adres) — dokładnie po
 * tych kluczach, po których seed upsertuje, więc duplikat jest wykrywalny.
 */
function atrapa(aplikacje: string[] = ['Grafana']) {
  const podsieci: Array<{ id: string; name: string; cidr: string }> = [];
  const adresy: Array<{ klucz: string; address: string }> = [];
  const powiazania: Array<{ klucz: string }> = [];
  const idPod = new Map<string, string>();

  const prisma: DemoIpamSeeder = {
    subnet: {
      upsert: async (args) => {
        const istniejaca = podsieci.find((s) => s.name === args.where.name);
        if (istniejaca) {
          istniejaca.cidr = args.update.cidr;
          return istniejaca;
        }
        const nowa = { id: randomUUID(), ...args.create };
        podsieci.push(nowa);
        return nowa;
      },
    },
    ipAddress: {
      upsert: async (args) => {
        const { subnetId, address } = args.where.subnetId_address;
        const klucz = `${subnetId}:${address}`;
        const istniejacy = adresy.find((a) => a.klucz === klucz);
        if (istniejacy) {
          return { id: subnetId };
        }
        adresy.push({ klucz, address });
        return { id: randomUUID() };
      },
    },
    application: {
      findFirst: async (args) => {
        const name = args.where.name;
        if (!aplikacje.includes(name)) return null;
        return { id: randomUUID() };
      },
    },
    applicationIpAddress: {
      upsert: async (args) => {
        const { applicationId, ipAddressId } =
          args.where.applicationId_ipAddressId;
        const klucz = `${applicationId}:${ipAddressId}`;
        if (powiazania.some((p) => p.klucz === klucz)) return null;
        powiazania.push({ klucz });
        return null;
      },
    },
  };

  // Identyfikator podsieci zapisujemy po nazwie, żeby test mógł sprawdzać,
  // że adresy trafiły do właściwej podsieci.
  return { prisma, podsieci, adresy, powiazania, idPod };
}

describe('Seed danych demo IPAM', () => {
  it('wstawia podsieci i adresy w liczbie zgodnej z danymi', async () => {
    const { prisma, podsieci, adresy } = atrapa();

    const wynik = await seedDemoIpam(prisma);

    assert.equal(wynik.subnets, DEMO_IPAM_DATA.subnets.length);
    assert.equal(podsieci.length, DEMO_IPAM_DATA.subnets.length);
    const oczekiwaneAdresy = DEMO_IPAM_DATA.subnets.reduce(
      (suma, s) => suma + s.addresses.length,
      0,
    );
    assert.equal(wynik.addresses, oczekiwaneAdresy);
    assert.equal(adresy.length, oczekiwaneAdresy);
  });

  it('ponowne uruchomienie nie duplikuje podsieci ani adresów', async () => {
    const { prisma, podsieci, adresy } = atrapa();

    await seedDemoIpam(prisma);
    await seedDemoIpam(prisma);

    assert.equal(podsieci.length, DEMO_IPAM_DATA.subnets.length);
    const oczekiwaneAdresy = DEMO_IPAM_DATA.subnets.reduce(
      (suma, s) => suma + s.addresses.length,
      0,
    );
    assert.equal(adresy.length, oczekiwaneAdresy);
  });

  it('powiązuje adres z aplikacją po nazwie', async () => {
    const { prisma, powiazania } = atrapa();

    const wynik = await seedDemoIpam(prisma);

    assert.equal(wynik.links, DEMO_IPAM_DATA.appLinks.length);
    assert.equal(powiazania.length, DEMO_IPAM_DATA.appLinks.length);
  });

  it('brak aplikacji demo nie wywala seeda i mówi, co pominął', async () => {
    const { prisma } = atrapa([]);

    const wynik = await seedDemoIpam(prisma);

    assert.equal(wynik.links, 0);
    assert.ok(
      wynik.pominiete.includes('Grafana'),
      'seed musi wymieniać pominięte aplikacje — inaczej zero powiązań wygląda jak awaria',
    );
  });

  it('dane demo IPAM są technicznie poprawne', () => {
    for (const podsiec of DEMO_IPAM_DATA.subnets) {
      const cidr = parseCidr(podsiec.cidr);
      assert.ok(
        cidr,
        `podsieć „${podsiec.name}" ma CIDR, którego nie da się sparsować: ${podsiec.cidr}`,
      );
      for (const adres of podsiec.addresses) {
        assert.ok(
          isValidIpv4(adres.address),
          `adres „${adres.address}" nie jest poprawnym IPv4`,
        );
        assert.ok(
          ipInCidr(adres.address, cidr!),
          `adres „${adres.address}" leży poza podsiecią ${podsiec.cidr}`,
        );
      }
    }
  });

  it('powiązania wskazują istniejące aplikacje, podsieci i adresy demo', () => {
    const rejestr = zrodloAplikacjiDemo();
    for (const powiazanie of DEMO_IPAM_DATA.appLinks) {
      const podsiec = DEMO_IPAM_DATA.subnets.find(
        (s) => s.name === powiazanie.subnet,
      );
      assert.ok(
        podsiec,
        `powiązanie wskazuje nieistniejącą podsieć demo: ${powiazanie.subnet}`,
      );
      assert.ok(
        podsiec.addresses.some((a) => a.address === powiazanie.address),
        `powiązanie wskazuje adres ${powiazanie.address}, którego nie ma w podsieci ${powiazanie.subnet}`,
      );
      assert.ok(
        rejestr.includes(`'${powiazanie.application}'`),
        `powiązanie wskazuje aplikację „${powiazanie.application}", której nie ma w danych demo`,
      );
    }
  });
});
