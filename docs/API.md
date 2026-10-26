# API

Bazowy adres w produkcji to ten sam origin co aplikacja — `/api`. Nginx
przekazuje `/api/` do kontenera API (`:3000`), a kontener bazy nie jest
osiągalny z zewnątrz. W trybie deweloperskim Vite robi to samo proxy na
`http://localhost:3000`.

Wszystkie odpowiedzi to JSON (wyjątkiem eksportu CSV). Formaty dat: `RRRR-MM-DD`
(daty) i ISO 8601 (znaczniki czasu).

## Sesja

- Ciasteczko `webinv_sid`, `httpOnly`, `sameSite=lax`, `path=/`,
  `secure` zależne od `COOKIE_SECURE`, `expires` = wygaśnięcie sesji.
- W bazie jest wyłącznie skrót tokenu (SHA-256) — token istnieje tylko
  w ciasteczku klienta.
- JS nie widzi ciasteczka; klient HTTP nie wysyła nagłówka `Authorization`.
  Każde żądanie musi mieć `credentials: 'include'` (przeglądarka robi to
  domyślnie dla `fetch` same-origin, ale warto wiedzieć).

## Role i uprawnienia

Uprawnienia sprawdzane są **w API** (guard), a interfejs tylko je odwzorowuje
przy renderowaniu nawigacji i przycisków. Brak dekoratora `@Public()` oznacza
wymóg sesji — brak endpointu nie oznacza braku ochrony.

| Rola | Uprawnienia |
|---|---|
| `VIEWER` (Obserwator) | `app:read`, `user:read`, `ipam:read` |
| `ADMIN` (Administrator) | `app:read`, `app:write`, `user:read`, `audit:read`, `ipam:read`, `ipam:write`, `access:read`, `access:write` |
| `SUPER_ADMIN` (Super administrator) | wszystkie powyższe plus `user:write` i `settings:write` |

Adresy IP to mapa infrastruktury — dlatego `ipam:*` są oddzielnymi
uprawnieniami, nie pochodnymi `app:*`; katalog wymaga sesji, a gość nie widzi
nawet liczby podsieci.

`access:read` i `access:write` dotyczą macierzy uprawnień. Osobne, a nie
pochodne `app:*`, bo zawierają dane osobowe osób **spoza panelu** — rola
`VIEWER` nie ma do nich wglądu, choć czyta cały rejestr aplikacji.

## Format błędów

Zwykły wyjątek NestJS:

```json
{ "statusCode": 409, "message": "Aplikacja o nazwie „GitLab” już istnieje.", "error": "Conflict" }
```

Błąd walidacji ma tablicę komunikatów z `class-validator` (jedno pole może mieć
kilka powodów odrzucenia):

```json
{
  "statusCode": 400,
  "message": ["Krytyczność: zakres 1-4.", "Data musi mieć format RRRR-MM-DD."],
  "error": "Bad Request"
}
```

| Kod | Znaczenie w tym API |
|---|---|
| `400` | niepoprawny ładunek, nieznane pole, zła data, wycofanie przed wprowadzeniem, zbyt słabe hasło; w IPAM także zły CIDR/IPv4 i adres poza podsiecią |
| `401` | brak sesji lub sesja wygasła |
| `403` | brak uprawnienia **albo** konto ma obowiązek zmiany hasła startowego |
| `404` | nie ma takiego rekordu (aplikacja usunięta liczy się jako nieistniejąca) |
| `409` | konflikt unikalności (nazwa aplikacji, nazwa użytkownika, e-mail); w IPAM nakładanie zakresów podsieci i duplikat adresu |
| `429` | przekroczony limit zapytań (300/min na IP; logowanie: `LOGIN_RATE_LIMIT_MAX` w oknie `LOGIN_RATE_LIMIT_WINDOW`) |

## Health

Bez sesji. Prefiks `api` jest tu celowy — `/health` nginx przepuszczałby do SPA,
`/api/health` trafia do backendu.

| Metoda | Ścieżka | Opis |
|---|---|---|
| `GET` | `/api/health` | żywotność procesu (nie odpytuje bazy) → `{ status, uptimeSeconds, timestamp }` |
| `GET` | `/api/health/ready` | gotowość z kontrolą bazy → `{ status: "ready", database: "up" }` albo `{ status: "degraded", database: "down", error }` |

## Uwierzytelnianie `/api/auth`

