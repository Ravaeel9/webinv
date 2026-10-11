# IPAM — katalog podsieci i adresów — Plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dodać do rejestru aplikacji katalog podsieci i adresów IP oraz powiązać każdą aplikację `SELF_HOSTED` z adresami, które wykorzystuje.

**Architecture:** Nowy moduł NestJS `apps/api/src/ipam/` obok istniejącego `applications/`. Warstwa `cidr.ts` to czyste funkcje bez bazy i bez zależności — cała walidacja zakresów mieszka tam, więc testuje się ją bez kontenera. `IpamService` rozmawia z bazą przez wąski port `IpamPort`, tak jak robi to dziś `SettingsService`, dzięki czemu testy serwisu nie podnoszą Postgresa. Relacja aplikacja ↔ adres to tabela pośrednia `application_ip_addresses`; wymiana zestawu idzie jednym `PUT`.

**Tech Stack:** NestJS 11 + Fastify 5, Prisma 6 + PostgreSQL 17, class-validator, React 19 + Vite, TanStack Query. Testy: `node:test` przez `tsx` (`npm test` w `apps/api`), bez bazy.

**Spec:** `docs/superpowers/specs/2026-10-11-ipam-design.md` (kopia robocza: `/home/rafik/.opencode/plan/2026-10-11-ipam-design.md`). Plan implementuje sekcje 1–4 i 6–8 specyfikacji. **Sekcja 5 (import z nmap XML) jest planem osobnym** — `docs/superpowers/plans/2026-10-11-nmap-import.md`.

## Global Constraints

- Node `>=22`, npm workspaces: `apps/api` i `apps/web`. Komendy z roota katalogu repo, chyba że krok mówi inaczej.
- Testy API: `npm run test --workspace @webinv/api` (uruchamia `typecheck:test` i `tsx --test test/*.test.ts`). **Testy nie mogą wymagać bazy danych.**
- Testy web: `npm run test:web-build --workspace @webinv/web` (to kompilacja produkcyjna, nie osobny runner).
- Typecheck: `npm run typecheck --workspaces --if-present`. Musi przechodzić.
- **Zero nowych zależności w tym planie.** (`fast-xml-parser` pojawia się dopiero w planie importu.)
- Cała tekst widoczny dla użytkownika po polsku, bez diakrytyków w nazwach plików i w URL-ach tras.
- Komentarze w kodzie po polsku i **zawsze z powodem** — objaśniają dlaczego, nie co. Wzorzec: patrz `apps/api/src/settings/settings.service.ts`.
- Nazwy pól w Prisma: `snake_case` w bazie (`@map`), `camelCase` w TypeScript.
- Style: 2 spacje, cudzysłowy pojedyncze, średniki na końcu — zgodnie z resztą repo.
- Porty nazywane tak jak delegaty Prisma (`subnet`, `ipAddress`, `applicationIpAddress`) — inaczej test podawałby obiekt z innym polem i dostałby `undefined` zamiast błędu kompilacji.

## Review Focus

Pięć trybów, które specyfikacja wyobraża sobie, ale żaden jej test nie opisuje. Test dla każdego jest wskazany w zadaniu, które ma ten kod.

1. **CIDR z ustawionymi bitami hosta** (`10.20.1.5/24`) — użytkownik pisze adres, nie sieć. Odrzucamy z czytelnym komunikatem, **nie** po cichu normalizujemy do `10.20.0.0/24`, bo wtedy użytkownik nie dostanie informacji o tym, co naprawdę zapisaliśmy. → Task 2
2. **Zmiana CIDR na zakres nieobejmujący istniejących adresów** — zapis bez tego sprawiłby, że adresy wypadłyby z własnej podsieci, a `containsSubnet` w przeglądzie przestałby działać. Odrzucamy całą zmianę, nie zostawiamy adresów „na zewnątrz". → Task 5
3. **Usunięcie aplikacji (soft delete) zostawia adresy w stanie `IN_USE` bez aplikacji** — kaskada zniknie przy zniknięciu wiersza aplikacji, a adres zostanie zablokowany na zawsze. → Task 7
4. **Dwa równoległe dodania tego samego adresu** (dwie karty przeglądarki) — wygrywa `@@unique([subnetId, address])`, który w surowej postaci daje 500. Musi być `409 Conflict` z komunikatem dla człowieka. → Task 6
5. **VIEWER i gość bez sesji wobec IPAM** — to mapa wewnętrznej infrastruktury, nie treść publiczna. `VIEWER` czyta, nie zapisuje; gość nie ma trasy w ogóle. → Task 8

---

## Struktura plików

**Tworzone — API:**

| Plik | Odpowiedzialność (jedna) |
|---|---|
| `apps/api/src/ipam/cidr.ts` | Czysty rachunek na IPv4: parse, zawieranie, nakładanie, sortowanie. Zero zależności. |
| `apps/api/src/ipam/nmap-xml.ts` | *(plan importu — nie w tym planie)* |
| `apps/api/src/ipam/ipam.port.ts` | Typ `IpamPort` — wąski widok bazy i dziennika, który serwis woła. |
| `apps/api/src/ipam/ipam.service.ts` | Cała logika: podsieci, adresy, przypisania, kolizje zakresów. |
| `apps/api/src/ipam/ipam.controller.ts` |Trasy `/api/ipam/*` i `/api/applications/:appId/ip-addresses`. |
| `apps/api/src/ipam/ipam.module.ts` | Rejestracja kontrolera i serwisu. |
| `apps/api/src/ipam/dto/ipam.dto.ts` | Klasy walidacji ładunków. |

**Tworzone — API testy:**

| Plik | Co sprawdza |
|---|---|
| `apps/api/test/ipam-cidr.test.ts` | Czysta matematyka zakresów (Review Focus 1). |
| `apps/api/test/ipam-dto.test.ts` | Walidacja ładunków, te same opcje co `ValidationPipe`. |
| `apps/api/test/ipam-permissions.test.ts` | Role ↔ uprawnienia, w tym `ALL_PERMISSIONS`. |
| `apps/api/test/ipam-service.test.ts` | Logika serwisu na atrapie portu. |
| `apps/api/test/ipam-app-delete.test.ts` | Soft delete aplikacji a przypisania IP (Review Focus 3). |

**Tworzone — web:**

| Plik | Odpowiedzialność (jedna) |
|---|---|
| `apps/web/src/pages/IpamListPage.tsx` | Lista podsieci, rozwijanie wiersza, podsumowania. |
| `apps/web/src/pages/SubnetDetailPage.tsx` | Adresy jednej podsieci. |
| `apps/web/src/pages/SubnetFormPage.tsx` | Dodanie i edycja podsieci jednym komponentem. |
| `apps/web/src/components/ipam/AddressTable.tsx` | Tabela adresów — używana w dwóch miejscach. |
| `apps/web/src/components/ipam/IpAddressPicker.tsx` | Wielokrotny wybór adresów w formularzu aplikacji. |

**Modyfikowane:**

