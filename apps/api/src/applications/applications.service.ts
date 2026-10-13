import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { IpamService } from '../ipam/ipam.service';
import type { AuthUser } from '../auth/decorators';
import {
  CREATE_FIELDS,
  type CreateApplicationDto,
  type ListApplicationsQuery,
  type UpdateApplicationDto,
} from './dto/application.dto';

const APP_INCLUDE = {
  admins: { select: { id: true, username: true, fullName: true, email: true } },
  environments: {
    include: {
      environment: { select: { id: true, name: true, color: true, sortOrder: true } },
    },
  },
  createdBy: { select: { id: true, username: true, fullName: true } },
} satisfies Prisma.ApplicationInclude;

/** Pola, po których pozwalamy sortować (biala lista — kolumna trafia do ORDER BY). */
const SORTABLE: Record<string, Prisma.ApplicationOrderByWithRelationInput> = {
  name: { name: 'asc' },
  version: { version: 'asc' },
  deliveryType: { deliveryType: 'asc' },
  status: { status: 'asc' },
  securityClass: { securityClass: 'desc' },
  criticality: { criticality: 'desc' },
  introducedOn: { introducedOn: 'desc' },
  sunsetOn: { sunsetOn: 'asc' },
  updatedAt: { updatedAt: 'desc' },
  createdAt: { createdAt: 'desc' },
};

/** Ile dni przed datą wycofania pokazujemy ostrzeżenie na dashboardzie. */
const EOL_WARNING_DAYS = 90;

/**
 * Granice okna „wycofywane w najbliższych N dniach".
 *
 * `sunsetOn` jest kolumną `@db.Date`, więc Postgres rzutuje ją przy
 * porównaniu na timestamp **o północy**. Zwykłe `now` (z godziną) dawało
 * przez to wynik odwrotny do zamierzonego: aplikacja wycofywana dziś
 * miała `sunsetOn < now`, więc trafiała do „po terminie wycofania",
 * a nie do „wycofywane w ciągu 90 dni". Granice wyznaczamy więc
 * zawsze od początku doby.
 *
 * Wyeksportowana dla testu — to granica między `date` a timestampem,
 * czyli dokładnie taki rodzaj błędu, którego nie widać w kodzie.
 */
export function eolWindow(
  now: Date,
  days: number = EOL_WARNING_DAYS,
): { soonFrom: Date; soonTo: Date; passedBefore: Date } {
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  return {
    soonFrom: from,
    soonTo: new Date(from.getTime() + days * 24 * 60 * 60 * 1000),
    passedBefore: from,
  };
}

/**
 * Sortowania dozwolone gościowi.
 *
 * Odwrotność `GUEST_HIDDEN_FIELDS`: te pola znikają z odpowiedzi, więc
 * nie wolno po nich sortować, bo kolejność wierszy zdradziłaby wartość.
 */
const GUEST_SORTABLE = new Set([
  'name',
  'version',
  'deliveryType',
  'status',
  'introducedOn',
  'sunsetOn',
  'updatedAt',
  'createdAt',
]);

/**
 * Buduje `orderBy` z nazwy kolumny przesłanej przez klienta.
 *
 * Nazwa trafia wprost do `ORDER BY`, więc musi przejść przez białą listę —
 * inaczej ktoś wysłałby nazwę kolumny jako wyrażenie SQL. Nieznana kolumna
 * (albo próba wstrzyknięcia) nie jest błędem: sortujemy po nazwie.
 *
 * Prefiks `-` odwraca kierunek. Jest po `-`, bo `name -createdAt` nie
 * ma sensu jako wyrażenie — kierunek w SQL to osobne pole.
 *
 * Wyciągnięta poza klasę, bo jest czysta i testowalna bez bazy.
 */
export function buildOrderBy(
  sort?: string,
  restrict = false,
): Prisma.ApplicationOrderByWithRelationInput[] {
  if (!sort) return [{ name: 'asc' }];

  const negate = sort.startsWith('-');
  const key = negate ? sort.slice(1) : sort;

  // Gość nie widzi klasyfikacji ani krytyczności, więc nie może po nich
  // sortować — kolejność wierszy sama w sobie zdradziłaby wartość,
  // nawet gdyby pole nie leciało w odpowiedzi.
  if (restrict && !GUEST_SORTABLE.has(key)) return [{ name: 'asc' }];

  const mapped = SORTABLE[key];
  if (!mapped) return [{ name: 'asc' }];

  return Object.entries(mapped).map(([field, dir]) => ({
    [field]: negate ? (dir === 'asc' ? 'desc' : 'asc') : dir,
  }));
}