| Metoda | Ścieżka | Dostęp | Opis |
|---|---|---|---|
| `POST` | `/auth/login` | publiczny, limit logowania | `{ username, password }` — `username` to nazwa **lub** e-mail; ustawia ciasteczko, zwraca `{ user }` |
| `POST` | `/auth/logout` | sesja | kasuje sesję po stronie serwera i czyści ciasteczko |
| `GET` | `/auth/me` | sesja | `{ user }` — frontend czyta z tego `mustChangePassword` |
| `POST` | `/auth/change-password` | sesja (także z obowiązkową zmianą hasła) | `{ currentPassword, newPassword }` — unieważnia **wszystkie** sesje i wydaje nową |
| `GET` | `/auth/sessions` | sesja | `{ sessions: [{ id, ip, userAgent, createdAt, lastSeenAt, expiresAt }] }` — tylko własne, nie wygasłe |
| `POST` | `/auth/sessions/revoke` | sesja | `{ sessionId }` — kończy jedną własną sesję |

Struktura `user`:

```json
{
  "id": "0f0c…",
  "username": "admin",
  "email": "admin@firma.local",
  "fullName": "Administrator Systemu",
  "role": "SUPER_ADMIN",
  "mustChangePassword": false
}
```

Uwagi:

- Nieudane logowanie odpowiada **tym samym komunikatem** co złe hasło —
  inaczej można by zliczać, które nazwy są zajęte. Próby są zapisywane w
  dzienniku jako `auth.login_failed` z nazwą, którą ktoś wpisał.
- Konto wyłączone (`isActive=false`) dostaje komunikat o wyłączonym koncie, a nie
  „nieprawidłowy login" — różnica jest świadoma i pomocna przy odzyskiwaniu
  dostępu, bo konta i tak nie da się zgadywać metodą zgadywania haseł.
- `mustChangePassword: true` blokuje wszystko poza `/auth/me`, `/auth/logout`,
  `/auth/sessions`, `/auth/sessions/revoke` i `/auth/change-password`.

```bash
curl -c jar.txt -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"…"}'

curl -b jar.txt http://localhost:8080/api/auth/me
```

## Aplikacje `/api/applications`

### Odczyt

| Metoda | Ścieżka | Dostęp | Opis |
|---|---|---|---|
| `GET` | `/applications` | publiczny | lista z filtrowaniem, sortowaniem i stronicowaniem |
| `GET` | `/applications/:id` | publiczny | szczegóły aplikacji |
| `GET` | `/applications/stats` | sesja | liczniki na pulpit (status, klasyfikacja, krytyczność, środowiska, typ dostarczenia, EOL, ostatnie zmiany) |
| `GET` | `/applications/environments` | publiczny | słownik środowisk do filtrów i formularzy |
| `GET` | `/applications/owner-options` | sesja | unikalne adresy właścicieli do filtra; źródłem są aplikacje, nie `users` |
| `GET` | `/applications/export` | sesja | CSV (`text/csv`, `Content-Disposition: rejestr-YYYY-MM-DD.csv`, BOM pod Excel), limit 10 000 rekordów |

Odpowiedź listy:

```json
{ "items": [ /* … */ ], "total": 128, "limit": 50, "offset": 0, "hasMore": true }
```

`hasMore` = `offset + items.length < total`.

### Parametry listy

| Parametr | Typ | Uwagi |
|---|---|---|
| `q` | tekst ≤ 200 | szuka w nazwie, wersji, opisie, celu i dostawcy (bez znajomości wielkości liter); **tylko dla zalogowanych** także po adresie właściciela, nazwisku administratorów i danych bloku wsparcia |
| `status` | `PROD`\|`TEST`\|`DEV`\|`PLANNED`\|`DEPRECATED`\|`RETIRED` | |
| `securityClass` | `PUBLIC`\|`INTERNAL`\|`CONFIDENTIAL`\|`RESTRICTED` | **ignorowany dla gościa** |
| `criticality` | 1–4 | **ignorowany dla gościa** |
| `ownerEmail` | adres e-mail | **ignorowany dla gościa**; dokładne dopasowanie |
| `missingOwner` | `true` | tylko wpisy bez właściciela (karta na pulpicie) |
| `environmentId` | uuid | |
| `deliveryType` | `GENERAL_USE`\|`SELF_HOSTED`\|`SAAS`\|`VENDOR_MANAGED` | widoczne także dla gościa |
| `includeDeleted` | `true` | pokazuje usunięte (soft delete); **ignorowane dla gościa** |
| `limit` | 1–200 (domyślnie 50) | rozmiar strony |
| `offset` | ≥ 0 (domyślnie 0) | |
| `sort` | nazwa pola, `-` = malejąco | biała lista, patrz niżej |

Dozwolone sortowania: `name`, `version`, `deliveryType`, `status`,
`securityClass`, `criticality`, `introducedOn`, `sunsetOn`, `updatedAt`,
`createdAt`. Nieznana nazwa **nie jest błędem** — lista wraca posortowana po
nazwie. Gość nie może sortować po `securityClass` i `criticality`: kolejność
wierszy zdradzałaby wartość, której nie ma w odpowiedzi.