- `apps/api/prisma/schema.prisma` — `Subnet`, `IpAddress`, `ApplicationIpAddress`, enum `IpStatus`, relacja w `Application`.
- `apps/api/src/app.module.ts` — `IpamModule` w `imports`.
- `apps/api/src/auth/permissions.ts` — `ipam:read`, `ipam:write`.
- `apps/api/src/applications/applications.service.ts` — `remove()` zdejmuje przypisania IP (Review Focus 3).
- `apps/web/src/types.ts` — `Subnet`, `IpAddress`, `IpStatus`, odpowiedzi, `ipam:*` w `PERMISSIONS`.
- `apps/web/src/lib/queries.ts` — klucze `qk.ipam*` i hooki.
- `apps/web/src/components/layout/AppLayout.tsx` — wpis w `NAV`.
- `apps/web/src/router.tsx` — cztery trasy `/ipam/*`.
- `apps/web/src/pages/ApplicationDetailPage.tsx` — sekcja „Adresy IP".
- `apps/web/src/pages/ApplicationFormPage.tsx` — pole wyboru adresów.
- `docs/API.md`, `docs/BAZA-DANYCH.md`, `docs/ARCHITEKTURA.md` — dokumentacja.

---

### Task 1: Schemat bazy i migracja

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261012090000_ipam/migration.sql` (wygenerowana przez Prisma)

**Interfaces:**
- Consumes: brak (pierwszy task).
- Produces: modele Prisma `Subnet`, `IpAddress`, `ApplicationIpAddress`, enum `IpStatus`, oraz `Application.ipAddresses`. Każdy task dalej operuje na tych nazwach i typach — `IpStatus` ma dokładnie wartości `FREE | IN_USE | DEPRECATED`.

- [ ] **Step 1: Opisz encje w `schema.prisma`**

Dodaj `enum IpStatus { FREE IN_USE DEPRECATED }` obok istniejących enumów. Dodaj trzy modele — dokładnie w tej postaci (komentarze w repo są po polsku i wyjaśniają powód):

```prisma
enum IpStatus {
  FREE       // wolny lub zarezerwowany, bez aplikacji
  IN_USE     // przypisany do co najmniej jednej aplikacji
  DEPRECATED // wycofywany, czeka na zwolnienie
}
```

```prisma
model Subnet {
  id          String   @id @default(uuid()) @db.Uuid
  name        String   @unique @db.Citext
  // "10.20.0.0/16" — tekst, nie typ inet. Walidację zakresu robi
  // src/ipam/cidr.ts, bo chcemy ją testować bez bazy.
  cidr        String   @db.VarChar(18)
  description String?  @db.Text
  color       String   @default("slate") @db.VarChar(30)
  vlan        Int?     @db.SmallInt
  location    String?  @db.VarChar(200)
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  addresses IpAddress[]
  @@map("subnets")
}
```

```prisma
model IpAddress {
  id      String @id @default(uuid()) @db.Uuid
  subnetId String @map("subnet_id") @db.Uuid
  subnet  Subnet @relation(fields: [subnetId], references: [id], onDelete: Cascade)

  address     String   @db.VarChar(18) // pojedynczy IPv4, bez maski
  // Status jest tu, a nie na relacji: adres bywa zarezerwowany, zanim
  // ktokolwiek go przypisze, i relacja tego stanu nie odwzorowuje.
  status      IpStatus @default(FREE)
  description String?  @db.Text
  // Ostatnie potwierdzenie skanem (plan importu). Bez tej daty katalog
  // nie mówi, co zniknęło z sieci.
  lastSeenAt  DateTime? @map("last_seen_at")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  applications ApplicationIpAddress[]
  @@unique([subnetId, address])
  @@index([status])
  @@map("ip_addresses")
}
```

```prisma
model ApplicationIpAddress {
  applicationId String      @map("application_id") @db.Uuid
  ipAddressId   String      @map("ip_address_id") @db.Uuid
  createdAt     DateTime    @default(now()) @map("created_at")

  application Application @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  // onDelete: Cascade jest tu bezpieczne — kasowanie podsieci ma zabrać
  // przypisania razem z adresami, a nie zostawić martwe wiersze.
  ipAddress   IpAddress   @relation(fields: [ipAddressId], references: [id], onDelete: Cascade)

  @@id([applicationId, ipAddressId])
  @@index([ipAddressId])
  @@map("application_ip_addresses")
}
```

W modelu `Application` dodaj relację `ipAddresses ApplicationIpAddress[]` (obok istniejących `environments`).

- [ ] **Step 2: Wygeneruj i zastosuj migrację**

Run: `npm run prisma:migrate --workspace @webinv/api -- --name ipam`
Expected: Prisma pyta o nazwę migracji (już ją podałeś), tworzy `apps/api/prisma/migrations/20261012090000_ipam/migration.sql` i stosuje ją. Migracja zawiera `CREATE TYPE "IpStatus"`, trzy `CREATE TABLE`, dwa `CREATE INDEX` na `ip_addresses` (`status`, `subnet_id_address` dla unique), dwa `CREATE INDEX` na `application_ip_addresses` i klucze obce z `ON DELETE CASCADE`.

Jeśli baza z `docker compose` nie działa, użyj `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db` i `npm run prisma:generate --workspace @webinv/api`.

- [ ] **Step 3: Sprawdź, że klient Prisma zna nowe modele**

Run: `npm run prisma:generate --workspace @webinv/api && npm run typecheck --workspace @webinv/api`
Expected: brak błędów. Gdyby `prisma generate` nie odświeżył typów, migracja nie została zastosowana.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma
git commit -m "feat(ipam): podsieci, adresy IP i przypisanie do aplikacji"
```

---

### Task 2: Warstwa CIDR

**Files:**
- Create: `apps/api/src/ipam/cidr.ts`
- Test: `apps/api/test/ipam-cidr.test.ts`

**Interfaces:**
- Consumes: brak.
- Produces: typ `Cidr` i funkcje używane przez Task 4 (DTO), Task 5 (kolizje) i Task 6 (adresy). Nazwy i podpisy poniżej są kontraktem — nie zmieniaj ich.

```ts
export type Cidr = {
  /** Adres sieciowy jako liczba 32-bitowa (10.20.0.0/16 → 0x0A140000). */
  network: number;
  /** Długość prefiksu 0–32. */
  prefix: number;
  /** Pierwszy adres w zakresie — równy `network`. */
  first: number;
  /** Adres rozgłoszeniowy, czyli ostatni w zakresie. */
  broadcast: number;
  /** Znormalizowany zapis sieci: "10.20.0.0/16". */
  text: string;
};

/** `null` dla złego formatu, IPv6 i adresu z ustawionymi bitami hosta. */
export function parseCidr(text: string): Cidr | null;
/** `true` dla "10.20.1.15", `false` dla "10.20.1" i "10.20.1.256". */
export function isValidIpv4(text: string): boolean;
export function ipToNumber(text: string): number | null;
/** 4294967295 → "255.255.255.255" */
export function numberToIp(value: number): string;
/** Czy `ip` leży w zakresie `cidr`. */
export function ipInCidr(ip: string, cidr: Cidr): boolean;
/** Czy zakres `child` w całości mieści się w `parent`. Równe zakresy → true. */
export function containsSubnet(child: Cidr, parent: Cidr): boolean;
/** Czy zakresy mają choć jeden wspólny adres. */
export function rangesOverlap(a: Cidr, b: Cidr): boolean;
/**
 * Podsieć zawierająca `ip` o **największym** prefiksie (najwęższa),
 * czyli null jeśli żadna nie zawiera. Przy remisie wygrywa pierwsza
 * w kolejności argumentu.
 */
export function findContainingSubnet(ip: string, subnets: Cidr[]): Cidr | null;
/** Sortuje po `network` rosnąco, a przy równych sieciach po `prefix` rosnąco. */
export function sortCidrs(list: Cidr[]): Cidr[];
/** Komunikat błędu dla DTO; `null` gdy `text` jest poprawnym CIDR. */
export function cidrErrorMessage(text: string): string | null;
```

