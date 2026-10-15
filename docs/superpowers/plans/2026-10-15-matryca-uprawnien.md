# Matryca uprawnień do aplikacji — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Moduł ewidencji osób mających dostęp do aplikacji (dane: imię, nazwisko, stanowisko, dział, e-mail; poziom dostępu per aplikacja) plus import tych osób z CSV np. z Google Workspace.

**Architecture:** Osobny moduł NestJS `access` w `apps/api/src/access/` rozmawiający z Prismą przez wąski port `AccessPort` (tak jak `IpamService` przez `IpamPort`), dzięki czemu cała logika daje się przetestować bez bazy. Frontend dostaje stronę „Uprawnienia" (katalog osób + macierz zbiorcza + eksport CSV) oraz sekcję w karcie aplikacji. Osoby z ewidencji nigdy nie stają się kontami `User`.

**Tech Stack:** NestJS 11 (Fastify), Prisma 6 + PostgreSQL, `class-validator`, React 19 + Vite + TanStack Query, testy `node:test` + `tsx`.

**Spec:** `/home/rafik/.opencode/plan/2026-10-15-matryca-uprawnien-design.md` (po wyjściu z trybu plan trafi do `docs/superpowers/specs/2026-10-15-matryca-uprawnien-design.md`).

## Global Constraints

- Testy API: `node:test` + `node:assert/strict`, uruchamiane przez `npm run test --workspace @webinv/api` (`tsx --test test/*.test.ts`). **Nie** Vitest, **nie** Jest — nie dodawaj zależności testowych.
- Frontend nie ma testów jednostkowych; jedynym testem jest `npm run test:web-build` (`tsc --noEmit && vite build`). Zgodności UI pilnują istniejące testy czytające źródła tekstowo (`helpers/repo.ts`, `helpers/web-sources.ts`).
- Każdy nowy uprawnienie w `apps/api/src/auth/permissions.ts` musi trafić równolegle do `ALL_PERMISSIONS` i do `PERMISSIONS` w `apps/web/src/types.ts` (pilnuje tego `settings-permissions.test.ts`).
- Komentarze w kodzie po polsku, w istniejącym stylu: najpierw *dlaczego*, potem *co*.
- Nazwy endpointów i tras po polsku bez diakrytyków: `/panel/uprawnienia` (`router.tsx`).
- Migracje Prisma w `apps/api/prisma/migrations/<znacznik>_<opis>/migration.sql`; po zmianie schematu zawsze `npm run prisma:generate`.
- Soft delete zamiast kasowania: osoby dezaktywujemy przez `isActive=false`, przypisania usuwamy (`DELETE`), aplikacje zwalniamy przez `deletedAt`.
- `install.sh` i `docker-compose.yml` bez zmian.

## Review Focus

1. **Ten sam e-mail z różnym zapisem** (`Jan.Kowalski@firma.pl` vs `jan.kowalski@firma.pl`) — kolumna `@db.Citext` unikalna złapie duplikat, ale `ConflictException` musi wskazać istniejący `personId`, inaczej administrator utworzy drugą osobę i nie zrozumie dlaczego odmówiono.
2. **Dodanie do macierzy osoby z `isActive=false`** — musi być odrzucone (400), inaczej ewidencja pokazuje dostęp osoby zdegradowanej; istniejące przypisania takiej osoby muszą zostać i być widoczne z ostrzeżeniem.
3. **`expiresOn` w przeszłości przy dodaniu** — API ma odrzucić (400), a nie przyjąć i pokazać „wygasł”; przy edycji ma przepuścić, bo porządkowanie danych jest legalne.
4. **CSV w Windows-1250 z BOM** — plik z eksportu polskiego klienta nie dekoduje się jako UTF-8 i gubi polskie znaki w nazwiskach, jeśli przeglądarka nie dostanie fallbacku `TextDecoder('windows-1250')`.
5. **Wiersz zduplikowany w tym samym pliku CSV** (ten sam e-mail dwa razy) — musi zostać oznaczony jako błąd, nie „ostatni wygrywa” po cichu.

---

## Struktura plików

**Tworzone:**
- `apps/api/src/access/access.port.ts` — wąski kontrakt Prisma dla modułu (atrapa w testach).
- `apps/api/src/access/access.service.ts` — cała logika: osoby, przypisania, macierz zbiorcza, reguły 1–5 ze specyfikacji.
- `apps/api/src/access/access.controller.ts` — 10 endpointów CRUD + macierz.
- `apps/api/src/access/access.module.ts` — provider `AccessService`, eksport.
- `apps/api/src/access/dto/access.dto.ts` — DTO walidowane.
- `apps/api/src/access/csv.ts` — parser CSV, auto-detekcja nagłówków, walidacja wierszy (bez Prisma).
- `apps/api/src/access/dto/import.dto.ts` — DTO `preview` / `apply` importu.
- `apps/web/src/pages/AccessPage.tsx` — „Uprawnienia": katalog osób + macierz zbiorcza + eksport CSV + przycisk importu.
- `apps/web/src/pages/PersonDetailPage.tsx` — dane osoby i jej przypisania (route `/panel/uprawnienia/osoby/:id`).
- `apps/web/src/components/access/ApplicationAccessSection.tsx` — sekcja matrycy w karcie aplikacji.
- `apps/web/src/components/access/PersonAccessModal.tsx` — dodanie osoby do aplikacji (z podpowiedzią duplikatu).
- `apps/web/src/components/access/ImportPersonsModal.tsx` — trzykrokowy import CSV.

**Modyfikowane:**
- `apps/api/prisma/schema.prisma` — `enum AccessLevel`, `model Person`, `model ApplicationAccess`.
- `apps/api/src/app.module.ts` — rejestracja `AccessModule`.
- `apps/api/src/auth/permissions.ts` — `access:read`, `access:write` dla `ADMIN` i `SUPER_ADMIN`.
- `apps/api/src/seed/seed.service.ts` (+ ewentualnie `seed/demo-persons.ts`) — 2–3 osoby demonstracyjne z przypisaniami.
- `apps/web/src/types.ts` — `PERMISSIONS`, typy `Person`, `ApplicationAccess`, `AccessLevel`, `AccessMatrixRow`, odpowiedzi importu.
- `apps/web/src/lib/queries.ts` — klucze i hooki modułu access.
- `apps/web/src/router.tsx`, `apps/web/src/components/layout/AppLayout.tsx` — trasa i pozycja menu.
- `apps/web/src/pages/ApplicationDetailPage.tsx` — osadzenie sekcji matrycy.
- `docs/BAZA-DANYCH.md`, `docs/API.md`, `docs/ARCHITEKTURA.md`, `README.md`.