Domyślne kierunki: `name` rosnąco, `introducedOn`/`updatedAt`/`createdAt`
malejąco, `sunsetOn` rosnąco (najbliższe wycofanie pierwsze), `criticality`
i `securityClass` malejąco (najwyższe pierwsze). Prefiks `-` odwraca ten
kierunek.

### Zapis

| Metoda | Ścieżka | Uprawnienie | Opis |
|---|---|---|---|
| `POST` | `/applications` | `app:write` | nowy wpis |
| `PATCH` | `/applications/:id` | `app:write` | aktualizacja (scalanie) |
| `DELETE` | `/applications/:id` | `app:write` | **soft delete** — ustawia `deletedAt` |
| `POST` | `/applications/:id/restore` | `app:write` | przywrócenie usuniętego wpisu |

Pola tworzenia i aktualizacji (`CreateApplicationDto`):

| Pole | Typ | Wymagane | Uwagi |
|---|---|---|---|
| `name` | tekst ≤ 200 | tak (przy tworzeniu) | unikalny, bez rozróżniania wielkości liter; nie może składać się z samych spacji |
| `version` | tekst ≤ 100 | tak (przy tworzeniu) | |
| `deliveryType` | enum | nie (domyślnie `GENERAL_USE`) | `GENERAL_USE`/`SELF_HOSTED`/`SAAS`/`VENDOR_MANAGED` |
| `baseUrl` | URL ≤ 500 | nie | adres dostępowy do usługi |
| `hostingLocation` | tekst ≤ 200 | nie | gdzie fizycznie stoi |
| `adminTeam` | tekst ≤ 200 | nie | kto technicznie zarządza |
| `supportOwnerType` | enum | nie | `INTERNAL`/`VENDOR` |
| `supportOwnerName` | tekst ≤ 200 | nie | kto konkretnie prowadzi wsparcie |
| `supportEmail` | adres e-mail ≤ 320 | nie | |
| `supportUrl` | URL ≤ 500 | nie | portal zgłoszeń |
| `supportChannel` | enum | nie | `EMAIL`/`PHONE`/`PORTAL`/`CHAT`/`ON_SITE` |
| `supportNotes` | tekst ≤ 10 000 | nie | |
| `description` | tekst ≤ 10 000 | nie | |
| `purpose` | tekst ≤ 10 000 | nie | „do czego to służy” |
| `ownerEmail` | adres e-mail ≤ 320 | nie | właściciel jako adres — **nie musi mieć konta** |
| `adminIds` | uuid[] | nie | maks. 50, muszą istnieć |
| `environmentIds` | uuid[] | nie | maks. 20, muszą istnieć |
| `introducedOn` | `RRRR-MM-DD` | nie | nie później niż `sunsetOn` |
| `sunsetOn` | `RRRR-MM-DD` | nie | planowane wycofanie |
| `securityClass` | enum | nie (domyślnie `INTERNAL`) | |
| `criticality` | 1–4 | nie (domyślnie 2) | 1 = niska, 4 = krytyczna |
| `status` | enum | nie (domyślnie `PROD`) | |
| `accessRequestRequired` | boolean | nie (domyślnie `false`) | czy dostęp wymaga formalnego wniosku |
| `vendor` | tekst ≤ 200 | nie | |
| `license` | tekst ≤ 200 | nie | |
| `licenseCount` | int ≥ 0 | nie | |
| `annualCost` | liczba, 2 miejsca po przecinku, ≥ 0 | nie | kwota roczna |
| `websiteUrl`, `docsUrl`, `repoUrl`, `runbookUrl` | URL ≤ 500 | nie | protokół opcjonalny |
| `integrations` | tekst ≤ 10 000 | nie | notatki o integracjach |

Reguły PATCH-a:

- `undefined` (pole nieobecne lub `""`) = **nie ruszaj** pola;
- `null` = **wyczyść** pole;
- `name` i `version` nie są wymagane (tworzenie pilnuje ich serwis), ale jeśli
  są obecne, walidacja nadal działa;
- nieznane pole = `400` (nie jest cicho ignorowane);
- `adminIds` i `environmentIds` to pełna zamiana zbioru przypisań: pusta lista
  czyści przypisania, brak pola ich nie zmienia;
- walidacja dat widzi scalony obraz (żądanie + obecny rekord), więc `sunsetOn`
  nie może wypaść przed `introducedOn` zapisanym wcześniej;
- nazwa, która istnieje, ale jest usunięta → `409` z instrukcją, żeby ją
  przywrócić albo zmienić nazwę.