- [ ] **Step 1: Napisz testy**

`apps/api/test/ipam-cidr.test.ts`, styl jak w `apps/api/test/eol-window.test.ts` (`strict as assert`, `describe`/`it` z `node:test`):

```ts
describe('parseCidr', () => {
  it('czytuje poprawną sieć', () => {
    const c = parseCidr('10.20.0.0/16');
    assert.equal(c?.text, '10.20.0.0/16');
    assert.equal(c?.broadcast, ipToNumber('10.20.255.255'));
  });
  it('odrzuca /33, bo IPv4 ma 32 bity', () => {
    assert.equal(parseCidr('10.20.0.0/33'), null);
  });
  it('odrzuca adres spoza zakresu oktetu', () => {
    assert.equal(parseCidr('999.1.1.1/8'), null);
  });
  it('odrzuca zapis bez prefiksu', () => {
    assert.equal(parseCidr('10.20.0.0'), null);
  });
  it('odrzuca adres z ustawionymi bitami hosta', () => {
    // Review Focus 1 — użytkownik pisze "10.20.1.5/24", a my
    // zapisalibyśmy "10.20.0.0/24". Cicho zamieniając adres na sieć,
    // pokazalibyśmy stan inny niż wpisany.
    assert.equal(parseCidr('10.20.1.5/24'), null);
  });
  it('odrzuca IPv6', () => {
    assert.equal(parseCidr('fd00::/8'), null);
  });
  it('liczy adres rozgłoszeniowy dla /30', () => {
    assert.equal(parseCidr('10.20.0.4/30')?.broadcast, ipToNumber('10.20.0.7'));
  });
  it('czytuje /0 i /32', () => {
    assert.equal(parseCidr('0.0.0.0/0')?.broadcast, ipToNumber('255.255.255.255'));
    assert.equal(parseCidr('10.20.0.1/32')?.broadcast, ipToNumber('10.20.0.1'));
  });
});

describe('containsSubnet', () => {
  it('równe zakresy zawierają się', () => assert.ok(containsSubnet(c('10.20.0.0/16'), c('10.20.0.0/16'))));
  it('węższy mieści się w szerszym', () => assert.ok(containsSubnet(c('10.20.5.0/24'), c('10.20.0.0/16'))));
  it('szerszy nie mieści się w węższym', () => assert.equal(containsSubnet(c('10.20.0.0/16'), c('10.20.5.0/24')), false));
  it('sąsiadujące podsieci nie zawierają się', () => assert.equal(containsSubnet(c('10.21.0.0/16'), c('10.20.0.0/16')), false));
});
```

Osobno `rangesOverlap` — graniczne pół-sieci **nakładają się**, choć żadna nie zawiera drugiej:

```ts
it('pół-sieci stykające się granicą nakładają się', () => {
  assert.equal(rangesOverlap(c('10.20.0.0/17'), c('10.20.128.0/17')), true);
});
it('podsieci obok siebie nie nakładają się', () => {
  assert.equal(rangesOverlap(c('10.20.0.0/16'), c('10.21.0.0/16')), false);
});
```

Kolizja w Task 5 opiera się na `rangesOverlap`, nie na `containsSubnet` — inaczej `10.20.5.0/24` przeszłoby obok `10.20.0.0/16`, a to ta sama podsieć opisana dwa razy.

Dalej: `findContainingSubnet` — przy `[10.20.0.0/16, 10.20.5.0/24]` i adresie `10.20.5.7` zwraca `10.20.5.0/24` (najwęższa wygrywa); przy adresie poza wszystkimi zwraca `null`. `sortCidrs` — `10.9.0.0/8` przed `10.10.0.0/8` (sortowanie numeryczne, nie leksykograficzne). `cidrErrorMessage` — nie `null` dla `10.20.1.5/24` i zawiera w tekście słowo „sieć”.

- [ ] **Step 2: Uruchom testy i zobacz, że padają**

Run: `npm run test --workspace @webinv/api 2>&1 | grep -i "ipam\|Cannot find"`
Expected: błąd `Cannot find module '../src/ipam/cidr'`.

- [ ] **Step 3: Napisz `cidr.ts`**

Implementacja: `ipToNumber` składa cztery oktety przez `parseInt` z bazą 10 i sprawdza zakres 0–255 (bez `parseInt(x, 16)` na ułamkach). `parseCidr` dzieli po `/`, wymaga dokładnie dwóch części i prefiksu `0–32`, liczy maskę jako `prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0`, sprawdza `(ip & ~mask) >>> 0 === network` i zwraca `null` przy nierówności. `rangesOverlap` to `a.first <= b.broadcast && b.first <= a.broadcast`. `sortCidrs` nie mutuje argumentu — zwraca nową tablicę. `cidrErrorMessage` zwraca po polsku, wymieniając powód.

- [ ] **Step 4: Uruchom testy**

Run: `npm run test --workspace @webinv/api`
Expected: PASS dla `ipam-cidr.test.ts`, reszta bez zmian.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ipam/cidr.ts apps/api/test/ipam-cidr.test.ts
git commit -m "feat(ipam): warstwa CIDR — walidacja i zawieranie zakresów"
```

---

### Task 3: Uprawnienia `ipam:read` i `ipam:write`

**Files:**
- Modify: `apps/api/src/auth/permissions.ts:8-50`
- Modify: `apps/web/src/types.ts` (blok `PERMISSIONS`, ok. 314–331)
- Test: `apps/api/test/ipam-permissions.test.ts`

**Interfaces:**
- Consumes: brak.
- Produces: uprawnienia `'ipam:read' | 'ipam:write'` w typie `Permission` po obu stronach (API i web) — Task 8 używa ich w dekoratorach, Task 10 w `NAV` i trasach.

- [ ] **Step 1: Napisz test**

`apps/api/test/ipam-permissions.test.ts` — sprawdza też, że `apps/web/src/types.ts` nie rozjechał się z API (wzorzec: `apps/api/test/helpers/repo.ts`, `read('apps/web/src/types.ts')`):

```ts
it('VIEWER czyta IPAM, ale go nie zmienia', () => {
  assert.equal(roleHasPermission('VIEWER', 'ipam:read'), true);
  assert.equal(roleHasPermission('VIEWER', 'ipam:write'), false);
});
it('ADMIN edytuje IPAM', () => {
  assert.equal(roleHasPermission('ADMIN', 'ipam:write'), true);
});
it('każde uprawnienie ipam jest na liście wszystkich', () => {
  for (const p of PERMISSIONS.VIEWER.concat(PERMISSIONS.ADMIN, PERMISSIONS.SUPER_ADMIN)) {
    assert.ok(ALL_PERMISSIONS.includes(p), `${p} poza ALL_PERMISSIONS`);
  }
});
it('interfejs zna te same uprawnienia co API', () => {
  // Lustrzana kopia w apps/web/src/types.ts — bez tego trasa `/ipam`
  // byłaby widoczna dla VIEWER, a bramka po stronie API odrzuciłaby zapis.
  const web = read('apps/web/src/types.ts');
  assert.match(web, /'ipam:read'/);
  assert.match(web, /'ipam:write'/);
});
```

- [ ] **Step 2: Uruchom i potwierdź błąd**

Run: `npm run test --workspace @webinv/api 2>&1 | grep -i "ipam-permissions"`
Expected: `'ipam:read'` nie istnieje w typie `Permission` — błąd TypeScript przy `roleHasPermission`.

- [ ] **Step 3: Dodaj uprawnienia po stronie API**

W `apps/api/src/auth/permissions.ts` dopisz `'ipam:read'` do `VIEWER`, `'ipam:read'` + `'ipam:write'` do `ADMIN`, oba do `SUPER_ADMIN`, oraz oba do `ALL_PERMISSIONS`. W komentarzu nad `SUPER_ADMIN` wspomnij, dlaczego IPAM nie idzie pod `settings:write`: adresy to dane operacyjne, nie konfiguracja systemu.

- [ ] **Step 4: Dodaj lustrzaną kopię po stronie weba**

W `apps/web/src/types.ts` w bloku `PERMISSIONS` dopisz te same dwa wpisy do tych samych trzech ról. Test z kroku 1 pilnuje, żeby obie strony się zgadzały.

- [ ] **Step 5: Uruchom testy**

Run: `npm run test --workspace @webinv/api && npm run typecheck --workspaces --if-present`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth/permissions.ts apps/web/src/types.ts apps/api/test/ipam-permissions.test.ts
git commit -m "feat(ipam): uprawnienia ipam:read i ipam:write"
```

