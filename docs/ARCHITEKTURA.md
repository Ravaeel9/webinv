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
jest egzekwowana **po stronie serwera** — patrz [§6](#6-widok-publiczny-a-pełny).

## 2. Komponenty

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

## 3. Przepływ żądania

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

## 4. API

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
└── SeedModule           dane startowe po starcie aplikacji
```

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

## 5. Frontend

### Trasy

Trasy są **po polsku i bez diakrytyków** (`/aplikacje`, `/uzytkownicy`,
`/pulpit`, `/konto`, `/audyt`) — bezpieczniejsze w linkach, zakładkach i
skrótach.

```
AuthProvider (korzeń, wczytuje /auth/me)
├── /logowanie
├── AppLayout                     ← widok publiczny, bez sesji
│   ├── /                 → lista aplikacji (strona główna = rejestr)
│   ├── /aplikacje
│   └── /aplikacje/:id
├── RequireAuth                  ← sesja + wymuszona zmiana hasła
│   └── AppLayout
│       ├── /pulpit
│       ├── /konto
│       ├── /aplikacje/nowa        (app:write)
│       ├── /aplikacje/:id/edycja  (app:write)
│       ├── /uzytkownicy           (user:read)
│       └── /audyt                 (audit:read)
└── AppLayout → 404
```

Bramki tras (`RequireAuth`, `RequirePermission`) to wygoda, nie zabezpieczenie —
API sprawdza to samo niezależnie. Konto z `mustChangePassword` trafia wyłącznie
na `/konto`, a UI pilnuje tego, żeby nie robić pętli z API, które i tak odmawia.

### Dane

- **Klient HTTP** (`lib/api.ts`) — wszystkie żądania z `credentials: 'include'`,
  brak nagłówka `Authorization` (sesja siedzi w ciasteczku `httpOnly`, którego
  JS nie widzi). Błędy mapowane na `ApiError` z gotowymi komunikatami po polsku.
- **Hooki react-query** (`lib/queries.ts`) — jeden plik, jeden zestaw kluczy
  (`qk`), osobne `use*` dla zapytania i dla mutacji. `staleTime` dobrane
  per-zapytanie, `retry: false` dla 401/403 (to nie awaria sieciowa), czyszczenie
  cache po wylogowaniu.
- **Typy** (`types.ts`) — ręcznie pisane, bez generatora OpenAPI. Schemat Prisma
  jest źródłem prawdy; komentarze zaznaczają, które pola są **opcjonalne tylko
  dlatego, że publiczny odczyt ich nie zwraca** (`undefined` = „nie wolno ci
  tego widzieć”, `null` = „brak wartości”).
- **Motyw** — skrypt `public/theme.js` ustawia klasę `dark` przed pierwszym
  renderem (brak migotania), przełącznik w `lib/theme.tsx` zapamiętuje wybór
  w `localStorage` (`rejestr-theme`).
- **Formatowanie** (`lib/format.ts`) — daty, kwoty (PLN), odliczanie dni do
  wycofania (`daysUntil`, `describeEol`), skrót długiego tekstu, inicjały.

## 6. Widok publiczny a pełny

Granica widoczności danych jest **jednym z najważniejszych miejsc w systemie**,
bo publiczny odczyt jest celową funkcją.

Pola znikające z odpowiedzi dla niezalogowanego czytelnika
(`PUBLIC_HIDDEN_FIELDS` w `applications.service.ts`):
`securityClass`, `criticality`, `ownerEmail`.

Samo usunięcie pól nie wystarczyło — filtr i sortowanie działają w bazie, więc
gość odzyskałby ukryte wartości z **liczby wyników** albo z **kolejności
wierszy**. Dlatego widok publiczny działa na poziomie zapytania, a nie
serializacji:

| Przeklęka | Gość | Logika |
|---|---|---|
| Pola w odpowiedzi | ukryte | `toPublicView()` usuwa pola **z obiektu** |
| Filtry | ignorowane | `buildWhere(..., restrict)` pomija `securityClass`, `criticality`, `ownerEmail` |
| Sortowanie | ograniczone | `GUEST_SORTABLE` — brak `securityClass`, `criticality` |
| Wyszukiwanie | zawężone | brak wyszukiwania po adresie właściciela i nazwisku administratorów (samo trafienie zdradzałoby, czyj to wpis) |
| Usunięte wpisy | niewidoczne | `includeDeleted` ignorowane dla gościa |

Zapis (`POST`/`PATCH`/`DELETE`) zawsze wymaga `app:write`, więc widok publiczny
jest z definicji tylko do odczytu. Ta sama granica jest pilnowana przez testy
`public-view.test.ts` i `public-filters.test.ts`.

## 7. Build i obrazy

Oba obrazy są wieloetapowe, a kontekstem buildu jest **katalog główny repo**
(npm workspaces wymaga manifestu głównego, lockfile'a i manifestów obu
pakietów).

**API** (`apps/api/Dockerfile`):

1. `deps` — `npm ci` z pamięcią podręczną npm (`--mount=type=cache`);
2. `build` — `prisma generate` + `nest build`;
3. `prod-deps` — `npm ci --omit=dev` + **ponowne** `prisma generate` (query engine
   musi pasować do platformy obrazu końcowego; klient z etapu `build` ma własne
   `node_modules` i nie trafiłby do obrazu);
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

## 8. Konfiguracja nginx

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

## 9. Decyzje i ich koszt

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
| Brak roli „gość” w bazie | gość nie ma sesji, więc nie ma użytkownika | brak śladu, kto oglądał publiczny widok (celowo — to nie jest wymagane) |

## 10. Granice systemu

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
  `accessRequestRequired` jest informacją, nie procesem.
