/**
 * Port IPAM — wąski wycinek Prisma, przez który rozmawia `IpamService`.
 *
 * Osobny typ zamiast `PrismaService`, bo testy serwisu nie podnoszą bazy:
 * atrapa rzutowana na `ConstructorParameters<typeof IpamService>[0]` (jak
 * w `settings-demo.test.ts`) musi zawierać dokładnie to, co serwis woła.
 * Nazwy delegatów (`subnet`, `ipAddress`, `applicationIpAddress`) powtarzają
 * nazwy modeli Prisma — inaczej test dawałby pole `subnets` i serwis
 * dostawał `undefined` zamiast błędu kompilacji.
 */

/**
 * Status adresu — dokładnie wartości enumy `IpStatus` ze schematu.
 * Zdefiniowany tu, a nie importem z `@prisma/client`, żeby port był
 * czytelnym kontrakt bez zależności od wygenerowanego klienta.
 */
export type IpAddressStatus = 'FREE' | 'IN_USE' | 'DEPRECATED';

/** Wiersz `Subnet` — wszystkie pola skalarny modelu. */
export type SubnetRow = {
  id: string;
  name: string;
  cidr: string;
  description: string | null;
  color: string;
  vlan: number | null;
  location: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Wiersz `IpAddress` — pola skalarne modelu, bez relacji. */
export type IpAddressRow = {
  id: string;
  subnetId: string;
  address: string;
  status: IpAddressStatus;
  description: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Wiersz `ApplicationIpAddress` — serwis czyta tylko stronę adresu. */
export type AssignmentRow = { ipAddressId: string };

/** Podsieć z podsumowaniem do listy katalogu. */
export type SubnetWithCounts = SubnetRow & {
  addressCount: number;
  applicationCount: number;
  freeCount: number;
};

/** Podsieć z pełną listą adresów — widok detalu. */
export type SubnetDetail = SubnetRow & { addresses: IpAddressRow[] };

/** Dane tworzące podsieć — serwis wypełnia wszystkie pola jawnie. */
export type SubnetCreateData = {
  name: string;
  cidr: string;
  description: string | null;
  color: string;
  vlan: number | null;
  location: string | null;
};

/** Patch podsieci — `undefined` to „nie ruszaj pola", semantyka Prisma. */
export type SubnetUpdateData = Partial<SubnetCreateData>;

export type IpamPort = {
  subnet: {
    findMany(): Promise<SubnetRow[]>;
    findUnique(args: { where: { id: string } }): Promise<SubnetRow | null>;
    create(args: { data: SubnetCreateData }): Promise<SubnetRow>;
    update(args: { where: { id: string }; data: SubnetUpdateData }): Promise<SubnetRow>;
    delete(args: { where: { id: string } }): Promise<SubnetRow>;
  };
  ipAddress: {
    findMany(args?: { where?: { subnetId?: string } }): Promise<IpAddressRow[]>;
    count(args: { where: { subnetId: string } }): Promise<number>;
  };
  applicationIpAddress: {
    findMany(): Promise<AssignmentRow[]>;
  };
  /**
   * Tylko `findFirst` — służy walidacji istnienia aplikacji przy
   * przypisywaniu adresów (metody adresów dochodzą w Task 6–7).
   */
  application: {
    findFirst(args: { where: { id: string } }): Promise<{ id: string } | null>;
  };
  audit: {
    record(entry: {
      action: string;
      entity: string;
      entityId?: string | null;
      actorId?: string | null;
      actorName?: string | null;
      changes?: unknown;
      ip?: string | null;
    }): Promise<void>;
  };
  /**
   * Transakcja w formie wywołania zwrotnego — jak w `SettingsPort`.
   * Kasowanie podsieci musi być jednym atomowym krokiem z wpisem do
   * dziennika; forma z tablicą nie łączy zapisu z audytem, bo ten
   * potrzebuje danych pobranych przed skasowaniem.
   */
  $transaction<T>(operacja: () => Promise<T>): Promise<T>;
};