---

### Task 4: DTO i walidacja ładunków

**Files:**
- Create: `apps/api/src/ipam/dto/ipam.dto.ts`
- Test: `apps/api/test/ipam-dto.test.ts`

**Interfaces:**
- Consumes: `cidrErrorMessage` z Task 2.
- Produces: klasy `CreateSubnetDto`, `UpdateSubnetDto`, `CreateAddressDto`, `UpdateAddressDto`, `SetApplicationIpAddressesDto`, oraz stała `IP_STATUSES`. Używane przez Task 5, 6, 7 i 8.

```ts
export const IP_STATUSES = ['FREE', 'IN_USE', 'DEPRECATED'] as const;

export class CreateSubnetDto {
  name: string;        // @IsString, @Matches(/\S/), @MaxLength(200)
  cidr: string;        // @IsString, @MaxLength(18), walidacja przez cidrErrorMessage
  description?: string; // @IsOptional, @IsString, @MaxLength(2000)
  color?: string;      // @IsOptional, @IsIn(KOLORY)
  vlan?: number;       // @IsOptional, @IsInt, @Min(1), @Max(4094)
  location?: string;   // @IsOptional, @IsString, @MaxLength(200)
}
export class UpdateSubnetDto extends PartialType(CreateSubnetDto) {}
export class CreateAddressDto {
  address: string;     // @IsString, @MaxLength(18)
  status?: (typeof IP_STATUSES)[number];
  description?: string;
}
export class UpdateAddressDto extends PartialType(CreateAddressDto) {}
export class SetApplicationIpAddressesDto {
  ipAddressIds: string[]; // @IsArray, @IsUUID('4', { each: true }), @ArrayMaxSize(100)
}
```

- [ ] **Step 1: Napisz testy**

`apps/api/test/ipam-dto.test.ts` — skopiuj helpers `check()` i `TRANSFORM_OPTIONS` z `apps/api/test/application-dto.test.ts` (te same opcje co `ValidationPipe` w `main.ts`; skommentuj tę zależność).

Przypadki: `CreateSubnetDto` przyjmuje `{ name: 'Sieć produkcyjna', cidr: '10.20.0.0/16' }` bez błędów; odrzuca pustą nazwę ze spacjami; odrzuca `cidr: '10.20.1.5/24'` (Review Focus 1) komunikatem zawierającym „sieć”; odrzuca `cidr` dłuższe niż 18 znaków; odrzuca `vlan: 0` i `vlan: 5000`; odrzuca `vlan: 'dziesięć'`; `CreateAddressDto` odrzuca `address: '10.20.0.999'` komunikatem zawierającym „adres IP"; `SetApplicationIpAddressesDto` odrzuca nie-UUID w liście, akceptuje pustą listę i odrzuca listę dłuższą niż 100.

- [ ] **Step 2: Uruchom i potwierdź błąd**

Run: `npm run test --workspace @webinv/api 2>&1 | grep -i "ipam-dto"`
Expected: `Cannot find module '../src/ipam/dto/ipam.dto'`.

- [ ] **Step 3: Napisz DTO**

Użyj własnych walidatorów z `class-validator` (`@IsString`, `@Matches`, `@MaxLength`, `@IsInt`, `@Min`, `@Max`, `@IsIn`, `@IsArray`, `@IsUUID`, `@ArrayMaxSize`, `@IsOptional`). Dla `cidr` i `address` dodaj walidator wywołujący `cidrErrorMessage` — komunikat ma być dokładnie tą wartością, żeby UI pokazało go wprost. `KOLORY` to istniejąca w projekcie lista kolorów statusów (sprawdź `apps/web/src/types.ts`); jeśli nie ma wspólnej stałej po stronie API, użyj `@Matches(/^[a-z]+$/)` — kolor i tak służy tylko do kafelka.

- [ ] **Step 4: Uruchom testy**

Run: `npm run test --workspace @webinv/api`
Expected: PASS dla `ipam-dto.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ipam/dto apps/api/test/ipam-dto.test.ts
git commit -m "feat(ipam): walidacja ładunków podsieci, adresów i przypisań"
```

---

### Task 5: Serwis — podsieci

**Files:**
- Create: `apps/api/src/ipam/ipam.port.ts`
- Create: `apps/api/src/ipam/ipam.service.ts` (część dotycząca podsieci)
- Test: `apps/api/test/ipam-service.test.ts`

**Interfaces:**
- Consumes: `Cidr`, `parseCidr`, `containsSubnet`, `rangesOverlap` (Task 2), DTO (Task 4).
- Produces: `IpamPort`, `IpamService` z metodami:

```ts
async listSubnets(): Promise<SubnetWithCounts[]>;              // { subnets, total }
async getSubnet(id: string): Promise<SubnetDetail>;
async createSubnet(dto: CreateSubnetDto, actor: AuthUser, ip?: string): Promise<SubnetDetail>;
async updateSubnet(id: string, dto: UpdateSubnetDto, actor: AuthUser, ip?: string): Promise<SubnetDetail>;
async removeSubnet(id: string, actor: AuthUser, ip?: string): Promise<void>;
```

Typy eksportowane przez `ipam.port.ts` (śliadką po `SettingsPort` — delegaty nazywane tak jak w Prismie, plus `audit.record` i `$transaction<T>(fn)`):

```ts
export type SubnetRow = { id: string; name: string; cidr: string; description: string | null; color: string; vlan: number | null; location: string | null; createdAt: Date; updatedAt: Date };
export type SubnetWithCounts = SubnetRow & { addressCount: number; applicationCount: number; freeCount: number };
export type SubnetDetail = SubnetRow & { addresses: IpAddressRow[] };
```

- [ ] **Step 1: Napisz testy na atrapie portu**

Wzorzec konstrukcji: `apps/api/test/settings-demo.test.ts` — funkcja pomocnicza `serwis(port)` rzutująca atrapę na `ConstructorParameters<typeof IpamService>[0]`, bo `PrismaService` w testach zastąpić nie da.

