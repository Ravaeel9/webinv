# Architektura

Dokument opisuje, z czego składa się system, jak przechodzi żądanie od
przeglądarki do bazy i **dlaczego** podjęto takie, a nie inne decyzje. Kod w
repozytorium jest bogaty w komentarze wyjaśniające lokalne powody — ten plik
opisuje decyzje na poziomie całego systemu.

## 1. Kontekst

Rejestr oprogramowania musi być czytelny dla dwie różnych grup:

1. **osób wewnętrznych**, które prowadzą rejestr (edytują wpisy, zarządzają
   kontami, czytają dziennik zdarzeń);
2. **osób zewnętrznych** (dostawcy, audytorzy), które muszą odpowiedzieć na
   pytanie „czy ta aplikacja u nas jest i kto za nią odpowiada”, bez otrzymywania
   dostępu administracyjnego.

Stąd dwa widoki na te same dane: publiczny (okrojony) i panelowy (pełny). Granica
jest egzekwowana **po stronie serwera** — patrz [§7](#7-widok-publiczny-a-pełny).

## 2. Stos technologiczny

| Warstwa | Technologia |
|---|---|
| Frontend | React 19, React Router 8, TanStack Query 5, Vite 8, Tailwind CSS 4 |
| API | NestJS 11 na Fastify 5, class-validator, `@nestjs/throttler` |
| Sesje | własne, ciasteczko `httpOnly` + skrót tokenu w bazie |
| Hasła | Argon2id (natywny moduł `argon2`) |
| Baza danych | PostgreSQL 17 (`citext` dla loginów i nazw aplikacji) |
| Serwowanie SPA | nginx (statyczne pliki + proxy `/api` → API) |
| Orkiestracja | Docker Compose, wieloetapowe obrazy, healthchecki i `depends_on: service_healthy` |

Wersje wszystkich zależności są **przypięte dokładnie** (bez `^` i `~`) —
kontener ma zawsze działać na tym samym kodzie, na którym testy przeszły.
Wyjątkiem od hoistowania jest wzorzec `overrides` w głównym `package.json`:
wymusza on jedną wersję `fastify` także tam, gdzie pośrednik
(`@nestjs/platform-fastify`) dokleja własną kopię, oraz `deepmerge-ts`
w Prisma CLI — naprawa pierwszej podatności wymaga dopiero nowej major
NestJS, a drugiej dopiero nowej major Prisma.

## 3. Komponenty

Trzy kontenery, jedna sieć wewnętrzna, jeden port na zewnątrz.

| Usługa | Obraz | Port | Rola |
|---|---|---|---|
| `web` | `nginx:alpine` | `80` (host: `APP_PORT`) | statyczny build SPA, proxy `/api`, nagłówki bezpieczeństwa w tym CSP |
| `api` | `node:22-bookworm-slim` | `3000` (tylko w sieci) | NestJS na Fastify: REST, sesje, walidacja, audyt |
| `db` | `postgres:17-alpine` | `5432` (tylko w sieci) | dane rejestru, sesje, dziennik zdarzeń |

Zależności startujące są bramkowane healthcheckami
(`depends_on: condition: service_healthy`), więc `web` nigdy nie proxyuje do
API, które jeszcze nie odpowiada, a API nie łączy się z bazą przed jej
gotowością.

### Sieć i ekspozycja

Baza **nie ma** mapowania portów w `docker-compose.yml` — jest dostępna
wyłącznie z kontenera `api`. Do prac lokalnych (Prisma Studio, `psql`,
pgAdmin) istnieje osobna nakładka `docker-compose.dev.yml`, która dokłada
`DB_DEV_PORT` (domyślnie 55432). Nakładki nie wolno używać na serwerze.

Logi każdego kontenera są limitowane (`json-file`, 10 MB × 3 pliki), żaden
kontener nie rośnie w nieskończoność.

### Jak to działa

```
                    ┌──────────────────────────────────────────┐
  przeglądarka ───► │ web: nginx (alpine)                     │
      HTTP :80     │  • /            → SPA (pliki statyczne)│
                    │  • /assets/     → cache 1 rok           │
                    │  • /api/        → proxy → api:3000      │
                    └───────────────────┬──────────────────────┘
                                        │  sieć wewnętrzna (bridge)
                    ┌───────────────────▼──────────────────────┐
                    │ api: NestJS na Fastify (node:22)         │
                    │  ThrottlerGuard → AuthGuard → DTO       │
                    │  kontroler → serwis → Prisma + Audit    │
                    └───────────────────┬──────────────────────┘
                                        │
                    ┌───────────────────▼──────────────────────┐
                    │ db: postgres:17-alpine                  │
                    │  wolumen webinv_pgdata, citext          │
                    └──────────────────────────────────────────┘
```

## 4. Przepływ żądania

```
GET /aplikacje  (przeglądarka, bez sesji)
  │
  ▼
nginx: location /  →  try_files … /index.html   (SPA)
nginx: location /api/  →  proxy_pass api:3000
  │  nagłówki: X-Real-IP, X-Forwarded-For, X-Forwarded-Proto
  ▼
Fastify (trustProxy: true)
  │  1. @fastify/helmet — nagłówki bezpieczeństwa (bez CSP: API nie serwuje dokumentów)
  │  2. ThrottlerGuard — 300 żądań/min na IP (limit logowania: osobno, z .env)
  │  3. AuthGuard — ciasteczko → sesja → użytkownik; @Public() omija wymóg sesji,
  │                   @RequirePermission() sprawdza uprawnienia,
  │                   flaga mustChangePassword dopuszcza tylko /auth/change-password
  │                   i sesje
  │  4. ValidationPipe — whitelist + forbidNonWhitelisted + transform
  ▼
Kontroler (routing, HTTP)
  ▼
Serwis (reguły biznesowe, walidacja referencji, dat, nazw)
  │  → AuditService.record() — najlepszy wysiłek, nie wywraca operacji biznesowej
  ▼
Prisma → PostgreSQL
```

Kolejność guardów jest jawna w `app.module.ts` i **znaczy**: throttling przed
autoryzacją, żeby zgadywanie haseł kończyło się 429, a nie 401.

## 5. API

### Moduły

```
AppModule
├── ConfigModule         walidacja zmiennych środowiskowych (brak sekretu → koniec startu)
├── ThrottlerModule      globalny limit + osobny limit logowania (@Throttle)
├── PrismaModule         PrismaService (extends PrismaClient)
├── AuthModule           sesje, hasła, uprawnienia, guard, kontroler /api/auth
├── UsersModule          /api/users (konta)
├── AuditModule          /api/audit (dziennik) + AuditService dla pozostałych modułów
├── ApplicationsModule   /api/applications (rejestr)
├── IpamModule           /api/ipam (katalog podsieci, adresów i przypisań)
├── AccessModule         /api/access (macierz uprawnień — katalog osób i przypisań)
├── SettingsModule       /api/settings (tryb demonstracyjny; tabela `settings`)
├── GlpiModule           /api/glpi (integracja GLPI — współdzieli `settings`)
└── SeedModule           dane startowe po starcie aplikacji
```

### Ustawienia i tryb demonstracyjny

Tabela `settings` (model `Setting`) to prosty magazyn klucz–wartość
spod jednej trasy `/api/settings` tylko dla super administratora. Tryb demo
używa klucza `demo.*` — seed pyta `SettingsService` o stan trybu, dlatego
`SettingsModule` jest zarejestrowany przed `SeedModule`.

### Integracja GLPI

`glpi/` to osobny moduł integrujący system GLPI: import osób,
oprogramowania (jako wpisy rejestru) i przypisań dostępów wynikających
z członkostwa w grupach GLPI. Konfiguracja siedzi w `settings` pod kluczami
`glpi.*`; sekrety są szyfrowane kluczem wywiedzonym z `SESSION_SECRET`
(`glpi-crypto`) i nie wracają do przeglądarki — GET pokazuje flagi `has*`,
a zapis przyjmuje `undefined` jako „nie ruszaj”.

Import jest dwuetapowy (podgląd → zapis), jak importy CSV i nmap. Zapis nie
ufa payloadowi z przeglądarki (rewalidacja każdego wiersza) i tworzy
**wyłącznie nowe** rekordy. Klient GLPI (`glpi-client.ts`) jest czystą
warstwą bez NestJS — testowalną bez bazy i bez kontenera — a serwis do bazy
podchodzi przez port `GlpiPort`, na wzór `AccessPort`/`IpamPort`.

### Katalog IPAM obok rejestru

`ipam/` stoi jako osobny moduł obok `applications/` i ma własny prefiks tras
`/api/ipam`: podsieci i adresy to dane sieciowe, które przeżywają wpisy
rejestru, więc mieszanie obu drzew w jednym prefiksie zrobiłoby z niego
worek. Jedyne sprzężenie idzie w jednym kierunku — `ApplicationsService.remove()`
pyta `IpamService` o zdjęcie przypisań przy soft delete (stąd eksport
`IpamService` z modułu i rejestracja `IpamModule` zaraz po
`ApplicationsModule`). Dwie trasy przypisań aplikacji rezydują w IPAM, ale
badają `app:read`/`app:write` — to widok karty aplikacji, nie katalogu.

We wnętrzu modułu dwa rozdzielenia są celowe. `cidr.ts` to osobna warstwa
czysta — bez Prisma i bez NestJS — bo rachunek na bitach (format CIDR,
nakładanie zakresów, zawieranie adresu) jest najłatwiejszym miejscem IPAM
na pomyłkę i musi dać się przetestować bez kontenera z bazą. Serwis z kolei
rozmawia z bazą przez `IpamPort` — wąski typ wyliczający dokładnie te
delegaty i metody, których serwis używa: runtime dostaje `PrismaService`
(spełnia port strukturalnie), ale testy budują serwis na atrapie rzuconej
na port, bez bazy, a rozjazd kontraktu jest błędem kompilacji, nie
runtime'u.

### Warstwy w kontrolerach i serwisach

- **Kontroler** — routing, kody HTTP, wstrzykiwanie `@CurrentUser()`,
  `@ClientIp()`, dekoratory `@Public()`, `@RequirePermission()`.
  Nie zawiera reguł biznesowych.
- **Serwis** — cała logika: walidacja krzyżowa (unikalność nazwy, istnienie
  użytkowników i środowisk, kolejność dat), budowa `where`/`orderBy` z białych
  list, scalanie PATCH-a, serializacja odpowiedzi, zapis do dziennika.
- **PrismaService** — cienka warstwa nad `PrismaClient`. Loguje tylko błędy:
  pełne zapytania z parametrami ujawniałyby dane osobowe.

### Walidacja

Globalny `ValidationPipe` działa w trybie najostrzejszym: `whitelist` usuwa
pola spoza DTO, `forbidNonWhitelisted` **zgłasza je jako błąd** (cichy drop
ukrywałby literówki w nazwach pól), `transform` zamienia ładunek na instancję
DTO. `enableImplicitConversion` jest wyłączone celowo — konwersja domyślna
działa *przed* własnym `@Transform` i zamieniała puste pola liczbowe na `0`.
Każde pole, które potrzebuje konwersji, ma własny `@Transform`
(`toOptionalNumber`, `emptyToUndefined`).

Konwencja PATCH-a (`undefined` = nie ruszaj, `null` = wyczyść) jest
konsekwentna w DTO, serwisie (`mapPatchDto`) i formularzu. `mapPatchDto`
porównuje mapowane pola ze zbiorem `CREATE_FIELDS` i rzuca wyjątkiem, gdy
pole z `mapDto` nie ma odpowiednika w DTO — inaczej PATCH mógłby po cichu
wyzerować pola nieobecne w ładunku.

### Sesje

- Token: 32 losowe bajty (64 znaki hex), wydawany **wyłącznie** w ciasteczku
  `webinv_sid` (`httpOnly`, `sameSite=lax`, `secure` z `COOKIE_SECURE`,
  `path=/`).
- W bazie trzymamy **wyłącznie skrót** tokenu (SHA-256). Wyciek bazy nie pozwala
  podszyć się pod istniejącą sesję.
- Wygasanie: `SESSION_TTL_DAYS` od wydania + **2 dni bezczynności**
  (`lastSeenAt`). Sesje wygasłe są usuwane leniwie — przy logowaniu, najwyżej
  raz na godzinę (licznik w pamięci procesu, nie w bazie). Nie ma crona w tym
  projekcie, więc sprzątanie dzieje się przy okazji.
- Zmiana hasła unieważnia **wszystkie** sesje użytkownika i od razu wydaje nową
  (także bieżącą). Reset hasła przez super admina i zmiana roli albo wyłączenie
  konta też kasują sesje — stare uprawnienia nie mogą działać.
- Sesje po stronie serwera można zobaczyć i zakończyć na stronie „Moje konto”.

### Hasła

Argon2id (`memoryCost=19456`, `timeCost=2`, `parallelism=1`). Polityka: min. 12,
maks. 200 znaków, mała i wielka litera, cyfra, znak specjalny, odrzucana lista
typowych haseł. Polityka jest **w jednym miejscu na każdym końcu** —
serwer (`apps/api/src/auth/password.ts`) i interfejs
(`apps/web/src/lib/password.ts`) — a test `password-parity.test.ts` pilnuje, żeby
rozjechały się dopiero zgłoszone. Weryfikacja dla nieistniejącego konta
wykonuje kosztowną operację na atrapie, żeby czas odpowiedzi nie zdradzał,
czy konto istnieje.

`SEED_ADMIN_PASSWORD` przechodzi **pełną** politykę haseł przy każdym starcie
kontenera, także gdy konto już istnieje: jego zmiana w `.env` po utworzeniu
konta i tak nie robiłaby nic, więc ciche zignorowanie byłoby bardziej mylące niż
błąd startu.

### Dziennik zdarzeń

`AuditService.record()` zapisuje zdarzenie „po najlepszym wysiłku" — błąd
audytu nie wywraca operacji biznesowej, trafia do logów. Zmiany liczone są
funkcją `AuditService.diff(before, after, ignore)`, która pomija pola
niezmienione (w tym `updatedAt`), a wartości tekstowe **przycina do 200
znaków** i dopisuje klucz `_truncated` z listą pól. Dzięki temu kolumna JSON
nie rośnie w nieskończoność, a interfejs nie udaje, że pokazuje pełną różnicę.

Lista zdarzeń dodatkowo przycina `changes`, gdy jego serializacja przekracza
2000 znaków.

## 6. Frontend

### Trasy

Trasy są **po polsku i bez diakrytyków** (`/aplikacje`, `/uzytkownicy`,
`/pulpit`, `/konto`, `/audyt`) — bezpieczniejsze w linkach, zakładkach i
skrótach.

```
AuthProvider (korzeń, wczytuje /auth/me)
├── /logowanie
├── AppLayout                     ← widok publiczny, bez sesji
│   ├── /                 → przekierowanie na /aplikacje (strona główna = rejestr)
│   ├── /aplikacje
│   └── /aplikacje/:id
├── RequireAuth                  ← sesja + wymuszona zmiana hasła
│   └── AppLayout
│       ├── /pulpit
│       ├── /konto
│       ├── /aplikacje/nowa        (app:write)
│       ├── /aplikacje/:id/edycja  (app:write)
│       ├── /uprawnienia           (access:read — macierz i katalog osób)
│       │   └── /uprawnienia/osoby/:id
│       ├── /ipam                  (sesja — cała gałąź IPAM jest za `RequireAuth`)
│       ├── /ipam/nowa             (ipam:write)
│       ├── /ipam/import           (ipam:write)
│       ├── /ipam/:id              (sesja)
│       ├── /ipam/:id/edycja       (ipam:write)
│       ├── /ustawienia            (widok główny — settings:write)
│       │   ├── /ustawienia/dziennik      (audit:read)
│       │   ├── /ustawienia/uzytkownicy   (user:read)
│       │   └── /ustawienia/glpi          (settings:write — integracja GLPI)
│       ├── /audyt        → przekierowanie na /ustawienia/dziennik (stare zakładki)
│       └── /uzytkownicy  → przekierowanie na /ustawienia/uzytkownicy
└── AppLayout → 404
```

Bramki tras (`RequireAuth`, `RequirePermission`) to wygoda, nie zabezpieczenie —
API sprawdza to samo niezależnie. Konto z `mustChangePassword` trafia wyłącznie
na `/konto`, a UI pilnuje tego, żeby nie robić pętli z API, które i tak odmawia.

### Dane

- **Klient HTTP** (`lib/api.ts`) — wszystkie żądania z `credentials: 'include'`,
  brak nagłówka `Authorization` (sesja siedzi w ciasteczku `httpOnly`, którego
  JS nie widzi). Błędy mapowane na `ApiError` z gotowymi komunikatami po polsku.
- **Hooki react-query** (`lib/queries.ts`) — bariera reeksportów nad
  modułami domenowymi (`queries-auth.ts`, `queries-settings.ts`,
  `queries-applications.ts`, `queries-ipam.ts`, `queries-users.ts`,
  `queries-audit.ts`, `queries-access.ts`). Klucze (`qk`) żyją wyłącznie
  w `queries-keys.ts`, żeby domeny nie importowały nawzajem bazy.
  Osobne `use*` dla zapytania i dla mutacji. `staleTime` dobrane
  per-zapytanie, `retry: false` dla 401/403 (to nie awaria sieciowa), czyszczenie
  cache po wylogowaniu.
- **Typy** (`types.ts`) — bariera reeksportów nad modułami domenowymi
  (`types-identity.ts`, `types-application.ts`, `types-ipam.ts`,
  `types-audit.ts`, `types-settings.ts`, `types-access.ts`, `types-ui.ts`,
  `types-glpi.ts`). Ręcznie pisane, bez generatora OpenAPI. Schemat Prisma
  jest źródłem prawdy; komentarze zaznaczają, które pola są **opcjonalne tylko
  dlatego, że publiczny odczyt ich nie zwraca** (`undefined` = „nie wolno ci
  tego widzieć”, `null` = „brak wartości”). Testy pilnujące zgodności
  interfejsu z API skanują tekst wszystkich `types*.ts` naraz — podział
  na pliki nie osłabia żadnej asercji.
- **Motyw** — skrypt `public/theme.js` ustawia klasę `dark` przed pierwszym
  renderem (brak migotania), przełącznik w `lib/theme.tsx` zapamiętuje wybór
  w `localStorage` (`rejestr-theme`).
- **Formatowanie** (`lib/format.ts`) — daty, kwoty (PLN), odliczanie dni do
  wycofania (`daysUntil`, `describeEol`), skrót długiego tekstu, inicjały.

## 7. Widok publiczny a pełny

Granica widoczności danych jest **jednym z najważniejszych miejsc w systemie**,
bo publiczny odczyt jest celową funkcją.

Pola znikające z odpowiedzi dla niezalogowanego czytelnika
(`PUBLIC_HIDDEN_FIELDS` w `applications.service.ts`):
`securityClass`, `criticality`, `ownerEmail` oraz blok dostarczenia i wsparcia
(`hostingLocation`, `adminTeam`, `supportOwnerType`, `supportOwnerName`,
`supportEmail`, `supportUrl`, `supportChannel`, `supportNotes`).

Granica biegnie po **znaczeniu**, nie po „nowości": `deliveryType` i
`baseUrl` zostają, bo to informacja technyczna — bez adresu dostępowego
publiczny widok nie odpowiada na pytanie „czy da się to otworzyć". Reszta
opisuje nasze wnętrze: kto u nas administruje, gdzie stoi i pod jakim
kontaktem dzwonić. E-mail do wsparcia jest tu szczególnie niewdzięczny —
bezsesyjny czytelnik nie ma powodu nim obciążać cudzego helpdesku.

Samo usunięcie pól nie wystarczyło — filtr i sortowanie działają w bazie, więc
gość odzyskałby ukryte wartości z **liczby wyników** albo z **kolejności
wierszy**. Dlatego widok publiczny działa na poziomie zapytania, a nie
serializacji:

| Przeklęka | Gość | Logika |
|---|---|---|
| Pola w odpowiedzi | ukryte | `toPublicView()` usuwa pola **z obiektu** |
| Filtry | ignorowane | `buildWhere(..., restrict)` pomija `securityClass`, `criticality`, `ownerEmail` |
| Sortowanie | ograniczone | `GUEST_SORTABLE` — brak `securityClass`, `criticality` |
| Wyszukiwanie | zawężone | brak wyszukiwania po adresie właściciela, nazwisku administratorów i danych bloku wsparcia (samo trafienie zdradzałoby, czyj to wpis) |
| Usunięte wpisy | niewidoczne | `includeDeleted` ignorowane dla gościa |

Zapis (`POST`/`PATCH`/`DELETE`) zawsze wymaga `app:write`, więc widok publiczny
jest z definicji tylko do odczytu. Ta sama granica jest pilnowana przez testy
`public-view.test.ts` i `public-filters.test.ts`.

## 8. Build i obrazy

Oba obrazy są wieloetapowe, a kontekstem buildu jest **katalog główny repo**
(npm workspaces wymaga manifestu głównego, lockfile'a i manifestów obu
pakietów).

**API** (`apps/api/Dockerfile`):

1. `deps` — `npm ci` z pamięcią podręczną npm (`--mount=type=cache`);
2. `build` — `prisma generate` + `nest build`;
3. `prod-deps` — `npm ci --omit=dev` + **ponowne** `prisma generate` (query engine
   musi pasować do platformy obrazu końcowego; klient z etapu `build` ma własne
   `node_modules` i nie trafiłby do obrazu) + strażnik `require('argon2')` —
   gdyby npm nie wyniósł natywnego modułu do rootowego `node_modules`, build
   kończy się od razu, a nie na starcie kontenera;
4. `runtime` — bez CLI Prisma i TypeScriptu, użytkownik `node` (nie root).

Punkt wejścia to skrypt, nie `dist/main.js`:
`node scripts/migrate.mjs && node dist/main.js`. Migracje stosowane są przez
`prisma migrate deploy` (bez pytania o interakcję i bez shadow database). Gdy
migracja padnie, kontener się nie podniesie — **lepiej brak usługi niż niespójne
dane**.

**Web** (`apps/web/Dockerfile`): `deps` → `tsc --noEmit && vite build` (typ
sprawdzany osobno, żeby błąd w typach nie zginął w głośnym błędzie bundlera) →
`nginx:alpine` z konfiguracją z katalogu `nginx/`.

`VITE_API_BASE_URL` jest wstrzykiwany jako argument buildu; domyślnie `/api`,
bo w produkcji nginx obsługuje tę ścieżkę i nie potrzebujemy pełnego URL.

## 9. Konfiguracja nginx

Pliki rozdzielone są ze względu na kontekst dyrektyw: `nginx.conf` (kontekst
główny i `http`), `default.conf` (`conf.d`, includowane wewnątrz `http`),
`snippets/security-headers.conf` (dołączany ręcznie).

Dwie własności, o których łatwo się potknąć — obie zabezpieczone testem
(`nginx-config.test.ts`):

1. **`add_header` w `location` zeruje nagłówki odziedziczone z `server`**, a nie
   je dokłada. Dlatego każdy `location`, który sam używa `add_header`
   (`/assets/`, `/index.html`, `/nginx-health`), ma `include` nagłówków.
2. **CSP jest ustawione tylko w jednym miejscu** — w `snippets/`. API ma
   `contentSecurityPolicy: false`, bo zwraca wyłącznie JSON, a polityka CSP
   obowiązuje dokument, nie odpowiedź na `fetch`. Wcześniej CSP było wyłączone
   w dwóch miejscach naraz i nikt tego nie zauważył — stąd test, który sprawdza,
   że polityka jest zdefiniowana dokładnie raz i pasuje do realiów buildu.

Cache: pliki `/assets/` mają hash w nazwie → `max-age=31536000, immutable`;
`index.html` ma `no-store, must-revalidate` (inaczej użytkownik dostałby starą
aplikację po wdrożeniu).

## 10. Decyzje i ich koszt

| Decyzja | Powód | Koszt / ograniczenie |
|---|---|---|
| Publiczny odczyt rejestru | dostawca i audytor sprawdzają obecność aplikacji bez konta | gość nie widzi właściciela, klasyfikacji ani krytyczności; filtr i sort po tych polach ignorowane |
| Sesje w bazie zamiast JWT | natychmiastowe unieważnienie (wylogowanie, reset hasła, zmiana roli) | jedno zapytanie do bazy na żądanie |
| Soft delete aplikacji | dziennik zdarzeń i historia przypisań muszą zostać czytelne | osobne flagi `deletedAt` w każdym zapytaniu; przywracanie przez `POST /:id/restore` |
| Sesje w roli: guard, nie w logice kontrolera | nie da się zapomnieć o sprawdzeniu w nowym kontrolerze | dekoratory trzeba nałożyć świadomie (brak endpointu = dostęp wymagający sesji) |
| Limit logowania liczony na IP | prosty i skuteczny przeciw zgadywaniu haseł | za NAT/ VPN wielu użytkowników dzieli limit; brak limitu per konto |
| Throttle w pamięci procesu | brak infrastruktury (Redis) w tym projekcie | nie działa poprawnie przy więcej niż jednej instancji API i po restarcie z resetuje |
| Własne formatowanie dat i kwot w UI | pełna kontrola nad formatem PL i brak zależności | więcej kodu niż biblioteka |
| Jeden wolumen `pgdata` | prosty backup i restore | brak HA i replikacji |
| Typ dostarczenia jako enum zamiast słownika | nie planujemy dodawać typów z poziomu UI; zbiór jest zamknięty, a od niego zależy, czy w rekordzie ma sens blok „hosting i wsparcie” | nowy typ wymaga migracji Prisma, nie kliknięcia w UI |
| Dane wsparcia przetrwają zmianę typu na `GENERAL_USE` | zmiana typu to zmiana opisu, a nie skasowanie wiedzy; powrót do `SAAS` odsłania dane, które nadal są aktualne | rekord `GENERAL_USE` może mieć ukryte, wypełnione pola — dlatego UI warunkowo je pokazuje |
| Walidacja bloku wsparcia miękka (wsystko opcjonalne) | rejestr ma opisywać to, co wiemy; brak kontaktu do wsparcia nie może blokować zapisu | nie wymusimy kompletności opisu usługi — jakość zależy od użytkownika |
| Brak roli „gość” w bazie | gość nie ma sesji, więc nie ma użytkownika | brak śladu, kto oglądał publiczny widok (celowo — to nie jest wymagane) |
| Import GLPI tworzy tylko nowe rekordy | rejestr ma odwzorowywać stan GLPI, nie zarządzać nim; zapis nie może nadpisać tego, co człowiek dopisał ręcznie | zmiany w GLPI wymagają ponownego importu albo ręcznej aktualizacji wpisów |
| Sekrety GLPI szyfrowane kluczem z `SESSION_SECRET` | konfiguracja trafia do bazy razem z resztą ustawień, a sekrety nie mogą leżeć jawnie | obrót `SESSION_SECRET` unieważnia zapisane sekrety — trzeba je wpisać ponownie |
| `overrides` (fastify, deepmerge-ts) w głównym `package.json` | naprawa podatności bez skoku major (NestJS/Prisma); `@nestjs/platform-fastify` sam dokleja starszy fastify | po podbitech major NestJS/Prisma override'y można usunąć (`fastify: 5.12.7`, `deepmerge-ts: ^8.0.0`) |

## 11. Macierz uprawnień

Moduł `apps/api/src/access/` trzyma katalog osób (`persons`) i macierz
przypisań (`application_access`) — kto ma dostęp do której aplikacji
i na jakim poziomie.

Granica zakresu jest tu zasadnicza: **to ewidencja, nie mechanizm nadania
dostępu.** System nie wystawia tokenów, nie tworzy kont osobom z macierzy
i nie umawia im niczego w narzędziu IAM. Osoba z ewidencji nie ma konta
w panelu i nie musi się logować. Dostęp nadaje się poza systemem, a rejestr
odpowiada na pytanie „komu go nadano i kiedy".

Dwie konsekwencje tej granicy, widoczne w kodzie:

- **Osoby to osobna tabela, nie `users`.** Konto panelu ma login, hasło,
  rolę i sesje — nic z tego nie dotyczy osoby z ewidencji. Trzymanie ich
  w jednej tabeli wymuszałoby wypełnianie pustych pól i gniecenie historii
  przy kasowaniu, dlatego osobę **dezaktywujemy** (`isActive=false`),
  a jej przypisania zostają widoczne.
- **Wygasłe przypisanie zostaje w macierzy.** `expiresOn` to data wygasania,
  nie usunięcie: wiersz z datą w przeszłości jest historią nadania i pokazuje
  się z ostrzeżeniem.

Serwis rozmawia z bazą przez wąski port `AccessPort` (`access.port.ts`), tak
samo jak IPAM przez `IpamPort` — dzięki temu cała logika (kolejność sprawdzeń,
walidacja, budowa `changes` dla dziennika) testuje się bez bazy. W produkcji
pod port podawany jest `PrismaService` przez token `ACCESS_PORT`.

Import osób z CSV (`access/csv.ts`, endpointy `import/preview` i `import/apply`)
wypełnia **tylko katalog osób**. Dostęp do aplikacji nadaje się ręcznie,
bo plik z eksportu Workspace nie jest wiarygodnym źródłem uprawnień.
Podgląd klasyfikuje wiersze (`NEW` / `UPDATE` / `ERROR`), a zapis waliduje je
ponownie — między krokami jest przerwa w pracy, w której dane mogą się
zmienić.

## 12. Granice systemu

Czego tu **nie ma** świadomie (szczegóły i rekomendacje:
[../SECURITY.md](../SECURITY.md)):

- TLS — nginx w kontenerze nasłuchuje na HTTP; terminację robi reverse proxy
  przed nim (`COOKIE_SECURE=true`, po zdjęciu `upgrade-insecure-requests` z CSP
  dopiero wraz z TLS);
- uwierzytelnianie dwuskładnikowe, logowanie SSO/LDAP/OIDC;
- limit rozmiaru i retencja dziennika zdarzeń oraz sesji poza sprzątaniem;
- powiadomienia o nadchodzącym wycofaniu (jest licznik na pulpicie, brak
  e-maili/webhooków);
- mechanizm zgłoszeń o dostęp do aplikacji — flaga
  `accessRequestRequired` jest informacją, nie procesem;
- nadawanie dostępu do aplikacji z poziomu systemu — macierz jest
  ewidencją (patrz [11. Macierz uprawnień](#11-macierz-uprawnień));
  brak integracji z IAM, eksportu do IAM i mechanizmu zatwierdzania.
