# Wdrożenie

Instrukcja dla operatora: uruchomienie na serwerze, konfiguracja, kopie
zapasowe, aktualizacje i granice skalowania.

## Wymagania

| | |
|---|---|
| Docker Engine | 24+ z Compose v2 |
| CPU / RAM | 1 vCPU, 1 GB RAM (zapas na build — 2 GB) |
| System | Linux (ARM64 i amd64) |
| Port | jeden z zewnątrz: `APP_PORT` (domyślnie 8080) |

Nie trzeba instalować Node.js ani PostgreSQL na hoście — wszystko jest w
obrazach.

## Pierwsze uruchomienie

```bash
git clone <adres-repo> /opt/webinv
cd /opt/webinv

cp .env.example .env
# sekrety:
openssl rand -hex 32    # → SESSION_SECRET
openssl rand -base64 24 # → SEED_ADMIN_PASSWORD (musi spełniać politykę haseł)
```

Albo `make init`, które wypełnia `SESSION_SECRET` i `POSTGRES_PASSWORD`
losowymi wartościami; `SEED_ADMIN_PASSWORD` trzeba ustawić ręcznie, bo kontener
celowo nie wstanie ze słabym hasłem administracyjnym.

```bash
make up
```

Kolejność startu jest gwarantowana healthcheckami: baza → API (migracje →
proces) → nginx. Aplikacja: `http://<adres>:8080`.

Pierwsze logowanie: `SEED_ADMIN_USERNAME` (domyślnie `admin`) —
konto **wymusi zmianę hasła**. Kolejne starty kontenera nie nadpisują hasła;
`SEED_ADMIN_PASSWORD` służy tylko do utworzenia konta.

## Konfiguracja produkcyjna

| Zmienna | Ustawienie produkcyjne |
|---|---|
| `APP_PORT` | port, pod którym ma być widoczna aplikacja |
| `COOKIE_SECURE` | `true` **wymagane**, jeśli ruch idzie przez HTTPS |
| `SESSION_TTL_DAYS` | domyślnie 7 dni ważności + 2 dni bezczynności |
| `CORS_ORIGINS` | puste = same-origin (zalecane przy nginx); wpisz domeny tylko gdy API ma być dostępne z innego origin |
| `LOGIN_RATE_LIMIT_MAX` / `_WINDOW` | domyślnie 10 / `15m` na IP |
| `SEED_ADMIN_*` | tylko przy pierwszym uruchomieniu; hasło w `.env` to sekret włós |

Nie ustawiaj `CORS_ORIGINS` na `*` — nie działa to z ciasteczkami
(`credentials`) i niepotrzebnie otwiera API.

### HTTPS

Kontener nasłuchuje na HTTP; **TLS terminuje reverse proxy przed nim**
(np. nginx na hoście, Caddy, Traefik, load balancer).

Rozpocznij od:

1. `COOKIE_SECURE=true` w `.env`, potem `make restart`;
2. przekierowanie `http → https` na proxy (301/308);
3. dopiero potem w `nginx/snippets/security-headers.conf` dodaj
   `upgrade-insecure-requests` do CSP i `Strict-Transport-Security`.

Kolejność jest istotna: `upgrade-insecure-requests` przepisuje zasoby na
`https://`, więc w aplikacji bez TLS wycina dostęp do wdrożenia. HSTS dodaj
dopiero, gdy HTTPS działa poprawnie — inaczej przeglądarki zapamiętają
nieistniejące HSTS i użytkownicy nie wrócą na HTTP.

### Kto może się zalogować

Nie ma listy dozwolonych adresów ani ograniczenia do sieci wewnętrznej —
każdy, kto dotrze do portu, może zobaczyć publiczny rejestr i spróbować
zalogować się (limit logowania to jedyna ochrona przed zgadywaniem haseł).
Jeśli rejestr nie ma być dostępny z Internetu, ogranicz dostęp na poziomie
firewall/proxy, nie w aplikacji.

## Codzienna obsługa

```bash
make ps                # status i healthchecki
make logs              # logi wszystkich kontenerów
make logs api=api      # tylko API
make restart           # restart bez przebudowy
make down              # zatrzymanie (dane zostają)
```

Logi kontenerów są limitowane (10 MB × 3 na kontener) — nie rosną w
nieskończoność, ale przy dużym ruchu warto je wyeksportować.