```ts
it('odrzuca podsieć nakładającą się na istniejącą', async () => {
  await assert.rejects(
    () => serwis(port({ podsieci: [subnet('10.20.0.0/16', 'Produkcja')] }))
      .createSubnet({ name: 'DMZ', cidr: '10.20.5.0/24' }, AKTOR),
    (e: Error & { response?: { message: string } }) => {
      // Nazwa kolidującej podsieci musi być w komunikacie — administrator
      // ma wiedzieć, którą podsieć powiększyć albo zmienić.
      assert.match(e.response?.message ?? '', /Produkcja/);
      return true;
    },
  );
});

it('dopuszcza podsieci rozłączne', async () => {
  await serwis(port({ podsieci: [subnet('10.20.0.0/16', 'A')] }))
    .createSubnet({ name: 'B', cidr: '10.30.0.0/16' }, AKTOR);
});
```

Dalej: `listSubnets` liczy adresy i przypisane aplikacje (atestuj trzy liczniki na atrapie); `createSubnet` odrzuca zły CIDR komunikatem z `cidrErrorMessage`; **`updateSubnet` na CIDR nieobejmującym istniejących adresów odrzuca całą zmianę i nic nie zapisuje** (Review Focus 2) — test sprawdza, że `subnet.update` nie został wywołany; `updateSubnet` odrzuca CIDR kolidujący z inną podsiecią; `getSubnet` na nieistniejącym UUID rzuca `NotFoundException`; `removeSubnet` kasuje kaskadowo (`subnet.delete`) i loguje jeden wpis do dziennika.

- [ ] **Step 2: Uruchom i potwierdź błąd**

Run: `npm run test --workspace @webinv/api 2>&1 | grep -i "ipam-service"`
Expected: `Cannot find module '../src/ipam/ipam.service'`.

- [ ] **Step 3: Napisz `ipam.port.ts`**

Typ `IpamPort` z delegatami `subnet`, `ipAddress`, `applicationIpAddress`, `application` (tylko `findFirst` — do walidacji istnienia aplikacji) i `audit`. Dodaj komentarz wyjaśniający, dlaczego port istnieje (jak w `SettingsPort`): testy nie podnoszą bazy, a nazwy delegatów muszą zgadzać się z nazwami modeli Prisma.

- [ ] **Step 4: Napisz część serwisu dotyczącą podsieci**

`IpamService` wstrzykuje `PrismaService` (rzutowany na `IpamPort`) i `AuditService`. Kolizje sprawdzaj przez pobranie **wszystkich** podsieci i `rangesOverlap` — nie przez zapytanie w SQL, bo i tak musisz je wczytać dla podsumowań, a baza nie ma indeksu na zakres.

Audyt: `entity: 'Subnet'`, `action` kolejno `'subnet.created'`, `'subnet.updated'`, `'subnet.deleted'`; zmiany przez `AuditService.diff(before, after, ['updatedAt', 'createdAt', 'addresses'])`, czyli dokładnie tak, jak robi to `ApplicationsService.update`.

Komunikaty po polsku: `'Podsieć nie istnieje.'`, `'Adres musi być adresem sieci, nie adresem hosta (np. 10.20.1.5/24).'`, przy kolizji `'Zakres koliduje z podsiecią „Produkcja" (10.20.0.0/16).'`.

- [ ] **Step 5: Uruchom testy**

Run: `npm run test --workspace @webinv/api`
Expected: PASS dla `ipam-service.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ipam/ipam.port.ts apps/api/src/ipam/ipam.service.ts apps/api/test/ipam-service.test.ts
git commit -m "feat(ipam): serwis podsieci z kontrolą nakładania zakresów"
```

---

### Task 6: Serwis — adresy IP

**Files:**
- Modify: `apps/api/src/ipam/ipam.port.ts` (dodać delegat `ipAddress` do kompletu)
- Modify: `apps/api/src/ipam/ipam.service.ts`
- Modify: `apps/api/test/ipam-service.test.ts`

**Interfaces:**
- Consumes: Task 2 (`ipInCidr`, `isValidIpv4`), Task 4 (`CreateAddressDto`, `UpdateAddressDto`), Task 5 (port, `IpamService`).
- Produces: `IpAddressRow` (eksport z `ipam.port.ts`) oraz metody:

```ts
async listAddresses(subnetId: string): Promise<{ addresses: IpAddressRow[]; total: number }>;
async createAddress(subnetId: string, dto: CreateAddressDto, actor: AuthUser, ip?: string): Promise<IpAddressRow>;
async updateAddress(id: string, dto: UpdateAddressDto, actor: AuthUser, ip?: string): Promise<IpAddressRow>;
async removeAddress(id: string, actor: AuthUser, ip?: string): Promise<void>;
async applicationsForAddress(id: string): Promise<{ id: string; name: string; url: string }[]>;
```

```ts
export type IpAddressStatus = 'FREE' | 'IN_USE' | 'DEPRECATED';
export type IpAddressRow = {
  id: string; subnetId: string; address: string;
  status: IpAddressStatus;
  description: string | null; lastSeenAt: Date | null;
  createdAt: Date; updatedAt: Date;
};
```

- [ ] **Step 1: Dopisz testy**

```ts
it('odrzuca adres spoza podsieci', async () => {
  await assert.rejects(
    () => serwis(port({ podsieci: [subnet('10.20.0.0/16')], ipAddresses: [] }))
      .createAddress(PODNET_ID, { address: '10.21.0.5' }, AKTOR),
    /poza zakresem/,
  );
});

it('odrzuca duplikat adresu w podsieci', async () => {
  await assert.rejects(
    () => serwis(port({ podsieci: [subnet('10.20.0.0/16')], ipAddresses: [adres('10.20.1.5')] }))
      .createAddress(PODNET_ID, { address: '10.20.1.5' }, AKTOR),
    (e: Error & { status?: number }) => {
      // Review Focus 4 — wyjątek z bazy (P2002) dałby 500 i komunikat
      // "Unique constraint failed" zamiast zdania dla człowieka.
      assert.equal(e.status, 409);
      return true;
    },
  );
});

it('odrzuca adres sieciowy i rozgłoszeniowy', async () => {
  // Ani 10.20.0.0/16 jako host, ani 10.20.255.255 — to adresy specjalne.
  await assert.rejects(() => serwis(p).createAddress(PODNET_ID, { address: '10.20.0.0' }, AKTOR));
  await assert.rejects(() => serwis(p).createAddress(PODNET_ID, { address: '10.20.255.255' }, AKTOR));
});
```

Dalej: `createAddress` ustawia `lastSeenAt` na `null` dla ręcznie dodanych adresów (nie był skanowany); `removeAddress` odmawia, gdy adres ma przypisania aplikacji (`ConflictException` z ich liczbą — inaczej użytkownik straciłby powiązanie bez ostrzeżenia); `applicationsForAddress` zwraca tylko aplikacje z `deletedAt: null`.

- [ ] **Step 2: Uruchom i potwierdź błąd**

Run: `npm run test --workspace @webinv/api 2>&1 | grep -i "ipam-service"`
Expected: błąd TypeScript — brak metod `createAddress`/`removeAddress`.

- [ ] **Step 3: Zaimplementuj metody**