**Testy (nowe):** `access-schema.test.ts`, `access-permissions.test.ts`, `access-service.test.ts`, `access-dto.test.ts`, `access-csv.test.ts`, `access-import.test.ts`, `access-web-parity.test.ts`.

---

### Task 1: Schemat bazy i migracja

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261015090000_persons_access/migration.sql`
- Test: `apps/api/test/access-schema.test.ts`

**Interfaces:**
- Produces: typy Prisma `AccessLevel` (`OWNER | ADMIN | USER | READ_ONLY`), `Person`, `ApplicationAccess`; unikalny `Person.email` typu `@db.Citext`; klucz `@@id([applicationId, personId])` w `ApplicationAccess`.

- [ ] **Step 1: Napisz test schematu czytający `schema.prisma` jako tekst**

```ts
/** Założenia modelu macierzy uprawnień — pilnane na tekście schematu. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { read } from './helpers/repo';

const schemat = read('apps', 'api', 'prisma', 'schema.prisma');

describe('Schemat: persons i application_access', () => {
  it('Person ma wymagane pola i unikalny e-mail', () => {
    const model = schemat.match(/model Person \{[\s\S]*?\n\}/)?.[0] ?? '';
    assert.match(model, /firstName\s+String/);
    assert.match(model, /lastName\s+String/);
    assert.match(model, /email\s+String\s+@unique @db\.Citext/);
    assert.match(model, /position\s+String\?/);
    assert.match(model, /department\s+String\?/);
    assert.match(model, /isActive\s+Boolean\s+@default\(true\)/);
  });

  it('ApplicationAccess jest kluczem złożonym z datami i uwagą', () => {
    const model = schemat.match(/model ApplicationAccess \{[\s\S]*?\n\}/)?.[0] ?? '';
    assert.match(model, /level\s+AccessLevel\s+@default\(USER\)/);
    assert.match(model, /expiresOn\s+DateTime\?/);
    assert.match(model, /note\s+String\?/);
    assert.match(model, /@@id\(\[applicationId, personId\]\)/);
    assert.equal((model.match(/onDelete: Cascade/g) ?? []).length, 2);
  });

  it('enum AccessLevel ma cztery wartości', () => {
    const e = schemat.match(/enum AccessLevel \{[\s\S]*?\n\}/)?.[0] ?? '';
    for (const v of ['OWNER', 'ADMIN', 'USER', 'READ_ONLY']) assert.match(e, new RegExp(v));
  });
});
```

- [ ] **Step 2: Uruchom test i potwierdź porażkę**

Run: `npm run test --workspace @webinv/api 2>&1 | grep access-schema`
Expected: FAIL — `model Person` nie istnieje w schemacie.

- [ ] **Step 3: Dopisz do `schema.prisma` enum i oba modele**

Dodaj `enum AccessLevel` obok innych enumów oraz `model Person` i `model ApplicationAccess` po `model Application`, dokładnie według sekcji 3 specyfikacji (pola, `@map`, `@@index([lastName])`, `@@index([personId])`, `@@index([expiresOn])`, `@@map("persons")` / `@@map("application_access")`). W `Application` dodaj relację:

```prisma
  accessGrants ApplicationAccess[] @relation("AppAccess")
```

i w `model ApplicationAccess` nazwane `application Application @relation("AppAccess", ...)`.

- [ ] **Step 4: Wygeneruj klienta i utwórz migrację**

Run: `npm run prisma:generate --workspace @webinv/api && cd apps/api && npx prisma migrate dev --name persons_access`
Expected: utworzony katalog migracji z `CREATE TYPE "AccessLevel"`, `CREATE TABLE "persons"`, `CREATE TABLE "application_access"`; `prisma generate` bez błędu.

Jeśli baza deweloperska nie działa, migrację odpisz ręcznie (ten sam SQL co wygenerowany) do `apps/api/prisma/migrations/20261015090000_persons_access/migration.sql` — nazwa migracji musi zaczynać się znacznikiem czasu, który nie koliduje z istniejącymi.

- [ ] **Step 5: Uruchom testy i typecheck**

Run: `npm run test --workspace @webinv/api && npm run typecheck --workspace @webinv/api`
Expected: PASS, zero błędów TypeScript.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma apps/api/test/access-schema.test.ts
git commit -m "feat(access): tabele osób i przypisań uprawnień"
```

---

### Task 2: Uprawnienia access:read / access:write

**Files:**
- Modify: `apps/api/src/auth/permissions.ts`, `apps/web/src/types.ts`
- Test: `apps/api/test/access-permissions.test.ts`

**Interfaces:**
- Produces: `Permission` z dodatkowymi `'access:read' | 'access:write'`; `roleHasPermission('ADMIN', 'access:write') === true`, `roleHasPermission('VIEWER', 'access:read') === false`.

- [ ] **Step 1: Napisz test uprawnień**

```ts
/** Uprawnienia matrycy — osobne od app:write, bo to dane osobowe. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ALL_PERMISSIONS, PERMISSIONS, roleHasPermission } from '../src/auth/permissions';
import { read } from './helpers/repo';
import { webPermissions } from './helpers/web-permissions';

describe('Uprawnienia access:read / access:write', () => {
  it('VIEWER nie widzi macierzy w ogóle', () => {
    assert.equal(roleHasPermission('VIEWER', 'access:read'), false);
    assert.equal(roleHasPermission('VIEWER', 'access:write'), false);
  });

  it('ADMIN czyta i edytuje macierz, SUPER_ADMIN też', () => {
    for (const rola of ['ADMIN', 'SUPER_ADMIN'] as const) {
      assert.equal(roleHasPermission(rola, 'access:read'), true);
      assert.equal(roleHasPermission(rola, 'access:write'), true);
    }
  });

  it('nowe uprawnienia są kompletne i widoczne po obu stronach', () => {
    const przyznane = [...PERMISSIONS.ADMIN, ...PERMISSIONS.SUPER_ADMIN];
    for (const p of przyznane) assert.ok(ALL_PERMISSIONS.includes(p), `${p} poza listą`);

    const web = webPermissions(read('apps', 'web', 'src', 'types.ts'));
    assert.ok(web, 'nie znaleziono PERMISSIONS w types.ts');
    for (const rola of ['ADMIN', 'SUPER_ADMIN']) {
      assert.ok(web[rola]!.includes('access:read'), `web ${rola} bez access:read`);
      assert.ok(web[rola]!.includes('access:write'), `web ${rola} bez access:write`);
    }
    assert.equal(web['VIEWER']!.includes('access:read'), false);
  });
});
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `npm run test --workspace @webinv/api 2>&1 | grep access-permissions`
Expected: FAIL — `roleHasPermission('ADMIN', 'access:read')` zwraca `false`.

- [ ] **Step 3: Dopisz uprawnienia w obu plikach**

W `apps/api/src/auth/permissions.ts` dopisz `'access:read'` i `'access:write'` do `ADMIN` i `SUPER_ADMIN` (w `ADMIN` obok `ipam:write`, w `SUPER_ADMIN` na końcu listy) oraz do stałej `ALL_PERMISSIONS`. Dokładnie te same wpisy, w tej samej kolejności, dodaj do `PERMISSIONS` w `apps/web/src/types.ts` — odbicie lustrzane, inaczej `settings-permissions.test.ts` zgłosi rozjazd ról.

- [ ] **Step 4: Uruchom testy (także istniejące testy parzystości)**

Run: `npm run test --workspace @webinv/api`
Expected: PASS, w tym `settings-permissions.test.ts` i `ipam-permissions.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/permissions.ts apps/web/src/types.ts apps/api/test/access-permissions.test.ts
git commit -m "feat(access): uprawnienia access:read i access:write"
```

---

### Task 3: Port i serwis osób (katalog)

**Files:**
- Create: `apps/api/src/access/access.port.ts`, `apps/api/src/access/access.service.ts`
- Test: `apps/api/test/access-service.test.ts`

**Interfaces:**
- Produces:
  - `access.port.ts`: typy `AccessLevelName = 'OWNER' | 'ADMIN' | 'USER' | 'READ_ONLY'`, `PersonRow`, `ApplicationAccessRow`, `ApplicationRefRow`, oraz interfejs `AccessPort` z delegatami `person`, `applicationAccess`, `application` — podzbiór Prisma używany przez serwis (`findMany`, `findFirst`, `findUnique`, `create`, `update`, `count`, `delete`, `upsert` dla `person`).
  - `access.service.ts`: `class AccessService` z `constructor(private readonly prisma: AccessPort, private readonly audit: AuditLike)`, gdzie `AuditLike` to minimum `record(entry): Promise<void>`; metody:
    - `listPersons(filters: { search?: string; department?: string; includeInactive?: boolean }): Promise<PersonWithCounts[]>`
    - `getPerson(id: string): Promise<PersonDetail>`
    - `createPerson(dto: CreatePersonInput, actor: AuthUser, ip?: string): Promise<PersonRow>`
    - `updatePerson(id: string, dto: UpdatePersonInput, actor: AuthUser, ip?: string): Promise<PersonRow>`
    - `deactivatePerson(id: string, actor: AuthUser, ip?: string): Promise<PersonRow>`

- [ ] **Step 1: Napisz test serwisu na atrapie portu**

```ts
/** Katalog osób — reguły złotego eksportu `email` i braku kasowania. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AccessService } from '../src/access/access.service';
import type { AccessPort, PersonRow } from '../src/access/access.port';

function atrapa(overrides: Partial<AccessPort> = {}) {
  const osoby: PersonRow[] = [];
  const port = {
    person: {
      findMany: async () => osoby,
      findFirst: async (a: any) => osoby.find((p) => p.email === a?.where?.email) ?? null,
      findUnique: async (a: any) => osoby.find((p) => p.id === a?.where?.id) ?? null,
      create: async (a: any) => { const p = { id: randomUUID(), isActive: true, createdAt: new Date(), updatedAt: new Date(), ...a.data }; osoby.push(p); return p; },
      update: async (a: any) => { const i = osoby.findIndex((p) => p.id === a.where.id); osoby[i] = { ...osoby[i]!, ...a.data }; return osoby[i]!; },
      count: async () => osoby.length,
    },
    applicationAccess: {},
    application: {},
  } as unknown as AccessPort;
  return { port, osoby, ...overrides };
}
const audit = { record: async () => undefined } as any;
const actor = { id: randomUUID(), username: 'admin', email: 'a@f.pl', fullName: 'A B', role: 'ADMIN', mustChangePassword: false };

describe('AccessService — katalog osób', () => {
  it('tworzy osobę z rozdzielonym imieniem i nazwiskiem', async () => {
    const { port } = atrapa();
    const s = new AccessService(port, audit);
    const osoba = await s.createPerson(
      { firstName: 'Jan', lastName: 'Kowalski', email: 'jan.kowalski@firma.pl', position: 'Analityk', department: 'IT' },
      actor,
    );
    assert.equal(osoba.firstName, 'Jan');
    assert.equal(osoba.email, 'jan.kowalski@firma.pl');
  });

  it('odrzuca duplikat e-maila wskazując istniejącą osobę', async () => {
    const { port } = atrapa();
    const s = new AccessService(port, audit);
    const pierwsza = await s.createPerson({ firstName: 'Jan', lastName: 'Kowalski', email: 'jan.kowalski@firma.pl' }, actor);
    await assert.rejects(
      () => s.createPerson({ firstName: 'Jan', lastName: 'K.', email: 'JAN.KOWALSKI@firma.pl' }, actor),
      (e: any) => e instanceof ConflictException && e.getResponse().message.includes(pierwsza.id),
    );
  });

  it('dezaktywacja nie kasuje osoby ani jej przypisań', async () => {
    const { port, osoby } = atrapa();
    const s = new AccessService(port, audit);
    const osoba = await s.createPerson({ firstName: 'Ewa', lastName: 'Nowak', email: 'e.n@firma.pl' }, actor);
    const po = await s.deactivatePerson(osoba.id, actor);
    assert.equal(po.isActive, false);
    assert.equal(osoby.length, 1, 'osoba musi zostać w katalogu');
  });

  it('nie pozwala zdegradować własnego wpisu do nieaktywnego', async () => {
    const { port } = atrapa();
    const s = new AccessService(port, audit);
    await assert.rejects(() => s.updatePerson(randomUUID(), { firstName: 'X' }, actor), NotFoundException);
  });
});
```

Dopisz w tym samym pliku przypadki: `createPerson` rzuca `BadRequestException` dla pustego `firstName`/`lastName` i dla e-maila zawierającego spacje; `updatePerson` zapisuje tylko przekazane pola (`position: undefined` nie nadpisuje istniejącej wartości).

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `npx tsx --test test/access-service.test.ts --workspace @webinv/api` (z katalogu `apps/api`: `npx tsx --test test/access-service.test.ts`)
Expected: FAIL — modułu `../src/access/access.service` nie ma.

- [ ] **Step 3: Napisz `access.port.ts`**

Kopia wzorca z `apps/api/src/ipam/ipam.port.ts`: typy wierszy jako osobne `export type`, delegaty nazwane tak jak modele Prisma (`person`, `applicationAccess`, `application`), metody podpisane parametrami Prisma-kompatybilnymi (`where`, `data`, `select`, `orderBy`) i typem zwracanym `Promise<PersonRow[]>`. `AccessLevelName` definiuj lokalnie, bez importu z `@prisma/client` — port ma być kontraktem czytelnym bez wygenerowanego klienta.

- [ ] **Step 4: Napisz `access.service.ts` z metodami katalogu**

Kolejność walidacji w `createPerson`: obecność i długość `firstName`/`lastName` (1–100), `email` niepusty i bez spacji, `position`/`department` maks 150 znaków, `note` nie dotyczy. Potem `prisma.person.findFirst({ where: { email } })`; trafienie → `ConflictException` z tekstem zawierającym `id` istniejącej osoby (reguła 1 specyfikacji, i punkt 1 Review Focus). `updatePerson` buduje obiekt `data` tylko z kluczy obecnych w `dto` (wzorzec `users.service.ts`). `deactivatePerson` ustawia `isActive=false` i nie woła `delete`. `listPersons` ma białą listę sortowania (`lastName`, `department`, `createdAt`) — nazwa pola spoza listy ma być ignorowana, nie przepuszczana do `orderBy`.

- [ ] **Step 5: Uruchom testy i typecheck**

Run: `npm run test --workspace @webinv/api && npm run typecheck --workspace @webinv/api`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/access/access.port.ts apps/api/src/access/access.service.ts apps/api/test/access-service.test.ts
git commit -m "feat(access): katalog osób z e-mailem jako kluczem"
```

---

### Task 4: Macierz uprawnień i endpointy

**Files:**
- Modify: `apps/api/src/access/access.service.ts`, `apps/api/src/app.module.ts`
- Create: `apps/api/src/access/access.controller.ts`, `apps/api/src/access/access.module.ts`, `apps/api/src/access/dto/access.dto.ts`, `apps/api/test/access-dto.test.ts`, `apps/api/test/access-controller.test.ts`
- Test: `apps/api/test/access-service.test.ts` (dopisać przypadki macierzy)

**Interfaces:**
- Produces:
  - `AccessService.listApplicationAccess(applicationId: string): Promise<GrantRow[]>`
  - `AccessService.grantAccess(applicationId: string, dto: GrantAccessInput, actor: AuthUser, ip?: string): Promise<GrantRow>`
  - `AccessService.updateGrant(applicationId: string, personId: string, dto: UpdateGrantInput, actor: AuthUser, ip?: string): Promise<GrantRow>`
  - `AccessService.revokeGrant(applicationId: string, personId: string, actor: AuthUser, ip?: string): Promise<void>`
  - `AccessService.matrix(filters: { applicationId?: string; department?: string; personId?: string; level?: AccessLevelName }): Promise<MatrixRow[]>`, gdzie `MatrixRow = { application: { id: string; name: string }; person: { id: string; firstName: string; lastName: string; email: string; position: string | null; department: string | null; isActive: boolean }; level: AccessLevelName; grantedOn: string; expiresOn: string | null; note: string | null }` (daty jako `YYYY-MM-DD`).
  - Kontroler: trasy z tabeli w sekcji 4 specyfikacji, `access:read` na GET, `access:write` na zapis.

- [ ] **Step 1: Napisz testy macierzy (dopisz do `access-service.test.ts`)**

```ts
describe('AccessService — macierz', () => {
  it('dodanie osoby do aplikacji tworzy przypisanie i odrzuca duplikat w tej samej aplikacji', async () => { /* atrapa applicationAccess z findUnique/create */ });
  it('nieaktywnej osoby nie da się dodać', async () => { /* BadRequestException */ });
  it('expiresOn w przeszłości odrzucone przy dodaniu, przyjęte przy edycji', async () => { /* dwa przypadki */ });
  it('macierz filtruje po dziale i poziomie oraz nie gubi wygasłych', async () => { /* filtr applicationId/personId przekładane na where */ });
  it('usunięcie przypisania nie usuwa osoby z katalogu', async () => { /* revokeGrant woła tylko applicationAccess.delete */ });
});
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: z `apps/api`: `npx tsx --test test/access-service.test.ts`
Expected: FAIL — brak `grantAccess`.

