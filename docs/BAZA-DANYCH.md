# Baza danych

PostgreSQL 17 + Prisma 6. Źródłem prawdy jest
[`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma); ten dokument
opisuje modele, wartości domyślne i decyzje, których sam schemat nie wyjaśnia.

## Modele

```
User ──< Session
  │
  ├──< Application (ownerId)          "AppOwner"
  ├──< Application >── Application.admins (wielokrotność)   "AppAdmins"
  └──< Application (createdById)      "AppCreator"

Application ──< ApplicationEnvironment >── Environment
Application
AuditLog ──> User (opcjonalnie)
```

### `users`

| Pole | Typ | Uwagi |
|---|---|---|
| `id` | `uuid` | klucz główny, generowany po stronie aplikacji |
| `username` | `citext` | unikalny, bez rozróżniania wielkości liter |
| `email` | `citext` | unikalny, bez rozróżniania wielkości liter |
| `full_name` | `varchar(200)` | imię i nazwisko |
| `password_hash` | `varchar(255)` | Argon2id; nie wraca nigdzie w API |
| `role` | `Role` | `SUPER_ADMIN` \| `ADMIN` \| `VIEWER`, domyślnie `VIEWER` |
| `is_active` | `boolean` | `true` = konto może się logować |
| `must_change_password` | `boolean` | blokada API poza zmianą hasła |
| `password_changed_at` | `timestamptz?` | informacyjnie, nie używane w runtime |
| `last_login_at` | `timestamptz?` | aktualizowane przy udanym logowaniu |
| `created_at` / `updated_at` | `timestamptz` | `updated_at` automatycznie |

Usunięcie konta jest kasowaniem rekordu — dlatego `Application.ownerId` ma
`onDelete: SetNull` (wpis zostaje, właściciel znika), a sesje i wpisy audytowe
kaskadowo się kasują albo zerują.

### `sessions`

| Pole | Typ | Uwagi |
|---|---|---|
| `id` | `uuid` | |
| `token_hash` | `varchar(128)` | **unikalny**; SHA-256 z tokenu, który jest tylko w ciasteczku |
| `user_id` | `uuid` | FK → `users`, `onDelete: Cascade` |
| `expires_at` | `timestamptz` | `created_at + SESSION_TTL_DAYS` |
| `created_at` / `last_seen_at` | `timestamptz` | `last_seen_at` służy do limitu 2 dni bezczynności |
| `ip` | `varchar(64)?` | z nagłówków `X-Forwarded-For` / `X-Real-IP` |
| `user_agent` | `varchar(500)?` | obcięty do 500 znaków |

Indeksy: `user_id`, `expires_at`. Sesje wygasłe usuwa się leniwie przy
logowaniu (najwyżej raz na godzinę).

### `environments`

| Pole | Typ | Uwagi |
|---|---|---|
| `id` | `uuid` | |
| `name` | `citext` | unikalny |
| `sort_order` | `int` | kolejność na liście rozwijanej |
| `color` | `varchar(30)` | słowo kluczowe palety UI (`emerald`, `amber`, `sky`, `violet`, `slate`) |

Przy pierwszym uruchomieniu `SeedService` wstawia cztery środowiska:
Produkcja, Test, Preprodukcja, Deweloperskie (`upsert`, więc powtórny start
nic nie duplikuje).

### `application_environments`

Tabela łącząca aplikację ze środowiskami. Klucz główny złożony
`(application_id, environment_id)`, indeks po `environment_id`, oba FK z
`onDelete: Cascade`.

### `applications`

| Pole | Typ | Domyślnie | Uwagi |
|---|---|---|---|
| `id` | `uuid` | — | |
| `name` | `citext` | — | unikalny, bez rozróżniania wielkości liter |
| `version` | `varchar(100)` | — | |
| `category` | `varchar(100)?` | `null` | wolna tekstowa |
| `description` | `text?` | `null` | co to jest |
| `purpose` | `text?` | `null` | do czego służy |
| `owner_id` | `uuid?` | `null` | FK → `users`, `SetNull` |
| `admins` | m:n → `users` | — | administratorzy aplikacji |
| `introduced_on` | `date?` | `null` | kiedy wprowadzono |
| `sunset_on` | `date?` | `null` | planowane wycofanie; `>= introduced_on` |
| `security_class` | `SecurityClass` | `INTERNAL` | `PUBLIC`/`INTERNAL`/`CONFIDENTIAL`/`RESTRICTED` |
| `criticality` | `smallint` | `2` | 1–4 (aplikacja pilnuje zakresu) |
| `status` | `AppStatus` | `PROD` | `PROD`/`TEST`/`DEV`/`PLANNED`/`DEPRECATED`/`RETIRED` |
| `access_request_required` | `boolean` | `false` | czy dostęp wymaga formalnego wniosku |
| `vendor` | `varchar(200)?` | `null` | |
| `license` | `varchar(200)?` | `null` | |
| `license_count` | `int?` | `null` | |
| `annual_cost` | `decimal(12,2)?` | `null` | API zamienia na `number` przy serializacji |
| `website_url`, `docs_url`, `repo_url`, `runbook_url` | `varchar(500)?` | `null` | |
| `integrations` | `text?` | `null` | notatki o integracjach |
| `created_by_id` | `uuid?` | `null` | FK → `users`, `SetNull` |
| `created_at` / `updated_at` | `timestamptz` | — | |
| `deleted_at` | `date?` | `null` | **soft delete** — rekord zostaje dla audytu |

Indeksy: `status`, `security_class`, `criticality`, `owner_id`,
`introduced_on`, `sunset_on`, `deleted_at`, `category`. Każde zapytanie listy
filtruje po `deleted_at IS NULL`, więc indeks jest tu użyteczny.

`citext` na `name` odpowiada za to, że `GitLab` i `gitlab` to jeden wpis —
bez dopisywania `mode: 'insensitive'` w każdym zapytaniu. Serwis i tak sprawdza
unikalność jawnie, żeby dać lepszy komunikat błędu (w tym informację, że
wpis istnieje, ale jest usunięty).

### `audit_logs`

| Pole | Typ | Uwagi |
|---|---|---|
| `id` | `uuid` | |
| `action` | `varchar(40)` | np. `app.updated` |
| `entity` | `varchar(60)` | `User`, `Session`, `Application` |
| `entity_id` | `uuid?` | rekord, którego dotyczy zdarzenie |
| `actor_id` | `uuid?` | FK → `users`, `SetNull` (historia przeżywa usunięcie konta) |
| `actor_name` | `varchar(200)?` | kopia nazwy — czytelna nawet po usunięciu konta |
| `changes` | `json?` | `{ pole: { from, to } }`, wartości przycięte do 200 znaków + `_truncated` |
| `ip` | `varchar(64)?` | |
| `user_agent` | `varchar(500)?` | |
| `created_at` | `timestamptz` | |

Indeksy: `(entity, entity_id)`, `actor_id`, `created_at` — pokrywają listę
zdarzeń i filtrowanie po encji. Kolumna `entity_id` jest indeksowana, ale
**API nie udostępnia filtra po niej** (patrz znane niedociągnięcie w
[ROZWOJ.md](ROZWOJ.md#znane-niedociągnięcia)).

## Enumy

| Enum | Wartości | Znaczenie |
|---|---|---|
| `Role` | `SUPER_ADMIN`, `ADMIN`, `VIEWER` | uprawnienia, patrz [README](../README.md#role-i-uprawnienia) |
| `SecurityClass` | `PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, `RESTRICTED` | klasyfikacja danych/aplikacji |
| `AppStatus` | `PROD`, `TEST`, `DEV`, `PLANNED`, `DEPRECATED`, `RETIRED` | status wdrożenia |

## Rozszerzenia

Skrypt [`docker/init/10-extensions.sql`](../docker/init/10-extensions.sql) działa
**raz**, przy pierwszym `initdb`:

- `citext` — case-insensitive dla `username`, `email`, `name` środowisk i
  aplikacji;
- `uuid-ossp` — generowanie UUID w SQL (poza Prisma), na potrzeby skryptów ad hoc.

Konfiguracja CLI Prisma (`prisma.config.ts`) dba o to, żeby shadow database
migracji (`migrate dev`) miała `citext` — inaczej walidacja migracji pada na
`type citext does not exist`.

## Migracje

Katalog [`apps/api/prisma/migrations`](../apps/api/prisma/migrations) zawiera
migracje w formacie SQL (`migration_lock.toml` pilnuje providera).

| Kontekst | Polecenie | Kto wykonuje |
|---|---|---|
| praca lokalna, zmiana schematu | `make migrate` (`prisma migrate dev`) | developer — tworzy migrację, pyta o nazwę, stosuje ją i generuje klienta |
| wdrożenie | `prisma migrate deploy` | kontener API przy starcie (`scripts/migrate.mjs`) |
| podgląd danych | `make studio` (port 5555) | developer, wymaga włączonej bazy |

Zasady:

- migracja jest **zawsze** z katalogu `migrations` — `docker-compose` stosuje ją
  przed startem aplikacji; gdy migracja padnie, kontener nie wstaje
  (lepiej brak usługi niż niespójne dane);
- nie edytujemy migracji już zastosowanych — nowa zmiana to nowy katalog
  wygenerowany przez Prisma;
- `prisma generate` po zmianie schematu (albo automatycznie w `migrate dev`).

## Kopia i przywracanie

```bash
make backup                                   # backups/backup-RRRR-MM-DD-HHMMSS.sql.gz
make restore f=backups/backup-20260930-171642.sql.gz
```

Kopia to `pg_dump` wykonany wewnątrz kontenera bazy. Przywracanie nadpisuje
aktualny stan bazy — zatrzymaj aplikację (`make down`), jeśli nie chcesz
aktywnych połączeń podczas wgrywania.