Walidacja kolejności: `isValidIpv4` → `ipInCidr` → odrzucenie adresu sieciowego i rozgłoszeniowego (porównaj z `cidr.first` i `cidr.broadcast`, dopuszczając `/31` i `/32`, gdzie oba są adresami hosta) → sprawdzenie duplikatu. Wyjątek Prisma `P2002` mapuj na `ConflictException` komunikatem `'Adres 10.20.1.5 jest już zarejestrowany w tej podsieci.'`.

`removeAddress`: przed usunięciem policz przypisania; jeśli są, `ConflictException` — komunikat ma wymieniać liczbę i podpowiadać zdjęcie przypisania na karcie aplikacji. To świadoma decyzja: `onDelete: Cascade` i tak by posadziło `IN_USE` bez aplikacji, a dopiero kaskada by zniknęła razem z aplikacją.

- [ ] **Step 4: Uruchom testy**

Run: `npm run test --workspace @webinv/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ipam apps/api/test/ipam-service.test.ts
git commit -m "feat(ipam): serwis adresów IP z walidacją zawierania"
```

---

### Task 7: Przypisania aplikacja ↔ adres

**Files:**
- Modify: `apps/api/src/ipam/ipam.service.ts`
- Modify: `apps/api/test/ipam-service.test.ts`
- Create: `apps/api/test/ipam-app-delete.test.ts`
- Modify: `apps/api/src/applications/applications.service.ts:520-540` (metoda `remove`)

**Interfaces:**
- Consumes: Task 6 (`IpAddressRow`, `removeAddress` z kontrolą przypisań).
- Produces:

```ts
async getApplicationIpAddresses(appId: string): Promise<ApplicationIpAddressRef[]>;
async setApplicationIpAddresses(appId: string, dto: SetApplicationIpAddressesDto, actor: AuthUser, ip?: string): Promise<void>;
```

```ts
/** Adres widziany z perspektywy aplikacji — podsieć jest tu obiektem. */
export type ApplicationIpAddressRef = {
  id: string; address: string; status: IpAddressStatus;
  description: string | null;
  subnet: { id: string; name: string; cidr: string };
};
```

oraz eksport w `applications.service.ts`:

```ts
/**
 * Zdejmuje przypisania IP kasowanej aplikacji i odblokowuje adresy.
 * Wywoływane z `remove()` — patrz ipam-app-delete.test.ts.
 */
async releaseIpAddressesForApplication(appId: string): Promise<void>;
```

`IpamService` potrzebuje tej samej operacji dla `getApplicationIpAddresses`, więc żeby nie duplikować logiki, umieść ją w `IpamService`:

```ts
/** Zdejmuje przypisania aplikacji i odblokowuje adresy. Używa `remove()`. */
async releaseIpAddressesForApplication(appId: string): Promise<void>;
```

W `ApplicationsService.remove()` wstrzyknij `IpamService` (moduł eksportuje serwis, a `ApplicationsModule` musi wtedy zaimportować `IpamModule`). Jeśli wolisz nie tworzyć zależności `ApplicationsModule → IpamModule`, wykonaj zapytania przez własny `PrismaService` aplikacji — ale wtedy logika odblokowywania istnieje w dwóch miejscach i rozjedzie się. **Wybierz jedno; plan zakłada `IpamService`.**

- [ ] **Step 1: Napisz testy przypisań**

W `ipam-service.test.ts`: `setApplicationIpAddresses` z listą `['a','b']` tworzy dwa wiersze i loguje **jeden** wpis audytu `ip_addresses.update` (gdyby logował osobno każdy checkbox, dziennik zaśmiecałby się przy każdym zapisie formularza); pusta lista kasuje wszystkie przypisania; nieznane `ipAddressId` → `NotFoundException` wskazujący samo ID; przypisanie aplikacji nieistniejącej → `NotFoundException`; zestaw niezmieniony nie zapisuje nic (brak wywołań `deleteMany` i `createMany` na atrapze).

- [ ] **Step 2: Napisz `ipam-app-delete.test.ts` (Review Focus 3)**

Sprawdź na atrapie, że `remove()` w `ApplicationsService` po soft-delete: usuwa wiersze `applicationIpAddress` dla tej aplikacji i ustawia `status: 'FREE'` na ich adresach. Test ma ziałać na istniejącej konstrukcji `ApplicationsService` — jeśli ta klasa nie przyjmuje portu (a przyjmuje `PrismaService`), ogranicz test do asercji na wywołaniach atrapy przekazanej przez rzutowanie, tak jak robi to `settings-demo.test.ts`.

Kluczowa asercja: `status` wraca do `FREE` **również dla adresów, które miały więcej niż jedno przypisanie** — zbierz zbiór `ipAddressId` przed skasowaniem, a nie licz z wierszy, które właśnie zniknęły.

- [ ] **Step 3: Uruchom i potwierdź błąd**

Run: `npm run test --workspace @webinv/api 2>&1 | grep -i "ipam"`
Expected: brak `setApplicationIpAddresses` i brak zwalniania adresów w `remove()`.

- [ ] **Step 4: Zaimplementuj wymianę zestawu**

Całą różnicę policz w pamięci (dodaj/usuń), zapisz `deleteMany` + `createMany` w jednym `$transaction`. Nie polegaj na ponownym dopasowaniu podsieci — adresy przychodzą gotowe. Odczytane aplikacje filtruj `deletedAt: null`, żeby nie przywracać powiązań do usuniętych wpisów.

- [ ] **Step 5: Zaimplementuj zwalnianie adresów przy soft-delete aplikacji**

W `ApplicationsService.remove()`, po `data: { deletedAt: new Date() }`, wywołaj `releaseIpAddressesForApplication(id)`. W niej: `findMany` po `applicationId`, potem `updateMany` na `ipAddress` z `status: 'FREE'` dla ich identyfikatorów, potem `deleteMany`.

Kolejność jest tu zgubiona celowo: `findMany` musi być **przed** `deleteMany`, bo do odblokowania potrzebujemy identyfikatorów adresów z wierszy, które zaraz znikną. `updateMany` na `ipAddress` idzie przed `deleteMany` na `applicationIpAddress` — gdyby było odwrotnie, adresów nie dałoby się już odblokować.

Całość w jednej transakcji z samym soft-delete — inaczej aplikacja znika, a adresy zostają zablokowane, i nikt tego nie zauważy, dopóki ktoś nie spróbuje przypisać adresu do nowej aplikacji.

- [ ] **Step 6: Uruchom testy i typecheck**