- [ ] **Step 3: Dopisz metody macierzy do `AccessService`**

Kolejność w `grantAccess`: sprawdź, czy aplikacja istnieje i nie jest usunięta (`deletedAt: null`), potem znajdź lub utwórz osobę po e-mailu, potem sprawdź `isActive` (nieaktywna → `BadRequestException`, reguła 3), potem sprawdź duplikat w tej aplikacji (istnieje → `ConflictException`, reguła 2) i dopiero na końcu sprawdź `expiresOn` w przeszłości (reguła 4). W tej kolejności komunikaty są zrozumiałe, a baza nie dostaje śmieciowego wiersza.

- [ ] **Step 4: Napisz `dto/access.dto.ts`**

`CreatePersonDto`, `UpdatePersonDto`, `GrantAccessDto` (e-mail + opcjonalne dane osoby + `level` + `expiresOn` + `note`), `UpdateGrantDto` (`level?`, `expiresOn?`, `note?`). Walidatory zgodne z `auth/dto/auth.dto.ts`: `@IsEmail`, `@MinLength(1)`, `@MaxLength`, `@IsOptional`, `@IsDateString` dla dat, `@Matches(/^(OWNER|ADMIN|USER|READ_ONLY)$/)` dla poziomu, `@MaxLength(2000)` dla `note`.