/** Aplikacja wraz z relacjami — tak, jak wychodzi z APP_INCLUDE. */
type ApplicationWithRelations = Prisma.ApplicationGetPayload<{
  include: typeof APP_INCLUDE;
}>;

/** Pola, które znikaają z odpowiedzi dla niezalogowanego czytelnika. */
const PUBLIC_HIDDEN_FIELDS = [
  'securityClass',
  'criticality',
  'ownerEmail',
  // Blok „hosting i wsparcie". `deliveryType` i `baseUrl` zostają —
  // to informacja techniczna, bez której widok publiczny nie mówi,
  // czy aplikację da się w ogóle otworzyć z sieci. Reszta opisuje
  // nasze wnętrze: kto u nas administruje, gdzie stoi i pod jakim
  // kontaktem dzwonić. E-mail do wsparcia jest tu szczególnie
  // niewdzięczny — czytelnik bez sesji nie ma powodu nim obciążać
  // cudzego helpdesku.
  'hostingLocation',
  'adminTeam',
  'supportOwnerType',
  'supportOwnerName',
  'supportEmail',
  'supportUrl',
  'supportChannel',
  'supportNotes',
] as const;

/**
 * Usuwa pola, których publiczny (niezalogowany) czytelnik nie ma
 * prawa widzieć: klasyfikację bezpieczeństwa, krytyczność, właściciela
 * oraz dane wewnętrzne opisujące hosting i wsparcie.
 *
 * Robimy to **po stronie serwera**, a nie w interfejsie — ukrycie
 * kolumny w HTML nic nie daje, bo pełny rekord i tak leci w JSON-ie
 * i jest widoczny w devtoolsach. Pole po prostu znika z odpowiedzi.
 *
 * `ownerEmail` to adres, nie identyfikator, ale nadal jest daną
 * osobową — gość nie ma prawa go widzieć, więc pole znika z odpowiedzi.
 *
 * Wyeksportowana dla testu — to granica widoczności danych, więc
 * zasługuje na przypięcie przypadkiem, a nie tylko wywołaniem z usługi.
 */
export function toPublicView<
  T extends Partial<Record<(typeof PUBLIC_HIDDEN_FIELDS)[number], unknown>>,
>(app: T): Omit<T, (typeof PUBLIC_HIDDEN_FIELDS)[number]> {
  const view = { ...app };
  for (const field of PUBLIC_HIDDEN_FIELDS) {
    delete view[field];
  }
  return view;
}

/**
 * Prisma typuje `_count._all` jako opcjonalne i dopuszcza formę `true`.
 * My zawsze żądamy konkretnego kształtu, więc odczyt jest bezpieczny —
 * ten helper tylko usuwa wątpliwości kompilatora w jednym miejscu.
 */
function countOf(group: {
  _count?: { _all?: number } | true;
}): number {
  const c = group._count;
  return typeof c === 'object' && c !== null ? (c._all ?? 0) : 0;
}

/**
 * Data z bazy w formacie `RRRR-MM-DD` (tej samej, której używa DTO).
 *
 * Potrzebne przy scalaniu PATCH-a: sprawdzamy poprawność układu dat
 * wobec wartości, która zostanie w rekordzie, a nie tylko tej, którą
 * przyszedł w żądaniu.
 *
 * Wyeksportowana dla testu — to granica między formatem bazy a formatem
 * DTO, więc zasługuje na jednoznaczne sprawdzenie.
 */