Run: `npm run test --workspace @webinv/api && npm run typecheck --workspaces --if-present`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/ipam apps/api/src/applications/applications.service.ts apps/api/test
git commit -m "feat(ipam): przypisanie adresów do aplikacji i zwalnianie przy soft-delete"
```

---

### Task 8: Kontroller i moduł

**Files:**
- Create: `apps/api/src/ipam/ipam.controller.ts`
- Create: `apps/api/src/ipam/ipam.module.ts`
- Modify: `apps/api/src/app.module.ts:1-45`

**Interfaces:**
- Consumes: wszystkie metody `IpamService` (Tasky 5–7), uprawnienia (Task 3).
- Produces: trasy HTTP używane przez Task 9–11.

| Metoda | Ścieżka | Uprawnienie | Zwraca |
|---|---|---|---|
| GET | `/api/ipam/subnets` | `ipam:read` | `{ subnets, total }` |
| GET | `/api/ipam/subnets/:id` | `ipam:read` | `{ subnet }` |
| POST | `/api/ipam/subnets` | `ipam:write` | `{ subnet }` |
| PATCH | `/api/ipam/subnets/:id` | `ipam:write` | `{ subnet }` |
| DELETE | `/api/ipam/subnets/:id` | `ipam:write` | `{ ok: true }` |
| GET | `/api/ipam/subnets/:id/addresses` | `ipam:read` | `{ addresses, total }` |
| POST | `/api/ipam/subnets/:id/addresses` | `ipam:write` | `{ address }` |
| PATCH | `/api/ipam/addresses/:id` | `ipam:write` | `{ address }` |
| DELETE | `/api/ipam/addresses/:id` | `ipam:write` | `{ ok: true }` |
| GET | `/api/ipam/addresses/:id/applications` | `ipam:read` | `{ applications }` |
| GET | `/api/ipam/applications/:appId/ip-addresses` | `app:read` | `{ addresses }` |
| PUT | `/api/ipam/applications/:appId/ip-addresses` | `app:write` | `{ ok: true }` |

- [ ] **Step 1: Napisz kontroler**

`@Controller('api/ipam')`, metody w kolejności tras konkretnych przed `:id` (jak w `applications.controller.ts`, gdzie `'stats'` i `'environments'` stoją przed `':id'`). Wszystkie `@Param('id', ParseUUIDPipe)`, wstrzykiwanie `AuthUser` przez `@CurrentUser()` i adresu przez `@ClientIp()`. `@HttpCode(200)` na `DELETE` i `PUT`. **Żadna trasa nie jest `@Public()`** — Review Focus 5: gość nie ma w IPAM czego szukać.

Odpowiedzi w klamrach (`{ subnets, total }`, `{ address }`), zgodnie z konwencją `applications`.

- [ ] **Step 2: Napisz moduł i zarejestruj go**

`ipam.module.ts` jak `applications.module.ts` — `controllers: [IpamController]`, `providers: [IpamService]`, `exports: [IpamService]`. W `app.module.ts` dodaj import i `IpamModule` do `imports` (po `ApplicationsModule`, bo trasy aplikacji sięgają po serwis IPAM).

- [ ] **Step 3: Sprawdź, że serwis startuje**

Run: `npm run build --workspace @webinv/api && npm run typecheck --workspaces --if-present`
Expected: brak błędów.

- [ ] **Step 4: Sprawdź bramkę uprawnień**

Uruchom API (`npm run dev:api` z roota) i sprawdź dwoma żądaniami: `GET /api/ipam/subnets` bez sesji → **401**; z sesją VIEWER → **200**. Odpowiedź 401 zamiast 403 potwierdza, że bramka sesji działa przed bramką uprawnień.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ipam apps/api/src/app.module.ts
git commit -m "feat(ipam): kontroler i moduł tras /api/ipam"
```

---

### Task 9: Warstwa weba — typy i hooki

**Files:**
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/lib/queries.ts`

**Interfaces:**
- Consumes: kontrakty odpowiedzi z Task 8.
- Produces: typy `IpStatus`, `Subnet`, `SubnetWithCounts`, `IpAddress`, `ApplicationIpAddressRef` oraz hooki używane przez Task 10–11. Task 10 i 11 **nie** tworzą własnych zapytań — biorą te hooki.

```ts
export type IpStatus = 'FREE' | 'IN_USE' | 'DEPRECATED';
export interface Subnet { id: string; name: string; cidr: string; description: string | null; color: string; vlan: number | null; location: string | null; createdAt: string; updatedAt: string; }
export interface SubnetWithCounts extends Subnet { addressCount: number; applicationCount: number; freeCount: number; }
export interface IpAddress { id: string; subnetId: string; address: string; status: IpStatus; description: string | null; lastSeenAt: string | null; }
export interface ApplicationIpAddressRef { id: string; address: string; status: IpStatus; description: string | null; subnet: { id: string; name: string; cidr: string }; }
```

Hooki: `useSubnets()`, `useSubnet(id)`, `useSubnetAddresses(subnetId)`, `useCreateSubnet()`, `useUpdateSubnet(id)`, `useDeleteSubnet()`, `useCreateAddress(subnetId)`, `useUpdateAddress()`, `useDeleteAddress()`, `useApplicationIpAddresses(appId)`, `useSetApplicationIpAddresses(appId)`. Klucze w `qk`: `subnets`, `subnet(id)`, `subnetAddresses(id)`, `applicationIpAddresses(appId)`.

- [ ] **Step 1: Dodaj typy do `types.ts`**

Blok po istniejących typach aplikacji, z komentarzem odróżniającym `Subnet` (podsieć) od `Environment` (środowisko aplikacji) — nazwy brzmią podobnie i to realne źródło pomyłki.

- [ ] **Step 2: Dodaj klucze i hooki do `queries.ts`**

Klucze w istniejącym obiekcie `qk`. Hooki odczytowe z `staleTime: 30_000` (rzadko się zmieniają). Mutacje — wzorem `useUpdateApplication`: `onSuccess` unieważnia klucze dotkniętych encji. `useDeleteSubnet` po sukcesie unieważnia **wszystkie** klucze `['ipam']`, bo kasowanie kaskadowe zmienia również adresy w innych widokach.

- [ ] **Step 3: Sprawdź kompilację**

Run: `npm run typecheck --workspaces --if-present && npm run test:web-build`
Expected: brak błędów.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/types.ts apps/web/src/lib/queries.ts
git commit -m "feat(web): typy i hooki IPAM"
```

---

### Task 10: Strony IPAM

**Files:**
- Create: `apps/web/src/pages/IpamListPage.tsx`
- Create: `apps/web/src/pages/SubnetDetailPage.tsx`
- Create: `apps/web/src/pages/SubnetFormPage.tsx`
- Create: `apps/web/src/components/ipam/AddressTable.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/components/layout/AppLayout.tsx:29-34` (stała `NAV`)

**Interfaces:**
- Consumes: hooki z Task 9, `IconNetwork` dodany do `apps/web/src/components/ui/icons.tsx` (styl jak `IconUsers`).
- Produces: trasy, których używa Task 11 (linki z aplikacji do podsieci): `/ipam/:id`.

- [ ] **Step 1: Dodaj trasy i nawigację**

W `router.tsx`, wewnątrz gałęzi wymagającej `RequireAuth` (IPAM nie jest treścią publiczną), dodaj:

```
{ path: 'ipam', element: <IpamListPage /> }
{ path: 'ipam/nowa', element: <RequirePermission permission="ipam:write"><SubnetFormPage /></RequirePermission> }
{ path: 'ipam/:id', element: <SubnetDetailPage /> }
{ path: 'ipam/:id/edycja', element: <RequirePermission permission="ipam:write"><SubnetFormPage /></RequirePermission> }
```

Kolejność ma znaczenie: `ipam/nowa` musi stać przed `ipam/:id`, inaczej „nowa" zostanie zinterpretowane jako identyfikator.

W `NAV` dodaj `{ to: '/ipam', label: 'Adresy IP', icon: IconNetwork, permission: 'ipam:read', requiresAuth: true }` — przed `Użytkownicy`, żeby grupował się z zasobami, nie z narzędziami.

- [ ] **Step 2: Napisz `AddressTable`**