Pola ukryte przed gościem (nieobecne w odpowiedzi): `securityClass`,
`criticality`, `ownerEmail`, a z bloku dostarczenia i wsparcia —
`hostingLocation`, `adminTeam`, `supportOwnerType`, `supportOwnerName`,
`supportEmail`, `supportUrl`, `supportChannel`, `supportNotes`. Widoczne
zostają `deliveryType` i `baseUrl`, bo to informacja techniczna, a nie
dana wewnętrzna.

## Katalog IPAM `/api/ipam`

Katalog podsieci, adresów i ich przypisań do aplikacji. **Żadna trasa nie
jest `@Public()`** — mapa infrastruktury (adresy sieci wewnętrznych,
VLAN-y, przypisania) wymaga sesji przed sprawdzeniem uprawnień.
`ipam:read` ma każda rola zalogowana, zapisy wymagają `ipam:write`.

Wyjątkiem są dwie trasy przypisań aplikacji: tam patrzy karta aplikacji,
nie katalog, więc zamiast uprawnień IPAM wymagane jest `app:read` (odczyt)
i `app:write` (zapis). Trasy mimo to mieszkają pod `/api/ipam` — to ten
sam katalog, a nie zasób `/api/applications`.

| Metoda | Ścieżka | Uprawnienie | Opis |
|---|---|---|---|
| `GET` | `/ipam/subnets` | `ipam:read` | `{ subnets, total }` — lista z licznikami (`addressCount`, `freeCount`, `applicationCount`), sort po numerze sieci i prefiksie |
| `GET` | `/ipam/subnets/:id` | `ipam:read` | `{ subnet }` — karta z pełną listą `addresses`; każdy adres niesie `applications: [{ id, name }]` (tylko żywe przypisania) |
| `POST` | `/ipam/subnets` | `ipam:write` | `{ subnet }` — `name`, `cidr` wymagane; `description`, `color` (małe litery), `vlan` 1–4094, `location` opcjonalne |
| `PATCH` | `/ipam/subnets/:id` | `ipam:write` | `{ subnet }` — scalanie jak przy aplikacjach; pusty PATCH to no-op bez wpisu w dzienniku |
| `DELETE` | `/ipam/subnets/:id` | `ipam:write` | `200 { ok: true }` — **kaskadowe usunięcie trwałe**: adresy i ich przypisania znikają razem z podsiecią |
| `GET` | `/ipam/subnets/:id/addresses` | `ipam:read` | `{ addresses, total }` — posortowane numerycznie, każdy wiersz z `applications: [{ id, name }]` (tylko żywe przypisania, doklejone tym samym `findMany` — bez N+1); `404` dla nieznanej podsieci, żeby literówka w linku nie wyglądała na „podsieć istnieje i jest pusta" |
| `POST` | `/ipam/subnets/:id/addresses` | `ipam:write` | `{ address }` — adres musi leżeć w zakresie podsieci i być adresem hosta; opcjonalnie `status`, `description` |
| `PATCH` | `/ipam/addresses/:id` | `ipam:write` | `{ address }` — status, opis; zmiany statusu przestawiają liczniki katalogu |
| `DELETE` | `/ipam/addresses/:id` | `ipam:write` | `200 { ok: true }`; `409`, gdy adres ma choć jedno żywe przypisanie — najpierw odpiąć go od aplikacji |
| `GET` | `/ipam/addresses/:id/applications` | `ipam:read` | `{ applications: [{ id, name, url }] }` — tylko aplikacje żywe (`deletedAt IS NULL`) |
| `GET` | `/ipam/applications/:appId/ip-addresses` | `app:read` | `{ addresses }` — adresy z `subnet { id, name, cidr }`; nieznany `appId` zwraca `200` z pustą listą (świadomie — patrz komentarz w kontrolerze) |
| `PUT` | `/ipam/applications/:appId/ip-addresses` | `app:write` | `{ ipAddressIds }` — patrz semantyka poniżej |
| `POST` | `/ipam/import/preview` | `ipam:write` | `{ xml }` → `{ new, existing, unmatched, skipped }` — parsuje plik `nmap -oX` (maks. 5 MB i 10 000 hostów), dopasowuje adresy po CIDR i **niczego nie zapisuje** |
| `POST` | `/ipam/import/apply` | `ipam:write` | `{ selections: [{ address, subnetId, description? }] }` → `{ imported }` — zapisuje wybrane pozycje w transakcji (`upsert` po `(subnetId, address)`, ustawia `lastSeenAt`, nowym i dotychczas wolnym adresom nadaje status `IN_USE`, loguje jeden wpis audytu `ip_addresses.import`) |