Weryfikacja po restarcie:

```bash
curl -fsS http://localhost:8080/nginx-health   # ok
curl -fsS http://localhost:8080/api/health     # {"status":"ok",…}
curl -fsS http://localhost:8080/api/health/ready  # {"status":"ready","database":"up"}
```

## Kopie zapasowe

```bash
make backup                                   # → backups/backup-YYYYMMDD-HHMMSS.sql.gz
make restore f=backups/backup-20260930-171642.sql.gz
```

Kopia to `pg_dump` z kontenera bazy. Przywracanie nadpisuje aktualny stan —
na produkcji zatrzymaj najpierw aplikację (`make down`), przywróć, potem
`make up`.

Zalecenia:

- kopie trzymaj **poza** katalogiem repozytorium (to dane wrażliwe: nazwiska,
  adresy e-mail, koszty licencji);
- sprawdź, że kopia daje się odtworzyć — kopia, której nie testowano, nie jest
  kopią;
- `backups/` jest w `.gitignore`, więc nie wpadnie do repozytorium;
- rozważ osobny wolumen lub katalog poza katalogiem projektu, żeby
  `docker compose down -v` (w `make reset`) nie zabrał kopii.

## Aktualizacja

```bash
cd /opt/webinv
git pull
make rebuild      # przebudowa obrazów (bez cache)
make up
```

Migracje stosują się same przy starcie kontenera API
(`node scripts/migrate.mjs && node dist/main.js`). Jeśli migracja się nie
powiedzie, kontener nie wstaje i logi jasno mówią dlaczego — to celowe,
żeby nie puszczać aplikacji na niespójnej bazie.

Przed migracją zdarzeń destrukcyjnych (usunięcie kolumny, zmiana typu na
węższy) zrób `make backup`.

## Rozwiązywanie problemów

| Objaw | Co sprawdzić |
|---|---|
| `web` nie wstaje | `make logs api=api` — nginx startuje dopiero po zdrowym API; najczęściej migracja albo zły sekret w `.env` |
| `api` w pętli restartu | brak `SESSION_SECRET`/`SEED_ADMIN_PASSWORD` (wymagane), `SESSION_SECRET` < 32 znaki, słabe `SEED_ADMIN_PASSWORD` |
| `db` nie wstaje | `docker compose logs db` — najczęściej nieistniejący wolumen lub brak `POSTGRES_PASSWORD`; `pgdata` trzyma schemat z pierwszego `initdb` |
| 502 zamiast strony | `web` nie widzi `api` — sprawdź `make ps` i healthcheck API |
| „Sesja wygasła” przy każdym żądaniu | za krótki `SESSION_TTL_DAYS`, zmieniony `SESSION_SECRET`, zegary kontenera |
| Bardzo wolne listy | baza: indeksy z [BAZA-DANYCH.md](BAZA-DANYCH.md) pokrywają główne filtry; sprawdź `make psql` i `EXPLAIN` |

## Granice i skalowanie

- **Jedna instancja API.** Liczniki limitu zapytań i sprzątanie sesji żyją w
  pamięci procesu. Druga instancja bez wspólnego magazynu (Redis) zepsuje
  limity — to ograniczenie świadome, nie pominięcie.
- **Bez HA.** Jeden wolumen `pgdata`, jeden kontener bazy, `restart:
  unless-stopped`. Awaria hosta = niedostępność; odtworzenie z kopii
  (`make restore`) albo z wyłączoną wysoką dostępnością.
- **Sesje w bazie** — jedno zapytanie na żądanie do autoryzacji. Przy bardzo
  dużym ruchu pierwszym krokiem byłby cache sesji, ale nie jest potrzebny przy
  skali organizacyjnej.
- **Wolumen nie jest w katalogu projektu** (`webinv_pgdata`), więc
  `docker compose down -v` go usuwa — to samo robi `make reset`. Kopia
  zapasowa przed tymi operacjami jest obowiązkowa.
- **Publiczny widok jest bez limitu poza limitem 300 żądań/min na IP.** Jeśli
  rejestr ma być szeroko dostępny, rozważ cache na proxy dla
  `GET /api/applications` i `GET /api/applications/:id`.

Dokumentacja modelu bezpieczeństwa i świadomych ograniczeń:
[../SECURITY.md](../SECURITY.md).