- [ ] **Step 5: Napisz test DTO**

```ts
/** DTO macierzy — poziom spoza enumu i domena daty muszą być odrzucone. */
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
// assert: GrantAccessDto z level 'GUEST' → błąd; expiresOn '31-12-2026' → błąd;
// firstName '' → błąd; note dłuższe niż 2000 → błąd; poprawny obiekt → zero błędów.
```

- [ ] **Step 6: Napisz `access.controller.ts` i `access.module.ts`, zarejestruj w `app.module.ts`**

Kontroler z `@Controller('api/access')`, `@UseGuards` nie dodawaj — globalny `AuthGuard` z `main.ts`/`app.module.ts` już pilnuje; wystarczą `@RequirePermission('access:read'|'access:write')` i wstrzyknięcie `AccessService`. Ścieżki zgodne z tabelą w sekcji 4 specyfikacji; `ParseUUIDPipe` na wszystkich `:id` i `:applicationId`.

- [ ] **Step 7: Napisz test kontrolera czytający źródło tekstowo**

```ts
/** Każda trasa macierzy musi mieć jawne uprawnienie — brak @RequirePermission
 *  oznaczałby dostęp dla VIEWER, bo guard sprawdza tylko to, co jest zapisane. */
import { read } from './helpers/repo';
const zrodlo = read('apps', 'api', 'src', 'access', 'access.controller.ts');
// dla każdej z 12 tras: asercja, że nazwa trasy występuje w bloku zawierającym
// @RequirePermission('access:read') albo ('access:write')
```