Lista adresów (`GET .../subnets/:id/addresses` i `addresses` w karcie
`GET .../subnets/:id`) niesie w każdym wierszu `applications: [{ id, name }]`
— żywe przypisania (`deletedAt IS NULL`), doklejone `include` w tym samym
`findMany`, bez osobnego zapytania per adres. Trasa
`GET /ipam/addresses/:id/applications` zostaje jako pełny widok z URL-em
aplikacji.

Semantyka `PUT /ipam/applications/:appId/ip-addresses`:

- **wymienia cały zestaw**, nie patchuje — pusta lista odpina wszystkie
  adresy, maks. 100 identyfikatorów;
- `404`, gdy aplikacja nie istnieje **albo jest usunięta** (soft delete
  nie przyjmuje powiązań, których nikt nie zamawiał) oraz gdy któryś
  `ipAddressId` nie istnieje — wtedy nic nie zostaje zapisane;
- niezmieniony zestaw to no-op: brak transakcji, brak wpisu w dzienniku;
- PUT **nie dotyka statusów adresów** — `status` jest właściwością adresu
  i zmienia go `PATCH /ipam/addresses/:id`; jedyny wyjątek to automat
  zwalniający adresy przy soft delete aplikacji (patrz
  [BAZA-DANYCH.md](BAZA-DANYCH.md)).

Błędy specyficzne dla katalogu: `400` za zły format CIDR/IPv4 (oktety bez
zer wiodących), adres sieciowy/rozgłoszeniowy (wyjątek: `/31` i `/32`),
adres poza zakres podsieci; `409` za nakładanie zakresów podsieci i za
duplikat adresu w tej samej podsieci.

## Użytkownicy `/api/users`

| Metoda | Ścieżka | Uprawnienie | Opis |
|---|---|---|---|
| `GET` | `/users` | `user:read` | lista; `?includeInactive=false` pomija wyłączone konta; rekord ma też `_count.sessions` |
| `GET` | `/users/options` | `app:read` + sesja | słownik aktywnych kont do formularza (właściciel, administratorzy) |
| `GET` | `/users/:id` | `user:read` | jeden rekord |
| `POST` | `/users` | `user:write` | `{ username, email, fullName, password, role? }` — hasło musi spełniać politykę, konto startuje z `mustChangePassword: true` |
| `PATCH` | `/users/:id` | `user:write` | `{ username?, email?, fullName?, role?, isActive? }` |
| `DELETE` | `/users/:id` | `user:write` | usuwa konto (patrz ograniczenia) |
| `POST` | `/users/:id/reset-password` | `user:write` | `{ newPassword }` — kasuje wszystkie sesje, ustawia obowiązek zmiany hasła |
| `POST` | `/users/:id/require-password-change` | `user:write` | wymusza zmianę hasła przy najbliższym logowaniu i kasuje sesje |

Ograniczenia wprowadzane przez serwis (nie przez DTO):

- nie można usunąć własnego konta ani wyłączyć własnego konta;
- nie można zmienić własnej roli;
- nie można zdegradować **ostatniego** aktywnego `SUPER_ADMIN`;
- nie można usunąć konta będącego właścicielem aplikacji (trzeba przenieść
  własność albo wyłączyć konto — `isActive=false` kasuje sesje natychmiast);
- zmiana roli i wyłączenie konta **unieważniają wszystkie sesje** tego
  użytkownika i zapisują zdarzenie `user.sessions_revoked`.

## Dziennik zdarzeń `/api/audit`

| Metoda | Ścieżka | Uprawnienie | Opis |
|---|---|---|---|
| `GET` | `/audit` | `audit:read` | lista zdarzeń, najnowsze pierwsze |
| `GET` | `/audit/meta` | `audit:read` | liczniki akcji i encji do filtrów + etykiety ról |

Parametry: `page` (domyślnie 1), `limit` (1–200, domyślnie 50), `entity`
(dokładnie), `action` (**prefiks**, np. `auth` albo `app.updated`), `actorId`.
Odpowiedź: `{ items, total, page, limit, hasMore }`. Wartość `changes` jest
przycinana do `{ "_truncated": true }`, gdy jej serializacja przekracza
2000 znaków.

