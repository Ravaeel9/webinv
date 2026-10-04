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
| `400` | niepoprawny ładunek, nieznane pole, zła data, wycofanie przed wprowadzeniem, zbyt słabe hasło |
| `401` | brak sesji lub sesja wygasła |
| `403` | brak uprawnienia **albo** konto ma obowiązek zmiany hasła startowego |
| `404` | nie ma takiego rekordu (aplikacja usunięta liczy się jako nieistniejąca) |
| `409` | konflikt unikalności (nazwa aplikacji, nazwa użytkownika, e-mail) |
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
| `GET` | `/applications/stats` | sesja | liczniki na pulpit (status, klasyfikacja, krytyczność, środowiska, kategorie, EOL, ostatnie zmiany) |
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
| `q` | tekst ≤ 200 | szuka w nazwie, wersji, kategorii, opisie, celu i dostawcy (bez znajomości wielkości liter); **tylko dla zalogowanych** także po adresie właściciela i nazwisku administratorów |
| `status` | `PROD`\|`TEST`\|`DEV`\|`PLANNED`\|`DEPRECATED`\|`RETIRED` | |
| `securityClass` | `PUBLIC`\|`INTERNAL`\|`CONFIDENTIAL`\|`RESTRICTED` | **ignorowany dla gościa** |
| `criticality` | 1–4 | **ignorowany dla gościa** |
| `ownerEmail` | adres e-mail | **ignorowany dla gościa**; dokładne dopasowanie |
| `missingOwner` | `true` | tylko wpisy bez właściciela (karta na pulpicie) |
| `environmentId` | uuid | |
| `category` | tekst | porównanie bez wielkości liter |
| `includeDeleted` | `true` | pokazuje usunięte (soft delete); **ignorowane dla gościa** |
| `limit` | 1–200 (domyślnie 50) | rozmiar strony |
| `offset` | ≥ 0 (domyślnie 0) | |
| `sort` | nazwa pola, `-` = malejąco | biała lista, patrz niżej |

Dozwolone sortowania: `name`, `version`, `category`, `status`,
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
| `category` | tekst ≤ 100 | nie | |
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
`criticality`, `ownerEmail`.

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
| `user.created` / `user.updated` / `user.deleted` | `User` | zarządzanie kontami |
| `user.sessions_revoked` | `User` | unieważnienie sesji po zmianie roli lub wyłączeniu |

## Limit zapytań

- Globalnie: **300 żądań na minutę na IP** (`ThrottlerGuard`).
- Logowanie: `LOGIN_RATE_LIMIT_MAX` (domyślnie 10) w okniu
  `LOGIN_RATE_LIMIT_WINDOW` (domyślnie `15m`), liczone per IP.
- Liczniki żyją w pamięci procesu — po restarcie kontenera zaczynają od zera,
  a przy więcej niż jednej instancji API nie są wspólne.