- [ ] **Step 8: Uruchom testy i typecheck**

Run: `npm run test --workspace @webinv/api && npm run typecheck --workspace @webinv/api`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/access apps/api/src/app.module.ts apps/api/test
git commit -m "feat(access): macierz uprawnień i endpointy modułu access"
```

---

### Task 5: Dziennik zdarzeń

**Files:**
- Modify: `apps/api/src/access/access.service.ts`, `apps/web/src/lib/audit-fields.ts`
- Test: `apps/api/test/access-service.test.ts`

**Interfaces:**
- Produces: wpisy audytu o `action` ∈ `access.granted`, `access.updated`, `access.revoked`, `person.created`, `person.updated`, `person.deactivated`, `entity` ∈ `ApplicationAccess`, `Person`; etykiety pól w `apps/web/src/lib/audit-fields.ts` dla `level`, `expiresOn`, `grantedOn`, `note`, `firstName`, `lastName`, `position`, `department`, `isActive`.

- [ ] **Step 1: Napisz test audytu**

Atrapa `audit.record` zbiera wpisy; po `grantAccess` oczekujemy dokładnie jednego wpisu z `action: 'access.granted'` i `changes` zawierającym `{ level: { from: null, to: 'USER' } }` oraz przy pierwszym nadaniu `{ person: { from: null, to: 'Jan Kowalski (IT)' } }`. Po `revokeGrant` — `access.revoked` z `person.to === null`. Po `deactivatePerson` — `person.deactivated` z `isActive`.

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: z `apps/api`: `npx tsx --test test/access-service.test.ts`
Expected: FAIL — brak wpisów w `audit.record`.

- [ ] **Step 3: Dopisz wywołania `this.audit.record(...)`**

Wzorzec z `users.service.ts`: `action`, `entity`, `entityId`, `actorId: actor.id`, `actorName: actor.username`, `ip`, a różnice przez `AuditService.diff( przed, po, ['updatedAt', 'createdAt'] )`. `await` musi być jawne (w kodzie jest komentarz, dlaczego — powtórz go).

- [ ] **Step 4: Dodaj etykiety pól w `apps/web/src/lib/audit-fields.ts`**

Wpisy po polsku, np. `level: 'Poziom dostępu'`, `expiresOn: 'Wygasa'`, `firstName: 'Imię'`, `department: 'Dział'`. Bez etykiety dziennik pokazałby surowe nazwy kolumn.

- [ ] **Step 5: Uruchom testy i typecheck**

Run: `npm run test --workspace @webinv/api && npm run typecheck --workspace @webinv/api`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/access/access.service.ts apps/web/src/lib/audit-fields.ts apps/api/test/access-service.test.ts
git commit -m "feat(access): zdarzenia dziennika dla macierzy i osób"
```

---

### Task 6: Parser CSV i auto-detekcja kolumn

**Files:**
- Create: `apps/api/src/access/csv.ts`
- Test: `apps/api/test/access-csv.test.ts`

**Interfaces:**
- Produces:
  - `MAX_CSV_BYTES = 2 * 1024 * 1024`, `MAX_PERSON_ROWS = 2000`
  - `type PersonField = 'email' | 'firstName' | 'lastName' | 'position' | 'department' | 'isActive'`
  - `type HeaderMapping = Record<PersonField, string>` (nazwa kolumny z pliku)
  - `parseCsv(text: string): { header: string[]; rows: string[][] }` — obsługuje cudzysłowy, `"` wewnątrz pól, `,` i `;`, zjada BOM
  - `detectMapping(header: string[]): HeaderMapping` — rozpoznaje nagłówki polskie i angielskie
  - `class CsvError extends Error`
  - `parsePersonsCsv(text: string, mapping?: HeaderMapping): { rows: ParsedPersonRow[]; mapping: HeaderMapping; unmapped: string[] }`, gdzie `ParsedPersonRow = { line: number; email: string; firstName: string; lastName: string; position: string | null; department: string | null; isActive: boolean; errors: string[] }`
  - `PERSON_ROW_ERRORS` — lista kodów powodów (`MISSING_EMAIL`, `INVALID_EMAIL`, `MISSING_FIRST_NAME`, `MISSING_LAST_NAME`, `TOO_MANY_ROWS`, `FILE_TOO_LARGE`, `DUPLICATE_IN_FILE`, `NO_HEADER`).

- [ ] **Step 1: Napisz testy parsera**

```ts
/** Parser CSV — wejście z eksportu Workspace, nie z idealnego świata. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { detectMapping, parseCsv, parsePersonsCsv, CsvError } from '../src/access/csv';

it('rozcina pola w cudzysłowach z przecinkiem w środku', () => {
  const { rows } = parseCsv('email;firstName\r\njan@f.pl;"Kowalski, Jan"\r\n');
  assert.deepEqual(rows[0], ['Kowalski, Jan']);
});

it('rozpoznaje nagłówki angielskie Google Workspace', () => {
  const m = detectMapping(['Email', 'First name', 'Last name', 'Department', 'Job title', 'Suspended']);
  assert.deepEqual(m, { email: 'Email', firstName: 'First name', lastName: 'Last name', department: 'Department', position: 'Job title', isActive: 'Suspended' });
});

it('zawieszenie w Workspace wyłącza osobę', () => {
  const { rows } = parsePersonsCsv('Email,First name,Last name,Suspended\na@f.pl,Jan,Kowalski,true\n');
  assert.equal(rows[0]!.isActive, false);
});

it('ten sam e-mail dwa razy w pliku jest błędem', () => {
  const { rows } = parsePersonsCsv('Email,First name,Last name\na@f.pl,Jan,Kowalski\na@f.pl,Jan,Kowalski\n');
  assert.deepEqual(rows[1]!.errors, ['DUPLICATE_IN_FILE']);
});

it('plik większy niż limit i ponad 2000 wierszy są odrzucane', () => { /* MAX_CSV_BYTES, MAX_PERSON_ROWS */ });
it('brak kolumny email daje błąd każdego wiersza zamiast cichego pominięcia', () => { /* MISSING_EMAIL */ });
```

