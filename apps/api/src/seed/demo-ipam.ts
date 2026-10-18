/**
 * Dane demonstracyjne IPAM: dwie podsieci, adresy i powiązania
 * aplikacja–adres.
 *
 * Osobny plik, bo IPAM to inny obszar interfejsu niż rejestr aplikacji —
 * demo ma pokazać widok podsieci z rozmieszczonymi adresami i przypisanie
 * adresu do usługi (tu: Grafana), czyli parę rzeczy, których nie widać
 * na listach aplikacji.
 *
 * Dane pochodzą z eksportu działającej instancji (`make export-demo`):
 * skrypt `apps/api/scripts/export-demo.mjs` generuje sekcję danych z
 * zrzutu JSON bazy. Struktura pliku i funkcja seedująca są ręczne —
 * generowany jest tylko zapis danych.
 *
 * Seed jest idempotentny: podsieci po nazwie (`upsert`), adresy po kluczu
 * złożonym (podsieć, adres), powiązania po kluczu złożonym (aplikacja,
 * adres). Ponowne uruchomienie kontenera nie mnoży wierszy.
 *
 * Uwaga: przycisk „usuń dane demo" w panelu kasuje wyłącznie aplikacje
 * z flagą `is_demo` (patrz `SettingsService`). Podsieci i adresy zostają —
 * podobnie jak osoby z macierzy uprawnień — i w razie potrzeby kasuje się
 * je w widoku IPAM razem z podsiecią.
 */
import { IpStatus } from '@prisma/client';

/** Jedna podsieć demonstracyjna z listą adresów. */
export type DemoSubnet = {
  name: string;
  cidr: string;
  description: string | null;
  color: string;
  vlan: number | null;
  location: string | null;
  addresses: Array<{
    address: string;
    status: IpStatus;
    description: string | null;
  }>;
};

/** Cały zestaw danych demo IPAM, w kształcie generowanym z eksportu. */
export type DemoIpamData = {
  subnets: DemoSubnet[];
  /**
   * Powiązania aplikacja–adres. Wszystko po nazwach: aplikacja po nazwie
   * z rejestru demo, podsieć po nazwie z tej listy, adres po tekście.
   * Identyfikatory powstają dopiero w bazie przy seedzie.
   */
  appLinks: Array<{ application: string; subnet: string; address: string }>;
};

/**
 * Wąski port, przez który ten seed rozmawia z bazą.
 *
 * Nie `PrismaClient`, tylko używane metody — dzięki temu test podaje atrapę
 * i sprawdza wywołania, zamiast podnosić bazę. Nazwy pól odpowiadają modelom
 * Prisma, więc zapis nie wymaga rzutowania.
 */
