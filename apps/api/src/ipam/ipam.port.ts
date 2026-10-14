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

/**
 * Wiersz `IpAddress` z żywymi przypisaniami — kształt listy adresów
 * (`listAddresses`) i karty podsieci (`getSubnet`).
 *
 * Relacja doklejana `include` w tym samym `findMany`: rejestr pokazuje
 * „przypisane aplikacje" per wiersz, a osobne zapytanie na adres (N+1)
 * zostało odrzucone przy projektowaniu Batch 10b. Filtrowane po
 * `application.deletedAt: null` — usunięta miękko aplikacja nie trzyma
 * adresu, cały feature istnieje po to, żeby tak było.
 */
export type IpAddressListRow = IpAddressRow & {
  applications: { id: string; name: string }[];
};

/**
 * Wiersz `ApplicationIpAddress` — obie strony klucza złożonego.
 *
 * Serwis czyta przypisania w obie strony: po `ipAddressId` policzy
 * blokadę kasowania adresu, po `applicationId` odczyta i zdejmie zestaw
 * przypisań aplikacji.
 */
export type AssignmentRow = { ipAddressId: string; applicationId: string };

/** Podsieć z podsumowaniem do listy katalogu. */
export type SubnetWithCounts = SubnetRow & {
  addressCount: number;
  applicationCount: number;
  freeCount: number;
};

/** Podsieć z pełną listą adresów — widok detalu. */
export type SubnetDetail = SubnetRow & { addresses: IpAddressListRow[] };

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

/**
 * Dane tworzące adres — `lastSeenAt` jest tu polem wymaganym, nie
 * domyślnym. Serwis ustawia je jawnie na `null`, bo adres wpisany ręcznie
 * nie był potwierdzony skanem, a domyślnie brakujące pole wyglądałoby
 * w dzienniku tak samo jak skasowane.
 */
export type IpAddressCreateData = {
  subnetId: string;
  address: string;
  status: IpAddressStatus;
  description: string | null;
  lastSeenAt: Date | null;
};

/**
 * Patch adresu. `lastSeenAt` celowo nieobecne: to wynik skanu, nie pole
 * do edycji ręcznej (skan przywróci je, import zadania 10).
 */
export type IpAddressUpdateData = Partial<
  Pick<IpAddressCreateData, 'address' | 'status' | 'description'>
>;

/** Podsieć sprowadzona do obiektu — wystarczy nazwa i zakres. */
export type SubnetRef = { id: string; name: string; cidr: string };

// `IpAddressWithSubnet` zniknął jako martwy eksport: `findMany` niżej opisuje
// kształt zależny od `include` wprost (`subnet?`, `applications?`), a żadna
// trasa nie zwraca wiersza, w którym `subnet` byłby wymagany.

/**
 * Adres widziany z perspektywy aplikacji — podsieć jest tu obiektem.
 *
 * Inaczej niż w `applicationsForAddress`, gdzie drugą stroną jest aplikacja:
 * na karcie aplikacji adres musi pokazać swoją sieć, bo administrator
 * przypisuje VIP-a „do bramy w danej podsieci", a nie „do czegoś, co ma
 * nazwę i kolor".
 */
export type ApplicationIpAddressRef = {
  id: string;
  address: string;
  status: IpAddressStatus;
  description: string | null;
  subnet: SubnetRef;
};

/** Wiersz aplikacji w odpowiedzi na „kto używa tego adresu". */
export type ApplicationRefRow = {
  id: string;
  name: string;
  /** Kolumna `baseUrl` — nullable, a sygnatura metody obiecuje `string`. */
  baseUrl: string | null;
};

export type PreviewRow = {
  address: string;
  hostname: string | null;
  /** Opis z istniejącego rekordu — do pokazania różnicy. */
  existingDescription: string | null;
};

export type ImportPreview = {
  /** Adres z pliku, którego nie ma w podsieci wskazanej przez CIDR. */
  new: (PreviewRow & { subnetId: string; subnetName: string; cidr: string })[];
  /** Adres już zarejestrowany — z podpowiedzią podsieci, do której należy. */
  existing: (PreviewRow & {
    id: string;
    status: IpAddressStatus;
    subnetId: string;
    subnetName: string;
  })[];
  /** Adres spoza wszystkich podsieci — administrator musi wskazać podsieć ręcznie. */
  unmatched: PreviewRow[];
  skipped: number;
};