Dopisz przypadki: BOM na początku pliku, separator `;` z kodowaniem użytym tylko jako bajty (parser dostaje tekst po dekodowaniu), `''` i biały znak jako puste pole, wiersz krótszy niż nagłówek (brakujące pola → `MISSING_*`).

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: z `apps/api`: `npx tsx --test test/access-csv.test.ts`
Expected: FAIL — modułu `../src/access/csv` nie ma.

- [ ] **Step 3: Napisz `csv.ts`**

Parser wiersz po wierszu, stan `wCudzyslowie` i `poprzedniZnakEscapowany`, wykrywanie separatora z pierwszego wiersza nagłówkowego (większa liczba wystąpień `,` albo `;`). Auto-detekcja: słownik aliasów na małe litery bez diakrytyków, np. `email`, `e-mail`, `adres e-mail`, `login`, `first name`, `firstname`, `imię`, `last name`, `nazwisko`, `department`, `dział`, `job title`, `stanowisko`, `position`, `suspended`, `archived`, `nieaktywny`, `status`. `isActive` interpretuj: `true/yes/aktywny/aktywne/` (puste) → `true`; `false/no/suspended/archived/nieaktywny/zawieszony` → `false`.

- [ ] **Step 4: Uruchom testy i typecheck**

Run: `npm run test --workspace @webinv/api && npm run typecheck --workspace @webinv/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/access/csv.ts apps/api/test/access-csv.test.ts
git commit -m "feat(access): parser CSV z auto-detekcją kolumn"
```

---

### Task 7: Import osób — preview i apply

**Files:**
- Create: `apps/api/src/access/dto/import.dto.ts`
- Modify: `apps/api/src/access/access.service.ts`
- Test: `apps/api/test/access-import.test.ts`

**Interfaces:**
- Produces:
  - `AccessService.previewPersonsImport(text: string, mapping?: HeaderMapping): Promise<ImportPreviewResult>` z `ImportPreviewResult = { mapping: HeaderMapping; unmapped: string[]; rows: Array<ParsedPersonRow & { status: 'NEW' | 'UPDATE' | 'ERROR'; existingPersonId: string | null }>; summary: { total: number; create: number; update: number; invalid: number } }`
  - `AccessService.applyPersonsImport(rows: ImportRowInput[], actor: AuthUser, ip?: string): Promise<{ created: number; updated: number; skipped: number }>` — `ImportRowInput = { email: string; firstName: string; lastName: string; position?: string; department?: string; isActive?: boolean }`
  - Audit: dokładnie jeden wpis `person.imported` z `changes: { created: { from: null, to: N }, updated: { from: null, to: M }, skipped: { from: null, to: K } }`.

- [ ] **Step 1: Napisz testy importu**

```ts
/** Import CSV — podgląd klasyfikuje, zapis waliduje ponownie. */
import { AccessService } from '../src/access/access.service';
import { MAX_PERSON_ROWS } from '../src/access/csv';

it('podgląd oznacza istniejący e-mail jako UPDATE, a nowy jako NEW', async () => { /* atrapa person.findFirst */ });
it('apply aktualizuje istniejącą osobę i nie dezaktywuje osób spoza pliku', async () => {
  const { port, osoby } = atrapa();
  const s = new AccessService(port, audit);
  await s.createPerson({ firstName: 'Anna', lastName: 'Zalewska', email: 'a.z@firma.pl' }, actor);
  await s.createPerson({ firstName: 'Biały', lastName: 'Wtorek', email: 'b.w@firma.pl' }, actor);
  const wynik = await s.applyPersonsImport(
    [{ email: 'a.z@firma.pl', firstName: 'Anna', lastName: 'Zalewska-Kowalska' }], actor,
  );
  assert.deepEqual(wynik, { created: 0, updated: 1, skipped: 0 });
  assert.equal(osoby.find((p) => p.email === 'b.w@firma.pl')!.isActive, true);
});
it('apply odrzuca wiersz z błędnym e-mailem, mimo że przeszedł w podglądzie', async () => {
  await assert.rejects(() => s.applyPersonsImport([{ email: 'nie-e-mail', firstName: 'A', lastName: 'B' }], actor), BadRequestException);
});
it('plik powyżej MAX_PERSON_ROWS wierszy jest odrzucany w preview', async () => { /* assert.rejects(..., CsvError) */ });
it('import zapisuje dokładnie jeden wpis person.imported', async () => { /* licznik audit */ });
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: z `apps/api`: `npx tsx --test test/access-import.test.ts`
Expected: FAIL — brak `previewPersonsImport`.

- [ ] **Step 3: Dopisz DTO `import.dto.ts`**

`PreviewPersonsImportDto` (`@IsString() @MaxLength(MAX_CSV_BYTES)` `csv`, `@IsOptional()` `mapping` opisane walidatorem na klucze `email|firstName|lastName|position|department|isActive`), `ApplyPersonsImportDto` (`@IsArray() @ArrayMaxSize(MAX_PERSON_ROWS) @ValidateNested({ each: true })` wiersze z `@IsEmail`, `@MinLength(1)`, `@MaxLength`).

- [ ] **Step 4: Dopisz metody importu do `AccessService`**

`previewPersonsImport` wywołuje `parsePersonsCsv`, rzuca `BadRequestException` z komunikatem `CsvError.message`, a dla każdego wiersza bez błędów sprawdza `person.findFirst({ where: { email } })` i ustawia `status` oraz `existingPersonId`. `applyPersonsImport` **nie ufa** danym z podglądu: ponownie waliduje każdy wiersz (ten sam kod walidacji co w katalogu, wydzielony do wspólnej funkcji), pomija wiersze z błędami do `skipped`, tworzy nowe osoby przez `person.create` i aktualizuje istniejące przez `person.update` (nadpisując `firstName`, `lastName`, `position`, `department`, `isActive` tylko gdy pole podano). Całość w `prisma.$transaction` tylko jeśli port na to pozwala; jeśli nie — sekwencyjnie, z audytem na końcu.

- [ ] **Step 5: Dodaj dwa endpointy w `access.controller.ts`**

`POST /api/access/import/preview` i `POST /api/access/import/apply`, oba `@RequirePermission('access:write')`, oba z przekazaniem `actor`, `ip`, `userAgent` do serwisu (jak `users.controller.ts`).

- [ ] **Step 6: Uruchom testy i typecheck**

Run: `npm run test --workspace @webinv/api && npm run typecheck --workspace @webinv/api`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/access apps/api/test/access-import.test.ts
git commit -m "feat(access): import osób z CSV z podglądem"
```