export type DemoIpamSeeder = {
  subnet: {
    upsert(args: {
      where: { name: string };
      create: {
        name: string;
        cidr: string;
        description: string | null;
        color: string;
        vlan: number | null;
        location: string | null;
      };
      update: {
        cidr: string;
        description: string | null;
        color: string;
        vlan: number | null;
        location: string | null;
      };
    }): Promise<{ id: string; name: string }>;
  };
  ipAddress: {
    upsert(args: {
      where: { subnetId_address: { subnetId: string; address: string } };
      create: {
        subnetId: string;
        address: string;
        status: IpStatus;
        description: string | null;
      };
      update: { status: IpStatus; description: string | null };
    }): Promise<{ id: string }>;
  };
  application: {
    findFirst(args: {
      where: { name: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  applicationIpAddress: {
    upsert(args: {
      where: {
        applicationId_ipAddressId: { applicationId: string; ipAddressId: string };
      };
      create: { applicationId: string; ipAddressId: string };
      update: Record<string, never>;
    }): Promise<unknown>;
  };
};

/** ── Dane wygenerowane z eksportu (`make export-demo`) — początek ── */
export const DEMO_IPAM_DATA: DemoIpamData = {
  subnets: [
  {
    name: 'DOM',
    cidr: '192.168.0.0/24',
    description: null,
    color: 'emerald',
    vlan: 1,
    location: null,
    addresses: [
        { address: '192.168.0.1', status: IpStatus.IN_USE, description: 'net.int' },
        { address: '192.168.0.110', status: IpStatus.IN_USE, description: null },
        { address: '192.168.0.113', status: IpStatus.IN_USE, description: null },
        { address: '192.168.0.114', status: IpStatus.IN_USE, description: null },
        { address: '192.168.0.115', status: IpStatus.IN_USE, description: null },
        { address: '192.168.0.2', status: IpStatus.IN_USE, description: 'nas.int' },
        { address: '192.168.0.31', status: IpStatus.IN_USE, description: null },
        { address: '192.168.0.4', status: IpStatus.IN_USE, description: null },
        { address: '192.168.0.48', status: IpStatus.IN_USE, description: null },
        { address: '192.168.0.5', status: IpStatus.IN_USE, description: null },
        { address: '192.168.0.99', status: IpStatus.IN_USE, description: null },
    ],
  },
  {
    name: 'test1',
    cidr: '172.16.3.0/24',
    description: null,
    color: 'violet',
    vlan: 3,
    location: null,
    addresses: [
        { address: '172.16.3.2', status: IpStatus.IN_USE, description: null },
    ],
  },
  ],
  appLinks: [
  { application: 'Grafana', subnet: 'DOM', address: '192.168.0.99' },
  ],
};
/** ── Dane wygenerowane z eksportu (`make export-demo`) — koniec ─── */

/**
 * Wstawia podsieci, adresy i powiązania demonstracyjne.
 *
 * Podsieć szukamy po **nazwie**, aplikację po **nazwie** — identyfikatory
 * zmieniają się z każdym seedem na czystej bazie, a powiązanie po nazwie
 * przetrwa restart i nową instalację. Brak aplikacji demo (tryb demo
 * wyłączony częściowo, literówka) nie wywala seeda — pomijamy powiązanie,
 * ale zwracamy je na liście `pominiete`, żeby log mógł o tym powiedzieć:
 * ciche zero powiązań wygląda jak awaria seeda.
 */
export async function seedDemoIpam(
  prisma: DemoIpamSeeder,
  dane: DemoIpamData = DEMO_IPAM_DATA,
): Promise<{
  subnets: number;
  addresses: number;
  links: number;
  pominiete: string[];
}> {
  let adresy = 0;
  /** Nazwa podsieci → identyfikator w bazie, do powiązań aplikacja–adres. */
  const idPodsieci = new Map<string, string>();
  /** Klucz „podsieć:adres" → identyfikator w bazie. */
  const idAdresu = new Map<string, string>();

  for (const podsiec of dane.subnets) {
    const pola = {
      cidr: podsiec.cidr,
      description: podsiec.description,
      color: podsiec.color,
      vlan: podsiec.vlan,
      location: podsiec.location,
    };
    const zapisana = await prisma.subnet.upsert({
      where: { name: podsiec.name },
      create: { name: podsiec.name, ...pola },
      update: pola,
    });
    idPodsieci.set(podsiec.name, zapisana.id);

    for (const adres of podsiec.addresses) {
      const zapisany = await prisma.ipAddress.upsert({
        where: {
          subnetId_address: { subnetId: zapisana.id, address: adres.address },
        },
        create: {
          subnetId: zapisana.id,
          address: adres.address,
          status: adres.status,
          description: adres.description,
        },
        update: { status: adres.status, description: adres.description },
      });
      idAdresu.set(`${podsiec.name}:${adres.address}`, zapisany.id);
      adresy++;
    }
  }

  let powiazania = 0;
  const pominiete: string[] = [];
  for (const powiazanie of dane.appLinks) {
    const ipAddressId = idAdresu.get(
      `${powiazanie.subnet}:${powiazanie.address}`,
    );
    const aplikacja = await prisma.application.findFirst({
      where: { name: powiazanie.application },
      select: { id: true },
    });
    if (!ipAddressId || !aplikacja) {
      pominiete.push(powiazanie.application);
      continue;
    }

    await prisma.applicationIpAddress.upsert({
      where: {
        applicationId_ipAddressId: {
          applicationId: aplikacja.id,
          ipAddressId,
        },
      },
      create: { applicationId: aplikacja.id, ipAddressId },
      update: {},
    });
    powiazania++;
  }

  return { subnets: idPodsieci.size, addresses: adresy, links: powiazania, pominiete };
}
