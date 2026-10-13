# Rejestr Oprogramowania

Aplikacja webowa do prowadzenia rejestru oprogramowania używanego w organizacji:
jakie aplikacje mamy, kto za nimi odpowiada, w jakich środowiskach działają, ile
kosztują i kiedy mają zostać wycofane.

Rejestr ma **dwa widoki**:

- **publiczny** (bez logowania) — lista i szczegóły aplikacji, okrojone o pola
  poufne (klasyfikacja bezpieczeństwa, krytyczność, właściciel);
- **panel** (po zalogowaniu) — pełne dane, pulpit ze statystykami, edycja,
  katalog podsieci i adresów IP (IPAM), zarządzanie użytkownikami, dziennik
  zdarzeń, eksport CSV.

Dzięki temu ktoś spoza organizacji (np. dostawca, audytor) może sprawdzić,
czy dana aplikacja w ogóle u nas jest, bez znajomości loginu i hasła.
IPAM — mapa sieci wewnętrznej: podsieci, adresy i ich przypisania do
aplikacji self-hosted — należy wyłącznie do panelu; żaden jego endpoint
nie jest publiczny.

## Stan projektu

| | |
|---|---|
| Wersja | z `package.json` (pole `version`), podbijana przez `make release` — widoczna w prawym dolnym rogu interfejsu |
| Środowisko produkcyjne | Docker Compose (3 kontenery) |
| Baza danych | PostgreSQL 17 + Prisma 6 |
| Testy | 705 przypadków, `npm test`, bez bazy danych |
| Licencja | brak — repozytorium prywatne, kod własnością organizacji |

## Stos technologiczny

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

## Wymagania

Do uruchomienia całości (Docker) wystarczy:

- Docker Engine 24+ z Compose v2
- wolne ~1 GB RAM na działanie; na pierwszą instalację (budowa obrazów)
  **1 GB + swap albo 2 GB**

Do pracy nad kodem (poza Dockerem):

- Node.js ≥ 22
- npm 10+

## Instalacja

Jedno polecenie — kreator sprawdza wymagania, generuje sekrety, uruchamia
kontenery i weryfikuje, że aplikacja odpowiada:

```bash
./install.sh
```

Prowadzi krok po kroku: zasoby maszyny, port, HTTPS, hasło administratora.
Szczegółowa instrukcja dla administratora serwera:
**[docs/INSTALACJA.md](docs/INSTALACJA.md)**.

Na VPS-ie z ~1 GB RAM dodaj `--low-memory` — kreator ograniczy wtedy stertę
Node i zbuduje obrazy po kolei:

```bash
./install.sh --low-memory      # albo: make install-lowmem
```

Bez kreatora (albo do prac lokalnych):

```bash
make init     # tworzy .env z losowymi sekretami (SESSION_SECRET, POSTGRES_PASSWORD)
# edytuj .env i ustaw SEED_ADMIN_PASSWORD — min. 12 znaków, mała i wielka litera,
# cyfra i znak specjalny
make up       # buduje i uruchamia cały stos
```

Aplikacja: <http://localhost:8080> · healthcheck: <http://localhost:8080/nginx-health>

Konto super administratora (`SEED_ADMIN_USERNAME`, domyślnie `admin`) powstaje
przy pierwszym uruchomieniu i **wymusza zmianę hasła** przy pierwszym
logowaniu. Kolejne starty nie nadpisują hasła — zmiana w `.env` po utworzeniu
konta nie robi nic (konto zostawiamy w spokoju; hasło resetuje się z panelu).

Zarówno `make init`, jak i `install.sh` są idempotentne — istniejącego
`.env` nie ruszają.

### Aktualizacja po zmianie kodu

Po każdej aktualizacji użyj `make release` — jedyna droga, która podbija
wersję, buduje obraz i sprawdza, że wersja faktycznie dotarła do
interfejsu:

```bash
git pull                 # pobierz zmiany
make migrate             # tylko jeśli doszła zmiana w schema.prisma
make release             # 1.0.0 → 1.0.1, build, start, tag v1.0.1, push
```