---

### Task 8: Warstwa klienta w frontendzie

**Files:**
- Modify: `apps/web/src/types.ts`, `apps/web/src/lib/queries.ts`
- Test: `apps/api/test/access-web-parity.test.ts`

**Interfaces:**
- Produces: typy `AccessLevel`, `Person`, `PersonWithCounts`, `PersonGrants`, `ApplicationGrant`, `AccessMatrixRow`, `AccessMatrixResponse`, `PersonsResponse`, `PersonsImportPreview`, `PersonsImportResult`, `HeaderMapping`; klucze `qk.accessMatrix`, `qk.persons`, `qk.person`, `qk.applicationAccess`; hooki `usePersons(filters)`, `usePerson(id)`, `useApplicationAccess(applicationId)`, `useAccessMatrix(filters)`, `useGrantAccess()`, `useUpdateGrant()`, `useRevokeGrant()`, `useCreatePerson()`, `useUpdatePerson()`, `useDeactivatePerson()`, `usePreviewPersonsImport()`, `useApplyPersonsImport()`; funkcja eksportu `personsCsv(rows: AccessMatrixRow[]): string`.

- [ ] **Step 1: Napisz test parzystości typów z API**

```ts
/** Typy web nie mogą rozjechać się ze schematem i z enumem AccessLevel. */
import { read } from './helpers/repo';
const typy = read('apps', 'web', 'src', 'types.ts');
// asercje: 'OWNER' | 'ADMIN' | 'USER' | 'READ_ONLY' występuje w types.ts;
// nazwy pól Person pokrywają się z polami modelu Person w schema.prisma;
// każdy klucz `qk.` użyty w queries.ts ma swoje odwołanie w qk
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: z `apps/api`: `npx tsx --test test/access-web-parity.test.ts`
Expected: FAIL — brak typów i kluczy.

- [ ] **Step 3: Dopisz typy w `apps/web/src/types.ts`**

Dokładnie nazwy z sekcji „Interfaces" tego zadania; `AccessMatrixRow` z datami jako `string`. Dodaj etykiety `ACCESS_LEVEL_LABELS: Record<AccessLevel, string>` = `{ OWNER: 'Właściciel', ADMIN: 'Administrator', USER: 'Użytkownik', READ_ONLY: 'Tylko odczyt' }` w sekcji „Etykiety do UI".

- [ ] **Step 4: Dopisz klucze i hooki w `apps/web/src/lib/queries.ts`**

Wzorzec istniejących hooków (`useQuery` + `api.get('/access/persons', params)`, `useMutation` z `onSuccess` unieważniającym konkretne klucze). Po mutacji macierzy unieważnij `qk.applicationAccess(id)`, `qk.accessMatrix` i `qk.person(personId)` — ta sama osoba może być widoczna w trzech miejscach naraz. Eksport CSV buduj po stronie przeglądarki z `AccessMatrixRow`, z `;` jako separatorem i BOM `\ufeff`, żeby Excel poprawnie pokazał polskie znaki (wzorzec eksportu istniejącego w aplikacjach).

- [ ] **Step 5: Uruchom build frontendu**

Run: `npm run test:web-build`
Expected: PASS (`tsc --noEmit` bez błędów, `vite build` bez błędów).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/types.ts apps/web/src/lib/queries.ts apps/api/test/access-web-parity.test.ts
git commit -m "feat(web): typy i hooki modułu uprawnień"
```

---

### Task 9: Sekcja macierzy w karcie aplikacji

**Files:**
- Create: `apps/web/src/components/access/ApplicationAccessSection.tsx`, `apps/web/src/components/access/PersonAccessModal.tsx`
- Modify: `apps/web/src/pages/ApplicationDetailPage.tsx`

**Interfaces:**
- Consumes: hooki z Task 8, `can(user.role, 'access:write')` z `types.ts`, `qk.accessMatrix`.
- Produces: `ApplicationAccessSection({ applicationId: string })`, `PersonAccessModal({ applicationId: string; onClose: () => void })`.

- [ ] **Step 1: Dodaj komponent listy**

`ApplicationAccessSection` renderuje `useApplicationAccess(applicationId)`: kolumny Imię i nazwisko, Stanowisko, Dział, Poziom (badge z `ACCESS_LEVEL_LABELS`), Nadano, Wygasa, akcje. Wiersz z `expiresOn` wcześniejszym niż dziś albo `person.isActive === false` dostaje klasę ostrzegawczą i badge „wygasł" / „nieaktywna". Przycisk „Dodaj osobę" renderowany tylko dla `can(role, 'access:write')`; edycja poziomu i usunięcie przypisania — również. `SortableTh` z `components/ui` pozwala sortować po nazwisku; nazwa pola musi być obsłużona po stronie API (biała lista w `listApplicationAccess`).

- [ ] **Step 2: Dodaj modal dodawania**

`PersonAccessModal`: pola e-mail, imię, nazwisko, stanowisko, dział, poziom, data wygaśnięcia, uwaga. Podpowiednia z `usePersons({ search })` po e-mailu; po wykryciu istniejącego e-mail pokazuj komunikat „Ta osoba już jest w katalogu — zostanie tylko dodana do macierzy" i nie twórz drugiego rekordu. Błąd `409` z serwera wyświetlaj komunikatem z serwisu, nie surowym statusem.

- [ ] **Step 3: Osadź sekcję w `ApplicationDetailPage`**

Dodaj `<ApplicationAccessSection applicationId={application.id} />` jako `card-section` po „Dostęp i wsparcie", z nagłówkiem „Uprawnienia do aplikacji" i ikoną `tone-info` (styl istniejących sekcji w tym pliku).

- [ ] **Step 4: Uruchom build frontendu**

Run: `npm run test:web-build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/access apps/web/src/pages/ApplicationDetailPage.tsx
git commit -m "feat(web): macierz uprawnień w karcie aplikacji"
```

---

### Task 10: Strona „Uprawnienia", import CSV, menu

**Files:**
- Create: `apps/web/src/pages/AccessPage.tsx`, `apps/web/src/pages/PersonDetailPage.tsx`, `apps/web/src/components/access/ImportPersonsModal.tsx`
- Modify: `apps/web/src/router.tsx`, `apps/web/src/components/layout/AppLayout.tsx`