export type IpamPort = {
  subnet: {
    findMany(): Promise<SubnetRow[]>;
    findUnique(args: { where: { id: string } }): Promise<SubnetRow | null>;
    create(args: { data: SubnetCreateData }): Promise<SubnetRow>;
    update(args: { where: { id: string }; data: SubnetUpdateData }): Promise<SubnetRow>;
    delete(args: { where: { id: string } }): Promise<SubnetRow>;
  };
  ipAddress: {
    /**
     * `include.subnet` czytają wyłącznie odczyty przypisań aplikacji:
     * karta aplikacji musi pokazać, z jakiej sieci pochodzi adres, a wiersz
     * `IpAddress` nie wie nic o swojej podsieci. `include.applications`
     * czytają lista adresów i karta podsieci — żywe przypisania razem
     * z wierszem, jednym `findMany`, żeby rejestr nie pytał o nie per
     * adres. Przy pozostałych wywołaniach `include` nie ma i relacji
     * nie oczekujemy.
     */
    findMany(args?: {
      where?: {
        subnetId?: string | { in: string[] };
        address?: string;
        id?: { in: string[] };
      };
      include?: {
        subnet?: { select: { id: true; name: true; cidr: true } };
        applications?: {
          where: { application: { deletedAt: null } };
          select: { application: { select: { id: true; name: true } } };
        };
      };
    }): Promise<
      (IpAddressRow & {
        subnet?: SubnetRef;
        applications?: { application: { id: string; name: string } }[];
      })[]
    >;
    findUnique(args: { where: { id: string } }): Promise<IpAddressRow | null>;
    create(args: { data: IpAddressCreateData }): Promise<IpAddressRow>;
    update(args: { where: { id: string }; data: IpAddressUpdateData }): Promise<IpAddressRow>;
    upsert(args: {
      where: { subnetId_address: { subnetId: string; address: string } };
      create: IpAddressCreateData;
      update: { lastSeenAt: Date } & Partial<IpAddressCreateData>;
    }): Promise<IpAddressRow>;
    delete(args: { where: { id: string } }): Promise<IpAddressRow>;
    /**
     * Zbiorcze przestawienie statusu. Przy zwalnianiu przypisań wołane
     * dwukrotnie: `FREE` dla adresów bez żywych przypisań i `IN_USE` dla
     * tych, które zostały przypisane do innej, żywej aplikacji. `DEPRECATED`
     * nigdy nie jest zapisywany tą drogą — status katalogu zostaje decyzją
     * administratora (albo skanera z zadania 10).
     */
    updateMany(args: {
      where: { id: { in: string[] } };
      data: { status: IpAddressStatus };
    }): Promise<number>;
    count(args: { where: { subnetId: string } }): Promise<number>;
  };
  applicationIpAddress: {
    /**
     * Bez argumentów — czytają liczniki katalogu (przypisania ze WSZYSTKICH
     * aplikacji, również usuniętych miękko; właścicielem tej semantyki jest
     * Task 7). Z `where.ipAddressId` czyta `removeAddress`, z
     * `where.applicationId` — zestaw przypisań aplikacji.
     *
     * `ipAddressId.in` z `application: { deletedAt: null }` to pytanie
     * „co z tych adresów jest jeszcze przypisane do żywej aplikacji" —
     * bez niego zwolnienie adresu współdzielonego ustawiłoby `FREE`
     * mimo trwającego przypisania.
     */
    findMany(args?: {
      where?: {
        ipAddressId?: string | { in: string[] };
        applicationId?: string;
        application?: { deletedAt: null };
      };
    }): Promise<AssignmentRow[]>;
    count(args: { where: { ipAddressId: string } }): Promise<number>;
    /**
     * Wymiana zestawu idzie różnicą, nie pełnym przebudowaniem: `deleteMany`
     * tylko tego, co odpadło, `createMany` tylko tego, co doszło. Dzięki
     * temu przypisania, których nie ruszano, zachowują datę utworzenia.
     */
    createMany(args: { data: { applicationId: string; ipAddressId: string }[] }): Promise<number>;
    deleteMany(args: {
      where: { applicationId?: string; ipAddressId?: { in: string[] } };
    }): Promise<number>;
  };
  /**
   * `findFirst` służy walidacji istnienia aplikacji przy przypisywaniu
   * adresów — z filtrem `deletedAt: null`, bo usunięta miękko aplikacja to
   * śmieć w katalogu i nie ma do czego przypisywać adresów.
   * `findMany` — odczytowi „kto używa tego adresu" z tym samym filtrem
   * (usunięta aplikacja nie wraca na kartę adresu).
   */
  application: {
    findFirst(args: { where: { id: string; deletedAt: null } }): Promise<{ id: string } | null>;
    findMany(args: {
      where: { deletedAt: null; ipAddresses: { some: { ipAddressId: string } } };
      select: { id: true; name: true; baseUrl: true };
    }): Promise<ApplicationRefRow[]>;
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