Budowanie przez `docker compose build` wprost pomija podstawienie
`APP_VERSION`, więc plakietka w interfejsu pokaże `v0.0.0-dev`. Szczegóły
kroków: [CONTRIBUTING.md](CONTRIBUTING.md#wydanie-zmiana-kodu--działająca-aplikacja).

## Polecenia

Wszystko kręci się wokół `Makefile`; pełna lista: `make help`.

| Polecenie | Co robi |
|---|---|
| `make install` | kreator instalacji na serwerze (to samo co `./install.sh`) |
| `make install-lowmem` | j.w. na VPS-ie z ~1 GB RAM (`./install.sh --low-memory`) |
| `make release` | **wydanie**: podbija wersję, buduje, uruchamia, weryfikuje i wypycha na GitHub |
| `make init` | `.env` z losowymi sekretami (raz, przy pierwszym uruchomieniu) |
| `make up` | buduje obrazy i uruchamia stos na `APP_PORT` (domyślnie 8080) |
| `make up-dev` | j.w., ale baza wystawiona na hoście na `DB_DEV_PORT` |
| `make down` | zatrzymuje kontenery (dane zostają) |
| `make logs api=api` | logi na żywo (`make logs` = wszystkie) |
| `make ps` / `make restart` | status kontenerów / restart bez przebudowy |
| `make backup` / `make restore f=…` | kopia `pg_dump` do `backups/` / przywracanie |
| `make migrate` | `prisma migrate dev` poza Dockerem (wymaga włączonej bazy) |
| `make studio` | Prisma Studio na porcie 5555 |
| `make dev-api` / `make dev-web` | API w trybie watch (3000) / Vite dev server (5173) |
| `make typecheck` | `tsc --noEmit` w obu pakietach |
| `make reset` | **kasuje bazę** i wolumen (pyta o potwierdzenie) |

Skrypty npm dostępne też bezpośrednio: `npm run dev:api`, `npm run dev:web`,
`npm run build`, `npm test`, `npm run typecheck`, `npm run prisma:*`.

## Struktura repozytorium

```
.
├── apps/
│   ├── api/                 # NestJS + Prisma (CommonJS)
│   │   ├── prisma/          # schema.prisma + migracje
│   │   ├── src/
│   │   │   ├── applications/ # rejestr aplikacji (REST)
│   │   │   ├── audit/        # dziennik zdarzeń
│   │   │   ├── auth/         # sesje, hasła, uprawnienia, guardy
│   │   │   ├── ipam/         # podsieci i adresy IP (REST, walidacja CIDR)
│   │   │   ├── users/        # zarządzanie kontami
│   │   │   ├── config/       # walidacja zmiennych środowiskowych
│   │   │   ├── prisma/       # klient Prisma jako injectable
│   │   │   └── seed/         # dane startowe + konto SUPER_ADMIN
│   │   └── test/             # testy (node:test + tsx)
│   └── web/                 # React SPA (ESM)
│       ├── public/theme.js  # skrypt motywu przed pierwszym renderem
│       └── src/
│           ├── components/   # layout, bramki tras, biblioteka UI
│           ├── lib/          # klient HTTP, hooki react-query, formatowanie
│           └── pages/        # widoki
├── docker/init/             # skrypty initdb (rozszerzenia PostgreSQL)
├── nginx/                   # konfiguracja serwera (nginx.conf, default.conf, nagłówki)
├── docs/                    # dokumentacja (nie trafia do obrazów — patrz .dockerignore)
├── .env.example             # wzorzec konfiguracji
├── install.sh               # kreator instalacji na serwerze (docs/INSTALACJA.md)
├── docker-compose.yml       # stos produkcyjny
├── docker-compose.dev.yml   # nakładka deweloperska (port bazy na hoście)
└── Makefile                 # wszystkie polecenia operacyjne
```

## Jak to działa

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

Baza **nie wystawia portu na host** w trybie produkcyjnym — jest osiągalna
tylko z sieci wewnętrznej Compose. Jedyny port na zewnątrz to ten z
`APP_PORT`.

Szczegóły: [docs/ARCHITEKTURA.md](docs/ARCHITEKTURA.md).

## Role i uprawnienia

Uprawnienia sprawdzane są **w API** (guard), a UI tylko je odwzorowuje przy
renderowaniu nawigacji i przycisków.

| Rola | Uprawnienia |
|---|---|
| `VIEWER` (Obserwator) | `app:read`, `user:read`, `audit:read`, `ipam:read` |
| `ADMIN` (Administrator) | `app:read`, `app:write`, `user:read`, `audit:read`, `ipam:read`, `ipam:write` |
| `SUPER_ADMIN` (Super administrator) | wszystko: `app:read`, `app:write`, `user:read`, `user:write`, `audit:read`, `ipam:read`, `ipam:write`, `settings:write` |

Adresy IP to mapa infrastruktury — dlatego `ipam:*` są oddzielnymi
uprawnieniami, nie pochodnymi `app:*`; katalog wymaga sesji, gość nie widzi
nawet liczby podsieci.

Pełna tabela endpointów: [docs/API.md](docs/API.md). Konto z hasłem nadanym
przez administratora wchodzi wyłącznie na `/konto` — wymusi to guard, nie
interface.

## Konfiguracja

Cała konfiguracja siedzi w `.env` (wzorzec: [.env.example](.env.example)).
Zmienne wymagane — kontener nie wstanie bez nich:

| Zmienna | Opis |
|---|---|
| `POSTGRES_PASSWORD` | hasło użytkownika bazy |
| `SESSION_SECRET` | sekret sesji, ≥ 32 znaki (`openssl rand -hex 32`) |
| `SEED_ADMIN_PASSWORD` | hasło konta super administratora, polityka haseł wymuszana przy starcie |

Pozostałe zmienne (`APP_PORT`, `SESSION_TTL_DAYS`, `COOKIE_SECURE`, `CORS_ORIGINS`,
`LOGIN_RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_WINDOW`, `DB_DEV_PORT`, …) mają wartości
domyślne; opis w [.env.example](.env.example) i [docs/WDROZENIE.md](docs/WDROZENIE.md).

## Testy

```bash
npm test        # 705 przypadków: walidacja DTO, audyt, CIDR/IPAM, hasła, konfiguracja nginx, kontrast UI
make typecheck  # tsc --noEmit w API i web
```

Testy nie potrzebują bazy danych ani kontenerów — `node:test` przez `tsx`.

`npm test` najpierw buduje interfejs (`npm run test:web-build`, czyli
`tsc --noEmit && vite build`), bo część testów sprawdza **zbudowany**
CSS w `apps/web/dist/assets` — między `index.css` a tym, co widzi
użytkownik, stoi LightningCSS, który potrafi po cichu zgubić regułę.
Sam `npm run test --workspace @webinv/api` bez wcześniejszego builda
zakończy się błędem `brak apps/web/dist/assets`.
Obejmują m.in. walidację ładunków (tak jak w produkcji), scalenie PATCH-a,
bialą listę sortowania, różnicę w dzienniku zdarzeń, spójność polityki haseł
serwer–interfejs oraz zgodność konfiguracji nginx z tym, co naprawdę ładuje
build frontendu. Lista plików: [docs/ROZWOJ.md](docs/ROZWOJ.md#testy).

CI uruchamia oba polecenia na każdym pushu: [.github/workflows/ci.yml](.github/workflows/ci.yml).

## Dokumentacja

Administrator serwera zaczyna od **[docs/INSTALACJA.md](docs/INSTALACJA.md)**.
Reszta dokumentacji:

| Plik | Zawartość |
|---|---|
| [docs/INSTALACJA.md](docs/INSTALACJA.md) | instalacja krok po kroku, weryfikacja, codzienna obsługa, problemy |
| [docs/ARCHITEKTURA.md](docs/ARCHITEKTURA.md) | komponenty, przepływ żądania, decyzje projektowe i ich uzasadnienie |
| [docs/API.md](docs/API.md) | wszystkie endpointy, parametry, błędy, sesje |
| [docs/BAZA-DANYCH.md](docs/BAZA-DANYCH.md) | modele, pola, indeksy, migracje |
| [docs/ROZWOJ.md](docs/ROZWOJ.md) | praca lokalna, testy, konwencje, typowe problemy |
| [docs/WDROZENIE.md](docs/WDROZENIE.md) | instalacja produkcyjna, HTTPS, kopie zapasowe, limity skalowania |
| [SECURITY.md](SECURITY.md) | model bezpieczeństwa, świadome ograniczenia, checklista przed wystawieniem |
| [CONTRIBUTING.md](CONTRIBUTING.md) | konwencje, przegląd zmian, migracje |

## Dane i prywatność

- `.env`, `backups/` i `graphify-out/` **nigdy nie trafiają do repozytorium**
  (patrz `.gitignore` i `.dockerignore`).
- Repozytorium jest **prywatne**; w obrazach kontenerów nie ma dokumentacji ani
  sekretów.
- Kopie zapasowe bazy (`backups/*.sql.gz`) zawierają komplet danych rejestru —
  traktuj je jak dane wrażliwe.

## Licencja

Brak. Kod jest własnością organizacji; repozytorium prywatne, bez pliku
`LICENSE` i bez deklaracji licencji w `package.json`.