**Interfaces:**
- Consumes: hooki z Task 8, `can()`, `personsCsv()`, komponenty UI (`Table`, `Modal`, `Field`, `Button`, `Feedback`).
- Produces: trasa `/panel/uprawnienia` → `AccessPage`, `/panel/uprawnienia/osoby/:id` → `PersonDetailPage`; pozycja menu „Uprawnienia" renderowana tylko dla ADMIN i SUPER_ADMIN.

- [ ] **Step 1: Zbuduj `AccessPage`**

Dwie zakładki w jednej trasie (stan w `useState`, nie w URL — zawartość strony to nie link do udostępnienia): „Osoby" i „Matryca". Zakładka „Osoby": tabela z wyszukiwarką i filtrami dział/aktywność, klik w wiersz prowadzi do `PersonDetailPage`. Zakładka „Matryca": `useAccessMatrix` z filtrami aplikacja/dział/poziom, tabela jak w sekcji aplikacji, przycisk „Eksportuj CSV" wywołujący `personsCsv`. Nad tabelą przycisk „Importuj z CSV" (`can(role, 'access:write')`).

- [ ] **Step 2: Zbuduj `ImportPersonsModal`**

Trzy kroki w stylu `pages/ImportPage.tsx`. Krok 1: `<input type="file" accept=".csv">`, odczyt `File.arrayBuffer()`, dekodowanie `new TextDecoder('utf-8', { fatal: true })`, a przy `TypeError` ponowienie `new TextDecoder('windows-1250')` i informacja „Plik zapisany nie w UTF-8 — odczytano jako Windows-1250" (punkt 4 Review Focus). Krok 2: `usePreviewPersonsImport` pokazuje grupy „nowe / do aktualizacji / błędne”, pozycje z błędami zablokowane do odznaczenia, oraz mapowanie kolumn z możliwością ręcznej poprawy (zmiana mapowania ponawia podgląd). Krok 3: podsumowanie liczników i „Zapisz" → `useApplyPersonsImport`, po sukcesie zamknięcie i komunikat z liczbami.

- [ ] **Step 3: Zbuduj `PersonDetailPage`**

Dane osoby (edytowalne przy `access:write`), tabela przypisań (aplikacja, poziom, nadano, wygasa) i przycisk „Dodaj do aplikacji" otwierający ten sam `PersonAccessModal` dla wybranej aplikacji. Usunięcie przypisania z tego miejsca działa tak samo jak w karcie aplikacji.

- [ ] **Step 4: Dodaj trasy i pozycję menu**

`router.tsx`: obie trasy jako dzieci `RequireAuth`, z `RequirePermission permission="access:read"` (wzorzec z `components/layout/guards.tsx`). `AppLayout.tsx`: `navLinks` dostaje `{ to: '/panel/uprawnienia', label: 'Uprawnienia' }` warunkowo na `can(role, 'access:read')` — i w wersji desktopowej, i w tej mobilnej na dole ekranu.

- [ ] **Step 5: Uruchom pełny zestaw testów i buildów**

Run: `npm test`
Expected: PASS — w tym `test:web-build` i cały `tsx --test` API.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages apps/web/src/router.tsx apps/web/src/components/access apps/web/src/components/layout/AppLayout.tsx
git commit -m "feat(web): strona uprawnień i import osób z CSV"
```

---

### Task 11: Dane demonstracyjne i dokumentacja

**Files:**
- Create/Modify: `apps/api/src/seed/seed.service.ts` (lub nowy `apps/api/src/seed/demo-persons.ts` dołączony przez `seed.module.ts`)
- Modify: `README.md`, `docs/API.md`, `docs/BAZA-DANYCH.md`, `docs/ARCHITEKTURA.md`
- Test: `apps/api/test/seed-demo.test.ts` (lub dopisz do istniejącego, jeśli już sprawdza dane demo)

**Interfaces:**
- Produces: seed tworzy 3 osoby demonstracyjne (`isDemo`-owy konwencji w tym pliku nie ma — osoby demo rozpoznaje po domenie `@example.invalid` w e-mailu, tak jak demo-aplikacje rozpoznają `isDemo`), z przypisaniami do dwóch aplikacji demo; dokumentacja opisuje 12 endpointów i granicę „ewidencja, nie mechanizm nadania".

- [ ] **Step 1: Napisz test seeda**

Test sprawdza, że po uruchomieniu seeda istnieje co najmniej jedna osoba z e-mailem kończącym się na `@example.invalid` oraz przypisanie do aplikacji demo, i że ponowne uruchomienie seeda nie duplikuje osób (idempotencja po e-mailu).

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: z `apps/api`: `npx tsx --test test/seed-demo.test.ts`
Expected: FAIL — brak osób demonstracyjnych.

- [ ] **Step 3: Dopisz dane demonstracyjne**

Wzorzec `src/seed/demo-services.ts`: tablica osób i przypisań, wstawiane przez upsert po e-mailu, wywoływane z `seed.service.ts` w tym samym miejscu, gdzie wstawiane są aplikacje demo. Jedna osoba z `expiresOn` w przeszłości i jedna z `isActive: false`, żeby ekran od razu pokazywał oba ostrzeżenia.

- [ ] **Step 4: Uruchom testy**

Run: `npm run test --workspace @webinv/api`
Expected: PASS.

- [ ] **Step 5: Zaktualizuj dokumentację**

- `docs/BAZA-DANYCH.md`: tabele `persons`, `application_access`, enum `AccessLevel`, indeksy, powód `onDelete: Cascade`.
- `docs/API.md`: 12 endpointów modułu `access` z uprawnieniami i przykładowym payloadem importu.
- `docs/ARCHITEKTURA.md`: moduł `access`, port `AccessPort` jako granica testowalności, i jawna granica zakresu — ewidencja, nie mechanizm nadania dostępu.
- `README.md`: w „Co potrafi" dwa punkty — „Matryca uprawnień do aplikacji" i „Import osób z CSV (np. z Google Workspace)".

- [ ] **Step 6: Uruchom pełny zestaw testów**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/seed README.md docs
git commit -m "docs(access): macierz uprawnień, import CSV i dane demonstracyjne"
```

---

## Śledzenie wykonania

- [ ] Task 1 — schemat i migracja
- [ ] Task 2 — uprawnienia
- [ ] Task 3 — port i katalog osób
- [ ] Task 4 — macierz i endpointy
- [ ] Task 5 — dziennik zdarzeń
- [ ] Task 6 — parser CSV
- [ ] Task 7 — import preview/apply
- [ ] Task 8 — warstwa klienta frontendu
- [ ] Task 9 — sekcja w karcie aplikacji
- [ ] Task 10 — strona „Uprawnienia" i menu
- [ ] Task 11 — dane demo i dokumentacja