> **Uwaga:** filtr po `entityId` **nie jest obsługiwany**. Klient wysyła ten
> parametr (`useAuditForEntity` w `apps/web/src/lib/queries.ts`), ale kontroler
> go ignoruje — sekcja „historia zmian” na stronie aplikacji pokazuje więc
> ostatnie zdarzenia **typu** `Application`, nie jednego rekordu. Opis w
> [ROZWOJ.md](ROZWOJ.md#znane-niedociągnięcia).

Rekord:

```json
{
  "id": "…",
  "action": "app.updated",
  "entity": "Application",
  "entityId": "…",
  "actorId": "…",
  "actorName": "admin",
  "changes": { "version": { "from": "1.0", "to": "2.0" }, "_truncated": ["description"] },
  "ip": "10.0.0.5",
  "userAgent": "Mozilla/5.0 …",
  "createdAt": "2026-10-01T12:00:00.000Z"
}
```

Zdarzenia występujące w systemie:

| Akcja | Encja | Kiedy |
|---|---|---|
| `auth.login` / `auth.login_failed` / `auth.login_blocked` | `User` | logowanie (udane, błędne, wyłączone konto) |
| `auth.logout` | `User` | wylogowanie |
| `auth.password_changed` | `User` | zmiana własnego hasła |
| `auth.password_reset` | `User` | reset hasła przez super admina |
| `auth.password_change_required` | `User` | wymuszenie zmiany hasła |
| `auth.session_revoked` | `Session` | zakończenie sesji z panelu „Moje konto” |
| `app.created` / `app.updated` / `app.deleted` / `app.restored` | `Application` | zapis rejestru |
| `ip_addresses.update` | `Application` | wymiana zestawu przypisanych adresów (liczby dodanych i zdjętych, nie pozycje) |
| `subnet.created` / `subnet.updated` / `subnet.deleted` | `Subnet` | zapis katalogu podsieci |
| `address.created` / `address.updated` / `address.deleted` | `IpAddress` | zapis katalogu adresów |
| `user.created` / `user.updated` / `user.deleted` | `User` | zarządzanie kontami |
| `user.sessions_revoked` | `User` | unieważnienie sesji po zmianie roli lub wyłączeniu |
| `person.created` / `person.deleted` / `person.imported` | `Person` | katalog osób macierzy (ręcznie, CSV, GLPI) |
| `access.granted` / `access.updated` / `access.revoked` / `access.imported` | `ApplicationAccess` | zapis macierzy uprawnień (ręcznie, CSV, GLPI) |
| `access.verified` | `AccessVerification` | odnotowanie przeglądu dostępów |

## Macierz uprawnień `/api/access`

Ewidencja osób mających dostęp do aplikacji. **Nie mechanizm nadania** —
system nie wystawia tokenów ani haseł i nie tworzy kont osobom z ewidencji.
Dostęp nadaje się w narzędziu poza systemem; rejestr pokazuje, komu go
nadano. Osoba nie ma konta w panelu i nie musi się logować.

Wszystkie trasy wymagają sesji i uprawnienia `access:read` albo
`access:write`; żadna nie jest `@Public()`, bo zawiera dane osobowe.

| Metoda | Ścieżka | Uprawnienie | Zastosowanie |
|---|---|---|---|
| GET | `/api/access/applications/:id` | `access:read` | macierz jednej aplikacji |
| POST | `/api/access/applications/:id` | `access:write` | nadanie dostępu osobie |
| PATCH | `/api/access/applications/:id/:personId` | `access:write` | zmiana poziomu, daty wygaśnięcia, notatki |
| DELETE | `/api/access/applications/:id/:personId` | `access:write` | odebranie dostępu (osoba zostaje) |
| GET | `/api/access/matrix` | `access:read` | macierz zbiorcza (raport) |
| GET | `/api/access/verifications` | `access:read` | historia przeglądów dostępów (`applicationId`, `scope` jako filtry) |
| POST | `/api/access/verifications` | `access:write` | odnotowanie przeglądu dostępów (patrz [Weryfikacje dostępów](#weryfikacje-dostępów)) |
| GET | `/api/access/persons` | `access:read` | katalog osób |
| GET | `/api/access/persons/:id` | `access:read` | osoba i jej przypisania |
| POST | `/api/access/persons` | `access:write` | nowa osoba w katalogu |
| PATCH | `/api/access/persons/:id` | `access:write` | edycja danych osoby (`isActive: false` = dezaktywacja) |
| DELETE | `/api/access/persons/:id` | `access:write` | **twarde usunięcie** — tylko dla błędnych wpisów, kaskada przypisań; dezaktywacja idzie PATCH-em |

`GET /api/access/matrix` przyjmuje filtry `applicationId`, `personId`,
`department`, `level` i zwraca płaską listę wierszy
`{ application, person, level, grantedOn, expiresOn, note }`. Wygasłe
przypisania zostają w wyniku — macierz pokazuje stan nadania, nie stan
bieżący.

### Nadanie dostępu

```json
POST /api/access/applications/<id aplikacji>
{
  "email": "jan.kowalski@firma.pl",
  "firstName": "Jan",
  "lastName": "Kowalski",
  "position": "Analityk",
  "department": "IT",
  "level": "ADMIN",
  "expiresOn": "2026-12-31",
  "note": "Dostęp do raportów"
}
```

`firstName` i `lastName` są wymagane tylko wtedy, gdy osoby nie ma jeszcze
w katalogu — istniejącą dodajemy samym e-mailem. Reguły:

- ponowny e-mail w katalogu → `409` z `id` istniejącej osoby;
- ta sama osoba dwa razy w tej samej aplikacji → `409`;
- osoba nieaktywna → `400` (jej dotychczasowe przypisania zostają);
- `expiresOn` w przeszłości → `400` przy nadaniu, dopuszczalne przy edycji.

### Import z CSV

| Metoda | Ścieżka | Uprawnienie | Zastosowanie |
|---|---|---|---|
| POST | `/api/access/import/preview` | `access:write` | podgląd: klasyfikacja wierszy, bez zapisu |
| POST | `/api/access/import/apply` | `access:write` | zapis wybranych wierszy |
| POST | `/api/access/import/matrix/preview` | `access:write` | podgląd importu macierzy (plik w formacie eksportu); `{ csv, applicationId? }` — z `applicationId` tryb pojedynczej aplikacji |
| POST | `/api/access/import/matrix/apply` | `access:write` | zapis importu macierzy (upsert grantów); `{ rows, applicationId? }` |

Plik leci jako **tekst w JSON** (`{ "csv": "..." }`), nie jako `multipart` —
tak samo jak przy imporcie nmap. Limit: 2000 wierszy i 2 MB. Rozpoznawane są
nagłówki polskie i angielskie (eksport Google Workspace: `Email`, `First name`,
`Last name`, `Department`, `Job title`, `Suspended`, …); nierozpoznane można
przypisać do pól przez `mapping`. Kolumna o znaczeniu negatywnym
(`Suspended`, `Archived`, `Disabled`) steruje `isActive`.

Podgląd zwraca dla każdego wiersza `NEW`, `UPDATE` albo `ERROR` z powodem.
Zapis **waliduje wiersze od nowa** i pomija złe (licznik `skipped`), a istniejący
e-mail aktualizuje zamiast duplikować. Osoby nieobecnej w pliku nie dezaktywuje —
brak w pliku niczego nie znaczy.

Import dotyczy wyłącznie katalogu osób. **Import macierzy** (`import/matrix/*`)
jest okrężny z eksportem: przyjmuje dokładnie plik, który generują
`/matrix/export` i `/applications/:id/export`, i działa jako upsert grantów
(nowy grant, aktualizacja poziomu/wygasania/notatki). Osoba nieobecna
w pliku zachowuje dostęp — plik nie odbiera uprawnień. Nieznana osoba
jest tworzona z imienia i nazwiska z pliku; grant dla osoby nieaktywnej
wymaga najpierw aktywacji jej w katalogu. Kolumny pochodne eksportu
(`Status grantu`, `Nadane`, metadane aplikacji) są ignorowane.

### Weryfikacje dostępów

Rejestr przeglądów macierzy: „dnia X osoba Y potwierdziła, że zapisane
dostępy są aktualne". To dowód półrocznego przeglądu — odpowiedź na audytorskie
„kiedy dostępy były ostatnio przeglądane i przez kogo". Wpis **stampuje**
kolumnę `verifiedOn` grantom w swoim zasięgu; zmiana poziomu grantu i nowy
grant unieważniają znacznik.

| Metoda | Ścieżka | Uprawnienie | Zastosowanie |
|---|---|---|---|
| GET | `/api/access/verifications` | `access:read` | historia od najnowszej; filtry `applicationId`, `scope` (`MATRIX`/`APPLICATION`/`GRANT`); limit 1000 wpisów |
| POST | `/api/access/verifications` | `access:write` | nowy wpis + stamp grantów w zasięgu |

```json
POST /api/access/verifications
{
  "scope": "APPLICATION",
  "applicationId": "<uuid aplikacji>",
  "verifiedOn": "2026-10-26",
  "note": "Przegląd półroczny — potwierdzone z właścicielem"
}
```

Zakres decyduje o wymaganych polach: `MATRIX` — cała macierz (bez
identyfikatorów), `APPLICATION` — jedna aplikacja, `GRANT` — aplikacja
i osoba (`personId`). Nadmiarowy identyfikator względem zakresu to `400`,
nie ciche zignorowanie. Weryfikującym zostaje **zalogowany użytkownik z
sesji** — payload nie ma pola aktora, bo potwierdzenie cudzym imieniem nie
byłoby dowodem.

Reguły odrzuceń:

- nieznany zakres, złe UUID, data z przyszłości, notatka > 2000 znaków → `400`;
- data starsza niż **180 dni** → `400` (rejestr dokumentuje bieżący przegląd,
  nie „dokumentuje po fakcie" dowolnie starą datę);
- nieistniejąca aplikacja / osoba / grant → `404`;
- druga weryfikacja tego samego zasięgu w ciągu **24 godzin** → `409` z godziną
  odblokowania. Szerszy przegląd obejmuje węższy: wpis całej macierzy blokuje
  weryfikację aplikacji i każdego wiersza, wpis aplikacji — jej wierszy;
  potwierdzenie wiersza blokuje tylko powtórzenie tego wiersza. Licznik
  biegnie od momentu zapisu (`createdAt`), nie od deklarowanej daty przeglądu —
  cofnięcie daty nie otwiera blokady.

## Ustawienia `/api/settings`

Ustawienia systemowe panelu. Trasy wymagają sesji i `settings:write`
(tylko super administrator).

| Metoda | Ścieżka | Zastosowanie |
|---|---|---|
| GET | `/api/settings/demo` | stan trybu demonstracyjnego |
| PUT | `/api/settings/demo` | włączenie/wyłączenie trybu demo |
| DELETE | `/api/settings/demo/data` | usunięcie danych demonstracyjnych |

Tryb demo: seed wypełnia bazę danymi próbnymi na potrzeby prezentacji;
dane zapisują się w tabeli `settings`, a usuwane są osobno z powyższej trasy.

## Integracja GLPI `/api/glpi`

Import osób, oprogramowania (aplikacji) i przypisań dostępów z grup GLPI.
Cały kontroler pod `settings:write` — to konfiguracja systemowa, nie
funkcja edycji. Błąd ze strony GLPI (sieć, poświadczenia) skutkuje `502`
z komunikatem po polsku.

| Metoda | Ścieżka | Zastosowanie |
|---|---|---|
| GET | `/api/glpi/settings` | stan konfiguracji — **bez sekretów**, flagi `has*` |
| PUT | `/api/glpi/settings` | zapis konfiguracji; `undefined` = „nie ruszaj" (nie kasuje sekretu) |
| POST | `/api/glpi/test` | test połączenia obiema obiektami autoryzacji |
| POST | `/api/glpi/import/preview` | podgląd importu: NEW / SKIP / ERROR, bez zapisu |
| POST | `/api/glpi/import/apply` | zapis importu |

Konfiguracja trzyma sekcje `glpi.*` w tabeli `settings`; sekrety
(`client_secret`, `password`, tokeny) są **zaszyfrowane** kluczem wywiedzionym
z `SESSION_SECRET` i nigdy nie wracają do przeglądarki.

Import jest dwuetapowy (podgląd → zapis). Zapis **nie ufa payloadowi
z przeglądarki**: każdy wiersz jest walidowany od nowa, złe wiersze są
pomijane (licznik `skipped`). Tworzy **wyłącznie nowe** rekordy — nigdy
niczego nie nadpisuje. Kolejność zapisu: osoby → oprogramowanie → dostępy,
bo dostęp wskazuje osobę i aplikację, które muszą istnieć wcześniej.

Sekcja „Dostępy" tworzy także **aplikacje z grup** (payload
`applications`): podrzędna grupa grupy nadrzędnej, której nie ma
w rejestrze, dostaje szkic aplikacji o swojej nazwie — także wtedy,
gdy grupa nie ma żadnych członków. Typ dostarczenia szkicu przychodzi
z wiersza (wybór w panelu); wartość spoza enumu wraca do `GENERAL_USE`.
Licznik tych aplikacji idzie w wyniku jako osobny klucz `applications`,
nie w grantach (`access`). Para dostępów z nieistniejącą aplikacją jest
w podglądzie `NEW` — nie `SKIP` — bo zapis utworzy szkic i nada dostęp.

Nazwa aplikacji jest unikalna globalnie — także po wierszach miękko
usuniętych. Grupa (albo program), której nazwę nosi usunięta aplikacja,
jest **pomijana** z powodem `APP_USUNIETA` („przywróć albo zmień nazwę")
— w podglądzie i przy zapisie; import nie przywraca rekordów i nigdy
nie kończy się 500 z `P2002`.

## Limit zapytań

- Globalnie: **300 żądań na minutę na IP** (`ThrottlerGuard`).
- Logowanie: `LOGIN_RATE_LIMIT_MAX` (domyślnie 10) w okniu
  `LOGIN_RATE_LIMIT_WINDOW` (domyślnie `15m`), liczone per IP.
- Liczniki żyją w pamięci procesu — po restarcie kontenera zaczynają od zera,
  a przy więcej niż jednej instancji API nie są wspólne.