Komponent prezentacyjny bez wiedzy o domenie: propsy `{ addresses, onDelete?, showSubnet? }`, kolumny adres / status / opis / przypisane aplikacje / ostatni skan. `onDelete` opcjonalne — jego brak oznacza „brak akcji", dzięki czemu tabela działa i dla VIEWER, i dla admina bez osobnej wersji.

- [ ] **Step 3: Napisz `IpamListPage`**

Nagłówek `PageHeader` z trzema licznikami (podsieci, adresy, wolne) zsumowanymi z danych, nie z osobnego zapytania — inaczej liczniki rozjadą się z tabelą. Tabela podsieci; kliknięcie wiersza rozwija go i pokazuje adresy (`useSubnetAddresses`) bez nawigacji. Wiersz prowadzi też do `/ipam/:id`.

Przycisk dodania podsieci widoczny tylko przy `can(role, 'ipam:write')`.

- [ ] **Step 4: Napisz `SubnetDetailPage`**

`useParams` → `useSubnet(id)`, nagłówek z nazwą, CIDR, VLAN, opisem i liczbą adresów; pod spodem `AddressTable` z akcjami oraz formularz dodania pojedynczego adresu (tylko dla `ipam:write`). Użyj `EmptyState` przy braku adresów — wzorzzek jest już w aplikacji.

Potwierdzenie usunięcia podsieci (`Modal`, jak w `ApplicationDetailPage`) **musi pokazywać liczbę adresów i przypisań, które znikną razem z nią**. Usunięcie jest twarde i kaskadowe — bez tej informacji użytkownik kasuje coś, czego nie odwróci.

- [ ] **Step 5: Napisz `SubnetFormPage`**

Jeden komponent dla dodania i edycji: `useParams` → jeśli `id`, `useSubnet(id)` i wypełnij formularz. Walidacja CIDR po stronie klienta przez prosty regex (natychmiastowa informacja) — **prawdziwa walidacja jest na serwerze**, a komunikat z API pokazujesz wprost przez `extractError`. Wyjaśnij pod polem, że to adres **sieci**, nie hosta.

- [ ] **Step 6: Sprawdź kompilację i testy CSS**

Run: `npm run test --workspace @webinv/api && npm run test:web-build`
Expected: PASS — w szczególności `ui-class-syntax.test.ts` i `ui-contrast.test.ts`, które pilnują składni klas Tailwinda w nowych plikach.

- [ ] **Step 7: Sprawdź w przeglądarce**

Uruchom `npm run dev:api` i `npm run dev:web`, zaloguj się jako ADMIN: lista → dodanie podsieci → dodanie adresu → edycja → usunięcie. Powtórz jako VIEWER: przyciski edycji znikają, zakładka „Adresy IP" jest, wszystko czytelne.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): strony IPAM — lista podsieci, szczegóły, formularz"
```

---

### Task 11: Sekcja IP na karcie aplikacji

**Files:**
- Create: `apps/web/src/components/ipam/IpAddressPicker.tsx`
- Modify: `apps/web/src/pages/ApplicationDetailPage.tsx`
- Modify: `apps/web/src/pages/ApplicationFormPage.tsx`

**Interfaces:**
- Consumes: `useApplicationIpAddresses`, `useSetApplicationIpAddresses` (Task 9), `useSubnets` (Task 9).
- Produces: `IpAddressPicker` z propsami `{ value: string[]; onChange: (ids: string[]) => void }`.

- [ ] **Step 1: Napisz `IpAddressPicker`**

Wyszukiwarka po adresie i opisie, lista grupowana nagłówkami podsieci, checkboxy. Pokaż przy każdym adresie jego status i opis — administrator musi odróżnić wolny adres od przypisanego do innej aplikacji, zanim zaznaczy. Propsy sterują stanem; rodzic decyduje, kiedy zapisać.

- [ ] **Step 2: Dodaj sekcję do `ApplicationDetailPage`**

Nowa `<section className="card-section">` obok sekcji „Dostęp i wsparcie": nagłówek „Adresy IP", a pod nim albo lista przypisanych adresów z linkiem do podsieci (`/ipam/:id`), albo `EmptyState` „Brak przypisanych adresów".

Sekcja pokazuje się **wyłącznie gdy `app.deliveryType === 'SELF_HOSTED'`** — to ta sama reguła, którą plik już stosuje dla pozostałych pól usługowych. Gość nie zobaczy sekcji: `ApplicationDetailPage` ma wariant publiczny bez sesji, a `ipam:read` wymaga zalogowania.

- [ ] **Step 3: Dodaj pole do `ApplicationFormPage`**

Dla `SELF_HOSTED` pokaż `IpAddressPicker` z wartością z formularza. Zapis idzie tym samym `PATCH /applications/:id`, a przypisania lecą **osobnym** `PUT` po udanym zapisie aplikacji — kolejność ma znaczenie: przypisania do aplikacji, która jeszcze nie istnieje w bazie, zostałyby odrzucone przez klucz obcy.

Dlatego obsłuż porażkę drugiego kroku osobno: aplikacja jest już zapisana, więc pokaż ostrzeżenie („aplikacja zapisana, ale adresy nie"), nie kasuj wpisu.

- [ ] **Step 4: Sprawdź kompilację i przepływ**

Run: `npm run typecheck --workspaces --if-present && npm run test:web-build && npm run test --workspace @webinv/api`
Expected: PASS.

Sprawdzenie ręczne: aplikacja `SELF_HOSTED` → zaznacz dwa adresy → zapis → odśwież → sekcja pokazuje oba → usuń aplikację (soft delete) → wejdź w IPAM → adresy mają status `FREE` i nie wiszą przypisania do nieistniejącej aplikacji. To jest ręczna weryfikacja Review Focus 3 od strony interfejsu.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): przypisanie adresów IP do aplikacji self-hosted"
```

---

### Task 12: Dokumentacja

**Files:**
- Modify: `docs/API.md`
- Modify: `docs/BAZA-DANYCH.md`
- Modify: `docs/ARCHITEKTURA.md`

**Interfaces:**
- Consumes: wszystkie wcześniejsze taski.
- Produces: nic dla kodu.

- [ ] **Step 1: Opisz trasy w `docs/API.md`**

Tabela tras `/api/ipam/*` z uprawnieniami, w formacie jak istniejące sekcje tego pliku. Dopisz, że `PUT /api/ipam/applications/:appId/ip-addresses` wymienia cały zestaw.

- [ ] **Step 2: Opisz encje w `docs/BAZA-DANYCH.md`**

Trzy tabele i enum `IpStatus`, z wyjaśnieniem **dlaczego** `Subnet` nie ma soft-delete (kaskada) i dlaczego `status` siedzi na adresie, a nie na relacji.

- [ ] **Step 3: Opisz moduł w `docs/ARCHITEKTURA.md`**

Krótka sekcja o `ipam/` obok `applications/`, z jednym zdaniem dlaczego istnieje osobna warstwa `cidr.ts` (testowalność bez bazy) i osobny port `IpamPort`.

- [ ] **Step 4: Commit**

```bash
git add docs
git commit -m "docs(ipam): API, encje i moduł"
```

---

## Koniec planu

Po Task 12 działa kompletny katalog podsieci i adresów wraz z powiązaniem aplikacji. Następny plan — `docs/superpowers/plans/2026-10-11-nmap-import.md` — dodaje import z pliku `nmap -oX` i pole `lastSeenAt`, które już czeka w schemacie.