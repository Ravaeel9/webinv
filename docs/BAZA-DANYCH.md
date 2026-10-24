# Baza danych

PostgreSQL 17 + Prisma 6. Źródłem prawdy jest
[`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma); ten dokument
opisuje modele, wartości domyślne i decyzje, których sam schemat nie wyjaśnia.

## Modele

```
User ──< Session
  │
  ├──< Application >── Application.admins (wielokrotność)   "AppAdmins"
  └──< Application (createdById)      "AppCreator"

Application ──< ApplicationEnvironment >── Environment
Application ──< ApplicationIpAddress >── IpAddress ──< Subnet
AuditLog ──> User (opcjonalnie)
Setting (magazyn par klucz–wartość: tryb demo, konfiguracja GLPI)
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

Usunięcie konta jest kasowaniem rekordu — dlatego `Application.createdById` ma
`onDelete: SetNull` (wpis zostaje, autor znika), a sesje i wpisy audytowe
kaskadowo się kasują albo zerują. Właściciel aplikacji nie jest kontem:
to `owner_email`, wolny tekst, więc usunięcie użytkownika nie zaburza
własności.

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
Biurowe, Test, Preprodukcja, Deweloperskie (`upsert`, więc powtórny start
nic nie duplikuje). „Biurowe" zamiast „Produkcja": w tej organizacji
„produkcja" znaczy środowisko z danymi klientów, a aplikacje rejestrowane
w web-inv działają wewnątrz organizacji.

Baza istniejąca przed tą zmianą ma rekord `Produkcja` — seed upsertuje
po nazwie, więc sam go nie przemianuje. Jednorazowo:

```sql
UPDATE environments SET name = 'Biurowe' WHERE name = 'Produkcja';
```

Powiązania (`application_environments`) trzymają `environment_id`, więc
po zmianie nazwy nic nie trzeba przepinać.

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
| `description` | `text?` | `null` | co to jest |
| `purpose` | `text?` | `null` | do czego służy |
| `owner_email` | `citext?` | `null` | właściciel jako adres, **nie** FK — nie musi mieć konta |
| `admins` | m:n → `users` | — | administratorzy aplikacji |
| `introduced_on` | `date?` | `null` | kiedy wprowadzono |
| `sunset_on` | `date?` | `null` | planowane wycofanie; `>= introduced_on` |
| `security_class` | `SecurityClass` | `INTERNAL` | `PUBLIC`/`INTERNAL`/`CONFIDENTIAL`/`RESTRICTED` |
| `criticality` | `smallint` | `2` | 1–4 (aplikacja pilnuje zakresu) |
| `status` | `AppStatus` | `PROD` | `PROD`/`TEST`/`DEV`/`PLANNED`/`DEPRECATED`/`RETIRED` |
| `access_request_required` | `boolean` | `false` | czy dostęp wymaga formalnego wniosku |
| `delivery_type` | `DeliveryType` | `GENERAL_USE` | `GENERAL_USE`/`SELF_HOSTED`/`SAAS`/`VENDOR_MANAGED` |
| `base_url` | `varchar(500)?` | `null` | adres dostępowy do usługi |
| `hosting_location` | `varchar(200)?` | `null` | gdzie fizycznie stoi |
| `admin_team` | `varchar(200)?` | `null` | kto technicznie zarządza |
| `support_owner_type` | `SupportOwnerType?` | `null` | `INTERNAL`/`VENDOR` |
| `support_owner_name` | `varchar(200)?` | `null` | kto prowadzi wsparcie |
| `support_email` | `citext?` | `null` | kontakt do zgłoszeń |
| `support_url` | `varchar(500)?` | `null` | portal zgłoszeń |
| `support_channel` | `SupportChannel?` | `null` | `EMAIL`/`PHONE`/`PORTAL`/`CHAT`/`ON_SITE` |
| `support_notes` | `text?` | `null` | jak wygląda zgłaszanie |
| `vendor` | `varchar(200)?` | `null` | |
| `license` | `varchar(200)?` | `null` | |
| `license_count` | `int?` | `null` | |
| `annual_cost` | `decimal(12,2)?` | `null` | API zamienia na `number` przy serializacji |
| `website_url`, `docs_url`, `repo_url`, `runbook_url` | `varchar(500)?` | `null` | |
| `integrations` | `text?` | `null` | notatki o integracjach |
| `created_by_id` | `uuid?` | `null` | FK → `users`, `SetNull` |
| `created_at` / `updated_at` | `timestamptz` | — | |
| `deleted_at` | `date?` | `null` | **soft delete** — rekord zostaje dla audytu |

Indeksy: `status`, `security_class`, `criticality`, `owner_email`,
`introduced_on`, `sunset_on`, `deleted_at`, `delivery_type`. Każde zapytanie
listy filtruje po `deleted_at IS NULL`, więc indeks jest tu użyteczny.

Kolumna `category` (wolny tekst) została zastąpiona typem `delivery_type`
migracją `20261004143000_delivery_type_support`. Stare wartości były
niejednoznaczne, więc nie przenosimy ich — każdy rekord dostaje
`GENERAL_USE`, a poprawki robi się w formularzu. Pola wsparcia celowo
przetrwają zmianę typu z powrotem na `GENERAL_USE`: to zmiana opisu,
nie skasowanie wiedzy.

`citext` na `name` odpowiada za to, że `GitLab` i `gitlab` to jeden wpis —
bez dopisywania `mode: 'insensitive'` w każdym zapytaniu. Serwis i tak sprawdza
unikalność jawnie, żeby dać lepszy komunikat błędu (w tym informację, że
wpis istnieje, ale jest usunięty).

### `subnets`

| Pole | Typ | Domyślnie | Uwagi |
|---|---|---|---|
| `id` | `uuid` | — | |
| `name` | `citext` | — | unikalne, bez rozróżniania wielkości liter |
| `cidr` | `varchar(18)` | — | `"10.20.0.0/16"` — tekst znormalizowany przy zapisie, **nie** typ `inet`; rachunek robi `src/ipam/cidr.ts` |
| `description` | `text?` | `null` | |
| `color` | `varchar(30)` | `slate` | słowo kluczowe palety UI — kolor kafelka, nic więcej |
| `vlan` | `smallint?` | `null` | 1–4094, pilnuje API |
| `location` | `varchar(200)?` | `null` | |
| `created_at` / `updated_at` | `timestamp(3)` | — | |

**Dlaczego brak soft-delete.** Aplikacja przeżywa w bazie po usunięciu,
bo dziennik i historia przypisań muszą pozostać czytelne — podsieć takiego
uzasadnienia nie ma. Katalog ma odpowiadać na pytanie „jakie zakresy mamy
dziś", a wiersz z ustawionym `deleted_at` dawałby dwie odpowiedzi naraz:
lista by go nie pokazała, natomiast kontrola kolizji (`assertZakresWolny`)
czyta wszystkie wiersze bez filtrów i musiałaby odrębnie filtrować duchy,
żeby usunięta podsieć nie blokowała zapisu nowej w tym samym zakresie.
Miast tego usunięcie jest twarde i kaskadowe: `onDelete: Cascade` zabiera
adresy (`ip_addresses.subnet_id`) i ich przypisania razem z podsiecią,
a kasowanie idzie w jednej transakcji z **jednym** zbiorczym wpisem
`subnet.deleted`. Historia w dzienniku zostaje, stan katalogu nie kłamie.

### `ip_addresses`

| Pole | Typ | Domyślnie | Uwagi |
|---|---|---|---|
| `id` | `uuid` | — | |
| `subnet_id` | `uuid` | — | FK → `subnets`, `onDelete: Cascade` |
| `address` | `varchar(18)` | — | pojedynczy IPv4 bez maski, oktety bez zer wiodących |
| `status` | `IpStatus` | `FREE` | patrz „dlaczego tu, a nie na relacji" poniżej |
| `description` | `text?` | `null` | |
| `last_seen_at` | `timestamp(3)?` | `null` | ostatnie potwierdzenie skanem; pole już w schemacie, wypełni je planowany import `nmap` |
| `created_at` / `updated_at` | `timestamp(3)` | — | |

Unikalność: `@@unique([subnet_id, address])` — ten sam adres nie może
wystąpić dwukrotnie w jednej podsieci. W skali katalogu jest jednoznaczny
dla klienta, bo zakresy podsieci nie mogą na siebie nachodzić (kolizja
to `409` przy zapisie), ale klucz złożony pozostaje zabezpieczeniem
właściwym: chroni przed duplikatem także wtedy, gdyby ktoś kiedyś poluzował
regułę nakładania. Indeks po `status` pod liczniki katalogu.

**Dlaczego `status` siedzi na adresie, a nie na relacji z aplikacją.**
Po pierwsze, adres ma życie niezależne od przypisań: bywa zarezerwowany,
zanim ktokolwiek go podepnie, i wycofywany (`DEPRECATED`), gdy nic już
na nim nie siedzi — żaden wiersz relacji takiego stanu nie pomieści, bo
właśnie wtedy relacji nie ma. Po drugie, VIP obsługuje kilka aplikacji
naraz; status na relacji musiałby być negocjowany między N wierszami,
żeby odpowiedzieć na pytanie, które katalog i tak zadaje per adres.
Konsekwencja: przypisanie **nie zmienia statusu** (PUT dopisuje i odejmuje
wiersze relacji, status zostaje) — jedyny automat to
`releaseIpAddressesForApplication` przy soft delete aplikacji: adres,
któremu zostają żywe przypisania, dostaje `IN_USE`, zwalniany wraca do
`FREE`, a `DEPRECATED` nie zostaje cofnięte, bo zdjęcie przypisania nie
odwołuje decyzji katalogu. Status normalnie zmienia wyłącznie redaktor
katalogu przez `PATCH /api/ipam/addresses/:id`.

### `application_ip_addresses`

Tabela łącząca aplikację z adresami (m:n). Klucz główny złożony
`(application_id, ip_address_id)`, indeks po `ip_address_id`, każdy wiersz
ma `created_at` (`timestamp(3)`, domyślnie czas zapisu), oba FK
z `onDelete: Cascade` — usunięcie podsieci (przez adresy) i twarde
usunięcie definicji aplikacji nie mogą zostawić martwych wierszy. Soft
delete aplikacji kaskada nie objęłaby (rekord żyje), dlatego przypisania
zdejmuje jawnie `ApplicationsService.remove()` przez
`IpamService.releaseIpAddressesForApplication()`; przywrócenie aplikacji
ich **nie** odtwarza — administrator dopina adresy ponownie.
`created_at` przeżywa wymianę zestawu przypisań, bo
`setApplicationIpAddresses` zapisuje samą różnicę (`deleteMany` +
`createMany` tylko na pozycjach, które odeszły lub doszły).

### `persons`

Osoba mająca dostęp do aplikacji — **nie konto panelu**. Większość osób
w tej tabeli nie loguje się do systemu, a dostęp nadaje się w narzędziu
poza nim; tutaj zapisujemy, komu go nadano.

| Pole | Typ | Uwagi |
|---|---|---|
| `id` | `uuid` | |
| `first_name` | `varchar(100)` | |
| `last_name` | `varchar(100)` | |
| `email` | `citext` | **unikalny** — tożsamość osoby; `citext` sprawia, że `Jan.Kowalski@firma.pl` i `jan.kowalski@firma.pl` to jeden adres |
| `position` | `varchar(150)?` | stanowisko, wolny tekst |
| `department` | `varchar(150)?` | dział, wolny tekst |
| `is_active` | `boolean` | `false` = osoba wyłączona; **nie kasujemy** — jej przypisania w macierzach muszą zostać czytelne |
| `created_at` / `updated_at` | `timestamptz` | |

Indeks: `last_name` — sortowanie katalogu.

Stanowisko i dział to celowo wolny tekst, a nie słowniki: struktura
organizacyjna zmienia się częściej niż schemat bazy.

### `application_access`

Jedno przypisanie: ta osoba ma dostęp do tej aplikacji na tym poziomie.

| Pole | Typ | Uwagi |
|---|---|---|
| `application_id` | `uuid` | FK → `applications`, `Cascade` |
| `person_id` | `uuid` | FK → `persons`, `Cascade` |
| `level` | `AccessLevel` | `OWNER`, `ADMIN`, `USER`, `READ_ONLY`; domyślnie `USER` |
| `granted_on` | `date` | data nadania, domyślnie dziś |
| `expires_on` | `date?` | wygasanie; **nie kasuje wiersza** — dostęp wygasły zostaje widoczny z ostrzeżeniem |
| `note` | `text?` | np. „dostęp tymczasowy do końca projektu" |
| `created_at` | `timestamptz` | |

Klucz główny złożony `(application_id, person_id)` — ta sama osoba nie może
wejść do tej samej aplikacji dwa razy. Indeksy: `person_id` (katalog osób →
przypisania), `expires_on` (wygasłe).


### `audit_logs`

| Pole | Typ | Uwagi |
|---|---|---|
| `id` | `uuid` | |
| `action` | `varchar(40)` | np. `app.updated` |
| `entity` | `varchar(60)` | `User`, `Session`, `Application`, `Subnet`, `IpAddress`, `Person`, `ApplicationAccess` |
| `entity_id` | `uuid?` | rekord, którego dotyczy zdarzenie |
| `actor_id` | `uuid?` | FK → `users`, `SetNull` (historia przeżywa usunięcie konta) |
| `actor_name` | `varchar(200)?` | kopia nazwy — czytelna nawet po usunięciu konta |
| `changes` | `json?` | `{ pole: { from, to } }`, wartości przycięte do 200 znaków + `_truncated` |
| `ip` | `varchar(64)?` | |
| `user_agent` | `varchar(500)?` | |
| `created_at` | `timestamptz` | |

Indeksy: `(entity, entity_id)`, `actor_id`, `created_at` — pokrywają listę
zdarzeń i filtrowanie po encji i pojedynczym rekordzie
(`GET /api/audit?entity=...&entityId=...`).

### `settings`

Prosty magazyn klucz–wartość (`Setting`): klucz `String` (PK), wartość
`String`. Bez schematu kolumn — celowo, bo to ustawienia zmieniane przez
panel, a nie przez zapytania analityczne.

| Klucz | Zapisuje | Kto zmienia |
|---|---|---|
| `demo.*` | stan trybu demonstracyjnego | super admin (PUT `/api/settings/demo`) |
| `glpi.*` | konfiguracja integracji GLPI (URL, poświadczenia — sekrety **zaszyfrowane** kluczem z `SESSION_SECRET`) | super admin (PUT `/api/glpi/settings`) |

Klucze `glpi.*` trzymają sekrety zaszyfrowane (`glpi-crypto`); rekordy nie
zwracają jawnie zapisanych wartości — GET pokazuje flagi `has*`. Obrót
`SESSION_SECRET` unieważnia zapisane sekrety (trzeba je wpisać ponownie).

## Enumy

| Enum | Wartości | Znaczenie |
|---|---|---|
| `Role` | `SUPER_ADMIN`, `ADMIN`, `VIEWER` | uprawnienia, patrz [API.md](API.md#role-i-uprawnienia) |
| `SecurityClass` | `PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, `RESTRICTED` | klasyfikacja danych/aplikacji |
| `AppStatus` | `PROD`, `TEST`, `DEV`, `PLANNED`, `DEPRECATED`, `RETIRED` | status wdrożenia |
| `DeliveryType` | `GENERAL_USE`, `SELF_HOSTED`, `SAAS`, `VENDOR_MANAGED` | program na stanowisku czy usługa hostowana |
| `SupportOwnerType` | `INTERNAL`, `VENDOR` | kto prowadzi wsparcie |
| `SupportChannel` | `EMAIL`, `PHONE`, `PORTAL`, `CHAT`, `ON_SITE` | główny kanał zgłoszeń |
| `AccessLevel` | `OWNER`, `ADMIN`, `USER`, `READ_ONLY` | poziom dostępu osoby do aplikacji — inny niż `Role`, który opisuje prawa w panelu |
| `IpStatus` | `FREE`, `IN_USE`, `DEPRECATED` | status adresu w katalogu: wolny (lub zarezerwowany bez aplikacji), zajęty, wycofywany — dlaczego na adresie, patrz `ip_addresses` |

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