export function isoDate(value: Date | null): string | undefined {
  return value ? value.toISOString().slice(0, 10) : undefined;
}

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    // Właścicielem logiki przypisań IP jest `IpamService` — druga kopia
    // „zdejmij przypisania i odblokuj adresy" w tym serwisie rozjechałaby
    // się z pierwszą przy pierwszej zmianie zachowania.
    private readonly ipam: IpamService,
  ) {}

  // ── Odczyt ─────────────────────────────────────────────────

  async list(query: ListApplicationsQuery, restrict = false) {
    const where = this.buildWhere(query, restrict);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.application.findMany({
        where,
        include: APP_INCLUDE,
        orderBy: buildOrderBy(query.sort, restrict),
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.application.count({ where }),
    ]);

    return {
      items: items.map((a) => this.serialize(a)),
      total,
      limit: query.limit,
      offset: query.offset,
      hasMore: query.offset + items.length < total,
    };
  }

  async get(id: string) {
    const app = await this.prisma.application.findFirst({
      where: { id, deletedAt: null },
      include: APP_INCLUDE,
    });
    if (!app) throw new NotFoundException('Aplikacja nie istnieje.');
    return this.serialize(app);
  }

  /** Środowiska — lista do filtrów i formularzy. */
  async environments() {
    return this.prisma.environment.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * Właściciele jako lista adresów — do selecta w filtrach.
   *
   * Źródłem są istniejące aplikacje, a nie `users`: właścicielem
   * bywa ktoś bez konta, więc słownik użytkowników pokazałby tylko
   * część realnych właścicieli i pozwoliłby przefiltrować tylko po
   * nich. `distinct` na kolumnie skraca listę do unikalnych adresów.
   */
  async ownerOptions() {
    const rows = await this.prisma.application.findMany({
      where: { deletedAt: null, ownerEmail: { not: null } },
      distinct: ['ownerEmail'],
      select: { ownerEmail: true },
      orderBy: { ownerEmail: 'asc' },
    });
    return rows.map((r) => r.ownerEmail).filter((e): e is string => Boolean(e));
  }

  /** Statystyki na dashboard. */
  async stats() {
    const now = new Date();
    const { soonFrom, soonTo, passedBefore } = eolWindow(now);

    const [
      total,
      byStatus,
      bySecurityClass,
      byCriticality,
      byEnvironment,
      byDeliveryType,
      missingOwner,
      missingDescription,
      eolSoonCount,
      eolPassed,
      recent,
    ] = await this.prisma.$transaction([
      this.prisma.application.count({ where: { deletedAt: null } }),

      this.prisma.application.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
        orderBy: { status: 'asc' },
      }),

      this.prisma.application.groupBy({
        by: ['securityClass'],
        where: { deletedAt: null },
        _count: { _all: true },
        orderBy: { securityClass: 'asc' },
      }),

      this.prisma.application.groupBy({
        by: ['criticality'],
        where: { deletedAt: null },
        _count: { _all: true },
        orderBy: { criticality: 'asc' },
      }),

      this.prisma.applicationEnvironment.groupBy({
        by: ['environmentId'],
        where: { application: { deletedAt: null } },
        _count: { _all: true },
        orderBy: { environmentId: 'asc' },
      }),

      // Typ dostarczenia to zamknięty zbiór czterech wartości, więc
      // w przeciwieństwie do dawniej wolnej tekstowej `category` nic
      // tu nie ucinamy — żadna kategoria nie wypada z pulpitu.
      this.prisma.application.groupBy({
        by: ['deliveryType'],
        where: { deletedAt: null },
        _count: { _all: true },
        orderBy: { _count: { deliveryType: 'desc' } },
      }),

      this.prisma.application.count({
        where: { deletedAt: null, ownerEmail: null },
      }),
      this.prisma.application.count({
        where: {
          deletedAt: null,
          OR: [{ description: null }, { description: '' }],
        },
      }),

      // Wycofywane w ciągu najbliższych 90 dni.
      // Granice od początku doby — `sunsetOn` to `date`, więc porównanie
      // z timestampem z godziną potraktowałoby „wycofywane dziś"
      // jako termin już miniony (patrz `eolWindow`).
      this.prisma.application.count({
        where: {
          deletedAt: null,
          sunsetOn: { gte: soonFrom, lte: soonTo },
          status: { not: 'RETIRED' },
        },
      }),

      // Po terminie wycofania, a wciąż nieformalnie „żywe"
      this.prisma.application.count({
        where: {
          deletedAt: null,
          sunsetOn: { lt: passedBefore },
          status: { notIn: ['RETIRED', 'DEPRECATED'] },
        },
      }),

      this.prisma.application.findMany({
        where: { deletedAt: null },
        include: APP_INCLUDE,
        orderBy: { updatedAt: 'desc' },
        take: 8,
      }),
    ]);

    // Nazwy środowisk do mapowania liczników
    const envNames = await this.prisma.environment.findMany({
      select: { id: true, name: true, color: true },
      orderBy: { sortOrder: 'asc' },
    });
    const envMap = new Map(envNames.map((e) => [e.id, e]));

    return {
      total,
      byStatus: byStatus.map((g) => ({ key: g.status, count: countOf(g) })),
      bySecurityClass: bySecurityClass.map((g) => ({
        key: g.securityClass,
        count: countOf(g),
      })),
      byCriticality: byCriticality.map((g) => ({
        key: g.criticality,
        count: countOf(g),
      })),
      byEnvironment: byEnvironment.map((g) => ({
        id: g.environmentId,
        name: envMap.get(g.environmentId)?.name ?? 'nieznane',
        color: envMap.get(g.environmentId)?.color ?? 'slate',
        count: countOf(g),
      })),
      byDeliveryType: byDeliveryType.map((g) => ({
        key: g.deliveryType,
        count: countOf(g),
      })),
      incomplete: { missingOwner, missingDescription },
      eol: { soon: eolSoonCount, passed: eolPassed, windowDays: EOL_WARNING_DAYS },
      recent: recent.map((a) => this.serialize(a)),
    };
  }

  // ── Zapis ──────────────────────────────────────────────────

  async create(dto: CreateApplicationDto, actor: AuthUser, ip?: string) {
    // Pola wymagane pilnujemy tu, a nie deklaratywnie: `name` i `version`
    // muszą być przy tworzeniu, ale przy PATCH-u (gdzie DTO jest
    // `PartialType`) ich brak jest poprawny.
    if (!dto.name?.trim()) throw new BadRequestException('Nazwa jest wymagana.');
    if (!dto.version?.trim()) {
      throw new BadRequestException('Wersja jest wymagana.');
    }

    await this.assertNameFree(dto.name);

    // Weryfikacja referencji — lepszy komunikat błędu niż obcy komunikat Prisma
    await this.assertUsersExist(dto.adminIds);
    await this.assertEnvironmentsExist(dto.environmentIds);
    this.assertDates(dto.introducedOn, dto.sunsetOn);

    const app = await this.prisma.application.create({
      data: {
        ...this.mapDto(dto),
        createdById: actor.id,
        admins: dto.adminIds?.length
          ? { connect: dto.adminIds.map((id) => ({ id })) }
          : undefined,
        environments: dto.environmentIds?.length
          ? {
              create: dto.environmentIds.map((environmentId) => ({
                environment: { connect: { id: environmentId } },
              })),
            }
          : undefined,
      },
      include: APP_INCLUDE,
    });

    await this.audit.record({
      action: 'app.created',
      entity: 'Application',
      entityId: app.id,
      actorId: actor.id,
      actorName: actor.username,
      changes: { name: { from: null, to: app.name } },
      ip,
    });

    return this.serialize(app);
  }

  async update(
    id: string,
    dto: UpdateApplicationDto,
    actor: AuthUser,
    ip?: string,
  ) {
    const before = await this.prisma.application.findFirst({
      where: { id, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Aplikacja nie istnieje.');

    if (dto.name && dto.name.toLowerCase() !== before.name.toLowerCase()) {
      await this.assertNameFree(dto.name, id);
    }

    await this.assertUsersExist(dto.adminIds);
    await this.assertEnvironmentsExist(dto.environmentIds);

    // PATCH scala dane z tym, co jest w bazie. Dopiero tak walidacja dat
    // widzi pełny obraz — samo `dto` mogłoby mieć `sunsetOn` bez
    // `introducedOn` (albo odwrotnie) i przeszłoby, mimo że razem
    // z istniejącym rekordem tworzą daty w złej kolejności.
    const mergedDates = {
      introducedOn: dto.introducedOn ?? isoDate(before.introducedOn),
      sunsetOn: dto.sunsetOn ?? isoDate(before.sunsetOn),
    };
    this.assertDates(mergedDates.introducedOn, mergedDates.sunsetOn);

    // Relacje wymagają osobnego connect/disconnect — w `data` poniżej ich nie ma.
    // Pusty zbiór to nie „brak zmiany", tylko wyczyść przypisania.
    const { adminIds, environmentIds, ...scalars } = dto;

    const app = await this.prisma.application.update({
      where: { id },
      data: {
        ...this.mapPatchDto(scalars),
        ...(adminIds
          ? { admins: { set: adminIds.map((aid) => ({ id: aid })) } }
          : {}),
        ...(environmentIds
          ? {
              environments: {
                deleteMany: {},
                create: environmentIds.map((environmentId) => ({
                  environment: { connect: { id: environmentId } },
                })),
              },
            }
          : {}),
      },
      include: APP_INCLUDE,
    });

    await this.audit.record({
      action: 'app.updated',
      entity: 'Application',
      entityId: id,
      actorId: actor.id,
      actorName: actor.username,
      changes: AuditService.diff(
        before as unknown as Record<string, unknown>,
        app as unknown as Record<string, unknown>,
        ['updatedAt', 'createdAt', 'admins', 'environments', 'createdBy'],
      ),
      ip,
    });

    return this.serialize(app);
  }

  /**
   * Soft delete. Nie kasujemy rekordu, bo trzymamy referencje w audycie
   * i w aplikacjach (kto był właścicielem).
   */
  async remove(id: string, actor: AuthUser, ip?: string) {
    const app = await this.prisma.application.findFirst({
      where: { id, deletedAt: null },
    });
    if (!app) throw new NotFoundException('Aplikacja nie istnieje.');

    // Kolejność, nie atomowość. Zapytania poniżej (i w `IpamService`, i w
    // dzienniku) idą bazowym klientem Prisma, którego Prisma NIE włącza w
    // `$transaction(fn)` — wycofanie transakcji ich nie obejmuje. Transakcja
    // daje więc gwarancję tylko wtedy, gdy wszystko się uda, a wyjątek jest
    // mniej prawdopodobny niż przerwanie procesu.
    //
    // Dlaczego w ogóle: kolejność „zdejmij przypisania → przestaw status”
    // sprawia, że niespójny stan (aplikacja usunięta, adres jeszcze `IN_USE`)
    // jest krótkotrwały i naprawialny przez ponowne zapisanie adresu, a nie
    // stanem, w którym adres jest `FREE` mimo żywego przypisania — ten
    // zostawiłby blokadę, której żaden kod już nie zdejmie.
    await this.prisma.$transaction(async () => {
      await this.prisma.application.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      await this.ipam.releaseIpAddressesForApplication(id);

      await this.audit.record({
        action: 'app.deleted',
        entity: 'Application',
        entityId: id,
        actorId: actor.id,
        actorName: actor.username,
        changes: { name: { from: app.name, to: null } },
        ip,
      });
    });
  }

  /** Przywrócenie usuniętej aplikacji.
   *
   * Przywrócenie NIE przywraca przypisań IP — `remove()` skasował je
   * fizycznie, żeby odblokować adresy. Administrator przypisuje je
   * ponownie z karty aplikacji, świadomie, a nie automatycznie.
   */
  async restore(id: string, actor: AuthUser, ip?: string) {
    const app = await this.prisma.application.findUnique({ where: { id } });
    if (!app) throw new NotFoundException('Aplikacja nie istnieje.');
    if (!app.deletedAt) {
      // Nieusunięta — zwracamy pełny rekord z relacjami
      return this.get(id);
    }

    await this.prisma.application.update({
      where: { id },
      data: { deletedAt: null },
    });

    await this.audit.record({
      action: 'app.restored',
      entity: 'Application',
      entityId: id,
      actorId: actor.id,
      actorName: actor.username,
      ip,
    });

    return this.get(id);
  }

  // ── Eksport CSV ────────────────────────────────────────────

  /**
   * Buduje CSV. Komórki z cudzysłowem, przecinkiem lub nową linią
   * trzeba owinąć w cudzysłowy i podwoić cudzysłowy wewnątrz.
   */
  async exportCsv(query: ListApplicationsQuery): Promise<string> {
    const where = this.buildWhere(query);
    const apps = await this.prisma.application.findMany({
      where,
      include: APP_INCLUDE,
      orderBy: { name: 'asc' },
      take: 10_000, // bezpieczny limit eksportu
    });

    const header = [
      'Nazwa',
      'Wersja',
      'Typ dostarczenia',
      'Adres bazowy',
      'Gdzie hostowane',
      'Zespół administracyjny',
      'Wsparcie prowadzi',
      'Wsparcie — kto',
      'Wsparcie — e-mail',
      'Wsparcie — URL',
      'Wsparcie — kanał',
      'Wsparcie — uwagi',
      'Status',
      'Krytyczność',
      'Klasyfikacja',
      'Właściciel',
      'Administratorzy',
      'Środowiska',
      'Wprowadzono',
      'Wycofanie',
      'Wniosek o dostęp',
      'Dostawca',
      'Licencja',
      'Liczba licencji',
      'Koszt roczny',
      'Opis',
      'Cel',
      'WWW',
      'Dokumentacja',
      'Repozytorium',
      'Runbook',
      'Integracje',
    ];

    const escape = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const rows = apps.map((a) => {
      const s = this.serialize(a);
      return [
        s.name,
        s.version,
        s.deliveryType,
        s.baseUrl ?? '',
        s.hostingLocation ?? '',
        s.adminTeam ?? '',
        s.supportOwnerType ?? '',
        s.supportOwnerName ?? '',
        s.supportEmail ?? '',
        s.supportUrl ?? '',
        s.supportChannel ?? '',
        s.supportNotes ?? '',
        s.status,
        s.criticality,
        s.securityClass,
        s.ownerEmail ?? '',
        s.admins.map((u) => u.fullName).join('; '),
        s.environments.map((e) => e.name).join('; '),
        s.introducedOn ?? '',
        s.sunsetOn ?? '',
        s.accessRequestRequired ? 'Tak' : 'Nie',
        s.vendor ?? '',
        s.license ?? '',
        s.licenseCount ?? '',
        s.annualCost ?? '',
        s.description ?? '',
        s.purpose ?? '',
        s.websiteUrl ?? '',
        s.docsUrl ?? '',
        s.repoUrl ?? '',
        s.runbookUrl ?? '',
        s.integrations ?? '',
      ]
        .map(escape)
        .join(',');
    });

    // BOM, żeby Excel poprawnie odczytał UTF-8 (polskie znaki)
    return '﻿' + [header.join(','), ...rows].join('\r\n');
  }

  // ── Pomocnicze ─────────────────────────────────────────────

  /**
   * Buduje `where` dla zapytania listy.
   *
   * `restrict` = true oznacza gościa (brak sesji). Wtedy ignorujemy
   * filtry, których nie ma w publicznym widoku — `securityClass`,
   * `criticality` i `ownerEmail`. Bez tego byłyby wyrocznią: gość
   * odpytywałby `?securityClass=RESTRICTED` i po samej liczbie
   * wyników odtwarzał ukrytą klasyfikację, mimo że samo pole
   * nigdy nie leci w odpowiedzi.
   */
  private buildWhere(
    query: ListApplicationsQuery,
    restrict = false,
  ): Prisma.ApplicationWhereInput {
    const where: Prisma.ApplicationWhereInput = {};

    if (query.includeDeleted && !restrict) {
      // pokaż wszystkie, w tym usunięte
    } else {
      where.deletedAt = null;
    }

    if (query.q) {
      const q = query.q.trim();
      // insensitive mode pozwala szukać bez znajomości wielkości liter
      const clauses: Prisma.ApplicationWhereInput[] = [
        { name: { contains: q, mode: 'insensitive' } },
        { version: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { purpose: { contains: q, mode: 'insensitive' } },
        { vendor: { contains: q, mode: 'insensitive' } },
      ];

      // Wyszukiwanie po adresie właściciela też zdradzałoby właściciela
      // gościowi — samo trafienie w wynik wystarczy, żeby wyciągnąć adres.
      if (!restrict) {
        clauses.push(
          { ownerEmail: { contains: q, mode: 'insensitive' } },
          { admins: { some: { fullName: { contains: q, mode: 'insensitive' } } } },
        );

        // Blok wsparcia zdradzałby gościowi to, co `toPublicView` mu usuwa:
        // trafienie po nazwie zespołu albo adresie dostawcy wystarczyłoby,
        // żeby odtworzyć ukryte pola.
        clauses.push(
          { adminTeam: { contains: q, mode: 'insensitive' } },
          { hostingLocation: { contains: q, mode: 'insensitive' } },
          { supportOwnerName: { contains: q, mode: 'insensitive' } },
          { supportEmail: { contains: q, mode: 'insensitive' } },
          { supportNotes: { contains: q, mode: 'insensitive' } },
        );
      }

      where.OR = clauses;
    }

    if (query.status) where.status = query.status as never;
    if (query.deliveryType) {
      // Na enumie nie ma `contains`, więc porównanie jest zwykłe —
      // wielkość liter rozstrzyga sam typ w bazie.
      where.deliveryType = query.deliveryType as never;
    }
    if (query.environmentId) {
      // Relacja idzie przez tabelę łączącą, więc filtrujemy po environmentId
      where.environments = { some: { environmentId: query.environmentId } };
    }

    if (query.missingOwner) where.ownerEmail = null;

    if (!restrict) {
      if (query.securityClass) where.securityClass = query.securityClass as never;
      if (query.criticality) where.criticality = query.criticality;
      if (query.ownerEmail) where.ownerEmail = query.ownerEmail;
    }

    return where;
  }

  private mapDto(dto: CreateApplicationDto): Prisma.ApplicationUncheckedCreateInput {
    return {
      name: dto.name,
      version: dto.version,
      description: dto.description ?? null,
      purpose: dto.purpose ?? null,
      ownerEmail: dto.ownerEmail ?? null,
      introducedOn: dto.introducedOn ? new Date(dto.introducedOn) : null,
      sunsetOn: dto.sunsetOn ? new Date(dto.sunsetOn) : null,
      securityClass: dto.securityClass ?? 'INTERNAL',
      criticality: dto.criticality ?? 2,
      status: dto.status ?? 'PROD',
      accessRequestRequired: dto.accessRequestRequired ?? false,
      // `GENERAL_USE` to nie „nie wiem", tylko „to program na stanowisku"
      // — najczęstszy przypadek, więc pełny POST bez tego pola musi dać
      // rekord z poprawnym typem, a nie z pustym.
      deliveryType: dto.deliveryType ?? 'GENERAL_USE',
      baseUrl: dto.baseUrl ?? null,
      hostingLocation: dto.hostingLocation ?? null,
      adminTeam: dto.adminTeam ?? null,
      supportOwnerType: dto.supportOwnerType ?? null,
      supportOwnerName: dto.supportOwnerName ?? null,
      supportEmail: dto.supportEmail ?? null,
      supportUrl: dto.supportUrl ?? null,
      supportChannel: dto.supportChannel ?? null,
      supportNotes: dto.supportNotes ?? null,
      vendor: dto.vendor ?? null,
      license: dto.license ?? null,
      licenseCount: dto.licenseCount ?? null,
      // `== null` łapie `undefined` i `null`. `new Prisma.Decimal(null)` rzuca
// wyjątkiem, więc samo `?? null` na wejściu nie wystarczy — a formularz
// wysyła `null` dla pustego pola kosztu.
annualCost:
        dto.annualCost == null ? null : new Prisma.Decimal(dto.annualCost),
      websiteUrl: dto.websiteUrl ?? null,
      docsUrl: dto.docsUrl ?? null,
      repoUrl: dto.repoUrl ?? null,
      runbookUrl: dto.runbookUrl ?? null,
      integrations: dto.integrations ?? null,
    };
  }

  /**
   * Mapowanie dla PATCH — tylko pola obecne w ładunku.
   *
   * POST ma sens wypełniać cały rekord (dlatego `mapDto` ustawia
   * wartości domyślne), ale PATCH z definicji scala. Bez tego
   * pojedyncze żądanie `{ name, version }` wyzerowałoby opis,
   * właściciela, status i krytyczność — cicho, bez błędu.
   *
   * Reguła: `undefined` znaczy „nie ruszaj", `null` znaczy „wyczyść".
   * Rozróżnienie robi transformacja w DTO (`""` → `undefined`,
   * `null` zostaje `null`).
   */
  private mapPatchDto(
    dto: CreateApplicationDto | UpdateApplicationDto,
  ): Prisma.ApplicationUncheckedUpdateInput {
    const full = this.mapDto(dto as CreateApplicationDto) as Record<string, unknown>;
    const data: Record<string, unknown> = {};

    for (const key of Object.keys(full)) {
      // Sprawdzamy deklarację DTO, nie zawartość ładunku: `PartialType`
      // nie tworzy właściwości na prototypie, więc `key in dto` dawałoby
      // fałszywy alarm dla każdego pola nieobecnego w żądaniu — czyli
      // każdy częściowy PATCH kończyłby się wyjątkiem.
      if (!CREATE_FIELDS.has(key)) {
        throw new Error(
          `mapPatchDto: "${key}" nie ma odpowiednika w CreateApplicationDto — ` +
            'pola obecne tylko w mapDto() nadpisałyby wartość przez PATCH.',
        );
      }
      // `undefined` = pole nieobecne → nie ruszamy. `null` = jawnie
      // wyczyść (tak zgłasza formularz dla pustych pól).
      if (dto[key as keyof CreateApplicationDto] !== undefined) {
        data[key] = full[key];
      }
    }

    return data as Prisma.ApplicationUncheckedUpdateInput;
  }

  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const existing = await this.prisma.application.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true, name: true, deletedAt: true },
    });
    if (!existing) return;

    throw new ConflictException(
      existing.deletedAt
        ? `Aplikacja „${existing.name}" istnieje, ale została usunięta. Przywróć ją albo zmień nazwę.`
        : `Aplikacja o nazwie „${existing.name}" już istnieje.`,
    );
  }

  private async assertUsersExist(adminIds?: string[]): Promise<void> {
    const ids = [...(adminIds ?? [])];
    if (ids.length === 0) return;

    const unique = [...new Set(ids)];
    const found = await this.prisma.user.count({
      where: { id: { in: unique } },
    });
    if (found !== unique.length) {
      throw new BadRequestException(
        'Wskazano użytkownika, który nie istnieje. Odśwież formularz i spróbuj ponownie.',
      );
    }
  }

  private async assertEnvironmentsExist(ids?: string[]): Promise<void> {
    if (!ids?.length) return;
    const found = await this.prisma.environment.count({ where: { id: { in: ids } } });
    if (found !== ids.length) {
      throw new BadRequestException(
        'Wskazano środowisko, które nie istnieje. Odśwież formularz i spróbuj ponownie.',
      );
    }
  }

  private assertDates(introducedOn?: string, sunsetOn?: string): void {
    if (introducedOn && sunsetOn) {
      if (new Date(sunsetOn) < new Date(introducedOn)) {
        throw new BadRequestException(
          'Data wycofania nie może być wcześniejsza niż data wprowadzenia.',
        );
      }
    }
  }

  /**
   * Zamienia Decimal na liczbę, rozwija relację junction i porządkuje
   * kolekcje. Frontend dostaje gotowe do wyrenderowania dane:
   * `environments` to lista samych obiektów środowiska, nie wpisów łączących.
   */
  private serialize(app: ApplicationWithRelations) {
    return {
      ...app,
      annualCost: app.annualCost ? Number(app.annualCost) : null,
      environments: app.environments
        .map((link) => link.environment)
        .sort((a, b) => a.sortOrder - b.sortOrder),
      admins: [...app.admins].sort((a, b) =>
        a.fullName.localeCompare(b.fullName, 'pl'),
      ),
    };
  }

  private toPublicView(app: ReturnType<ApplicationsService['serialize']>) {
    return toPublicView(app);
  }

  /**
   * Lista dla gościa — bez klasyfikacji, krytyczności i właścicieli.
   *
   * `restrict` przekazujemy niżej, bo samo usunięcie pól z odpowiedzi
   * nie wystarcza: filtr i sortowanie działają w bazie, więc gość
   * odzyskałby ukryte wartości z liczby wyników albo z kolejności
   * wierszy. Dlatego `buildWhere` i `buildOrderBy` ignorują te klucze.
   */
  async listPublic(query: ListApplicationsQuery) {
    const result = await this.list(query, true);
    return {
      ...result,
      items: result.items.map((app) => this.toPublicView(app)),
    };
  }

  /** Szczegóły dla gościa — te same cięcia co na liście. */
  async getPublic(id: string) {
    return this.toPublicView(await this.get(id));
  }
}
