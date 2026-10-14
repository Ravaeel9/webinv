# Instalacja

Instrukcja dla administratora serwera: jak postawić Rejestr Oprogramowania
od zera, jak go sprawdzić i czym się posługiwać na co dzień.

Czytaj od góry — pierwsze trzy sekcje wystarczą, żeby uruchomić aplikację.
Sekcje od „Co zrobić zaraz po instalacji” w dół są potrzebne przy
wdrażaniu na stałe.

## W skrócie

```bash
git clone <adres-repozytorium> /opt/webinv
cd /opt/webinv
./install.sh
```

Skrypt zadaje trzy pytania (port, HTTPS, hasło administratora), sam
wygeneruje wszystkie sekrety, uruchomi kontenery i sprawdzi, czy aplikacja
odpowiada. Na końcu wypisze adres i dane logowania.

Aplikacja: `http://<adres-serwera>:8080` · konto: `admin`

## Wymagania

| | Wymaganie |
|---|---|
| System | Linux (AMD64 lub ARM64) |
| Docker | Engine 24+ z Compose **v2** (`docker compose`, nie `docker-compose`) |
| Pamięć | 1 GB RAM na działanie. Na czas pierwszej instalacji (budowa obrazów) **1 GB + swap albo 2 GB** — patrz „Mało pamięci” niżej |
| Miejsce | ~3 GB na obrazy i dane |
| Port | jeden wolny port na zewnątrz — domyślnie `8080` |
| Dostęp do konta | konto musi należeć do grupy `docker` albo uruchamiasz skrypt przez `sudo` |

Nie trzeba instalować Node.js, PostgreSQL ani nginx — całość jest w
obrazach kontenerów.

Sprawdzenie, czy Docker jest gotowy:

```bash
docker version && docker compose version
```

Jeśli `docker info` zgłasza brak uprawnień:

```bash
sudo usermod -aG docker "$USER"   # potem wyloguj się i zaloguj ponownie
```

## Wariant 1 — instalator (zalecany)

```bash
cd /opt/webinv
./install.sh
```

### Co robi instalator, krok po kroku

| Krok | Co sprawdza / robi |
|---|---|
| 1/8 Wymagania | Docker, Compose v2, działający daemon, dostępność wzorca `.env.example` |
| 2/8 Zasoby | dostępna pamięć RAM, wolne miejsce na dysku, obecność swapu; w razie potrzeby włącza tryb oszczędny |
| 3/8 Konfiguracja | tworzy `.env`, generuje `SESSION_SECRET` (64 znaki) i hasło bazy, ustawia prawa `600` na pliku |
| 4/8 Port i HTTPS | pyta o port i czy przed aplikacją będzie HTTPS |
| 5/8 Administrator | ustawia login, e-mail i hasło startowe super administratora (sprawdza je tą samą polityką, co aplikacja) |
| 6/8 Budowa obrazów | `docker compose build` z widocznym postępem i zegarem; pełny log w pliku wskazanym na ekranie |
| 7/8 Uruchomienie | `docker compose up -d` — osobny krok, żeby błąd startu nie mylił się z błędem builda |
| 8/8 Weryfikacja | czeka, aż baza, API i aplikacja będą zdrowe, i sprawdza odpowiedź HTTP |

### Mało pamięci (VPS z 1 GB RAM)

Budowanie obrazów to jedyny etap instalacji, który potrafi przekroczyć
gigab RAM — obraz API ma dwa pełne `npm ci`, obraz web jeden. Instalator
mierzy dostępną pamięć przed budową i sam włącza tryb oszczędny
(limit sterty Node + budowanie serwisów po kolei), gdy zostanie mniej
niż 900 MB. Tryb można też włączyć ręcznie:

```bash
./install.sh --low-memory      # albo: make install-lowmem
```

Jeśli zobaczysz ostrzeżenie o braku swapu, dodaj go — jednorazowo,
jedna komenda na serwer:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Budowanie trwa wtedy dłużej, ale się kończy. Postęp i czas pokazuje
instalator na ekranie, a pełny log zapisuje w pliku wskazanym po
budowie — tam też warto zajrzeć, gdy build padnie z `Killed`
(oznaka OOM-killa) albo `JavaScript heap out of memory`.

### Budowanie poza instalatorem

`make up`, `make build` i `make rebuild` też budują serwisy po kolei
(`COMPOSE_PARALLEL_LIMIT=1`) — na jednym vCPU nie traci to na
prędkości, a obniża szczytowe zużycie RAM. Limit sterty ustawisz
zmienną `NODE_OPTIONS`, np. `NODE_OPTIONS=--max-old-space-size=768 make build`.

Instalator jest **idempotentny**: uruchomiony ponownie nie kasuje danych,
nie zmienia sekretów i nie nadpisuje ustawień w `.env`.

Jeśli hasło zostało wygenerowane losowo, instalator wypisuje je na ekraz
raz i **usunie je z `.env`** — hasło nadal trzeba zmienić przy pierwszym
logowaniu, więc nie zostaje na dysku w jawnej postaci.

### Opcje instalatora

```bash
./install.sh --help
```

| Opcja | Zastosowanie |
|---|---|
| `-y`, `--unattended` | bez pytań — do automatyzacji; wymaga `--admin-password` |
| `--port 8080` | port aplikacji na hoście |
| `--admin-password '…'` | hasło startowe administratora |
| `--admin-user`, `--admin-email`, `--admin-name` | dane konta administratora |
| `--cookie-secure true` | ciasteczko tylko przez HTTPS |
| `--no-start` | przygotować `.env`, ale nie uruchamiać kontenerów |
| `--low-memory` | wymuś tryb oszczędny na maszynie z ~1 GB RAM (patrz „Mało pamięci”) |
| `--new-env` | nowy `.env` od zera (stary zostaje jako `.env.bak.<data>`); unieważnia zalogowane sesje |

Przykład instalacji bez interakcji (np. w automatyzacji):

```bash
./install.sh -y --port 80 --cookie-secure true \
  --admin-user admin --admin-email admin@firma.local \
  --admin-password 'Kf3!xRdm9#vQ2'
```

## Wariant 2 — bez instalatora

Ręcznie, krok po kroku (te same efekty, bez automatycznej weryfikacji):

```bash
cd /opt/webinv
cp .env.example .env
chmod 600 .env

# sekrety — zapisz je w .env
openssl rand -hex 32     # → SESSION_SECRET
openssl rand -hex 24     # → POSTGRES_PASSWORD
openssl rand -base64 24  # → SEED_ADMIN_PASSWORD (musisz wpisać własne,
                         #   bo hasła startowego nie da się zapamiętać z base64)

docker compose up -d --build
```

Na maszynie z 1 GB RAM dodaj `COMPOSE_PARALLEL_LIMIT=1` i ogranicz
stertę Node, np.:

```bash
COMPOSE_PARALLEL_LIMIT=1 NODE_OPTIONS=--max-old-space-size=768 \
  docker compose up -d --build
```

Trzy zmienne są **wymagane** — bez nich kontener API celowo nie wstaje:
`SESSION_SECRET` (min. 32 znaki), `POSTGRES_PASSWORD`,
`SEED_ADMIN_PASSWORD`. Polityka hasła administratora: minimum 12 znaków,
mała i wielka litera, cyfra i znak specjalny.

Hasła z cudzysłowem (`"`), znakiem `$` lub odwrotnym ukośnikiem (`\`)
wpisz w cudzysłowy wewnętrzne pliku `.env` — Compose podstawia w nich
zmienne. Instalator odrzuca te znaki, żeby nie było niespodzianek.

## Pierwsze logowanie

```
Adres:   http://<adres-serwera>:8080
Login:   admin            (SEED_ADMIN_USERNAME w .env)
Hasło:   to, które podałeś na instalacji
```

Przy pierwszym wejściu aplikacja **wymusi zmianę hasła** — to się dzieje
po stronie API, nie da się tego obejść interfejsem.

Kolejne uruchomienia kontenera **nie nadpisują** hasła. Zmiana
`SEED_ADMIN_PASSWORD` w `.env` po utworzeniu konta nie robi nic
(hasło resetuje się w panelu administratora). Ten sam warunek dotyczy
polityki haseł: słabe hasło w `.env` zatrzymuje start kontenera, nawet
gdy konto już istnieje — dzięki temu nie przegapisz starej konfiguracji.

## Co zrobić zaraz po instalacji

- [ ] **Zmień hasło administratora** przy pierwszym logowaniu.
- [ ] **Ustaw `COOKIE_SECURE=true` w `.env`**, jeśli aplikacja jest za HTTPS,
      i wykonaj `docker compose up -d`. Bez tego ciasteczko sesji działa
      także po HTTP.
- [ ] **Ogranicz dostęp firewallem** do portu `APP_PORT`. Sama aplikacja nie
      ma listy dozwolonych adresów — ktoś, kto dotrze do portu, zobaczy
      publiczny rejestr i będzie mógł próbować się logować (limit logowania
      10 prób / 15 min na IP to jedyna ochrona przed zgadywaniem haseł).
- [ ] **Sprawdź, że kopia bazy się tworzy**: `make backup`. Kopie trzymaj
      **poza katalogiem projektu** — zawierają nazwiska, adresy e-mail
      i koszty licencji.
- [ ] **Nie wypychaj `.env` do repozytorium.** Plik jest w `.gitignore`,
      a instalator ustawia na nim prawa `600`.

## Weryfikacja, że wszystko działa

```bash
make ps                # kontenery i ich healthchecki — wszystkie „healthy”

curl -fsS http://localhost:8080/nginx-health    # serwer plików
curl -fsS http://localhost:8080/api/health      # {"status":"ok",…}
curl -fsS http://localhost:8080/api/health/ready
# {"status":"ready","database":"up"}
```

`/api/health` sprawdza żywotność procesu, `/api/health/ready` dodatkowo
połączenie z bazą. Druga odpowiedź to najprostszy test „czy cały stos
działa”, bo przechodzi przez nginx do API i bazy.

## Codzienna obsługa

Wszystko kręci się wokół `Makefile` (pełna lista: `make help`).

| Polecenie | Kiedy |
|---|---|
| `make ps` | czy kontenery działają |
| `make logs` | logi na żywo (wszystkie kontenery) |
| `make logs api=api` | logi tylko API |
| `make restart` | restart bez przebudowy |
| `make down` / `make up` | zatrzymanie / uruchomienie (dane zostają) |
| `make backup` | kopia bazy do `backups/backup-YYYYMMDD-HHMMSS.sql.gz` |
| `make restore f=backups/…` | przywrócenie kopii (nadpisuje obecne dane) |
| `make psql` | konsola PostgreSQL |
| `make rebuild` | przebudowa obrazów bez cache |
| `make reset` | **kasuje bazę i wolumen** (pyta o potwierdzenie) |

Bez `make` wystarczą odpowiedniki: `docker compose ps`,
`docker compose logs -f api`, `docker compose restart`,
`docker compose down`.

Logi kontenerów są limitowane (10 MB × 3 na kontener), więc nie rosną
w nieskończoność. Przy dużym ruchu warto je wyeksportować.

## Narzędzia administratora — import adresów z pliku nmap

Katalog IPAM pozwala zasilić podsieci wynikiem skanu `nmap` bez udziału
serwera aplikacji w skanowaniu sieci:

1. Na stacji roboczej lub serwerze mającym dostęp do badanej podsieci
   zainstaluj pakiet `nmap`.
2. Wykonaj szybki przegląd hostów z zapisem do pliku XML (pełne wykrywanie
   ARP/ICMP wymaga uprawnień administracyjnych na stacji skanującej):
   ```bash
   sudo nmap -sn -oX wynik.xml 10.20.0.0/24
   ```
3. W interfejsie aplikacji przejdź do **Adresy IP → Importuj z nmap**,
   wskaż plik `wynik.xml`, przejrzyj podgląd trzech grup (nowe, istniejące,
   nieprzypisane) i zatwierdź wybrane pozycje.

Konto administratora systemu na serwerze `web-inv` nie jest do tego
potrzebne — kontener API nie wykonuje `nmap`, a plik powstaje na stacji,
do której administrator sieci ma dostęp, i trafia przez przeglądarkę jako
zwykły formularz.

## Aktualizacja

```bash
cd /opt/webinv
make backup               # zawsze przed migracją
git pull
make rebuild && make up
```

Migracje bazy stosują się same przy starcie kontenera API. Jeśli migracja
padnie, kontener nie wstanie i logi powiedzą dlaczego — to celowe, żeby nie
puszczać aplikacji na niespójnej bazie.

## Kopia zapasowa i odtworzenie

```bash
make backup
make restore f=backups/backup-20261002-061500.sql.gz
```

Przywracanie nadpisuje aktualny stan — na produkcji zatrzymaj aplikację
najpierw (`make down`), przywróć, potem `make up`. Kopia, której nie
przetestowałeś, nie jest kopią: odtwórz ją choć raz na środowisku
testowym.

## Rozwiązywanie problemów

| Objaw | Co zrobić |
|---|---|
| `Brak Dockera` / `Nie mogę kontynuować bez działającego Dockera` | `systemctl status docker`; uprawnienia: `sudo usermod -aG docker $USER` i ponowne logowanie |
| `Brak Docker Compose v2` | zaktualizuj Docker Engine — stary `docker-compose` (v1) nie jest obsługiwany |
| Kontener `web` nie wstaje | `make logs api=api` — nginx startuje dopiero po zdrowym API; najczęściej migracja albo zły sekret w `.env` |
| `api` w pętli restartu | brak `SESSION_SECRET` / `POSTGRES_PASSWORD` / `SEED_ADMIN_PASSWORD`, `SESSION_SECRET` krótszy niż 32 znaki albo za słabe hasło administratora |
| `db` nie wstaje | `docker compose logs db` — najczęściej nieistniejący wolumen lub brak `POSTGRES_PASSWORD`; wolumen `webinv_pgdata` trzyma schemat z pierwszego `initdb` |
| 502 zamiast strony | `web` nie widzi `api` — sprawdź `make ps` i healthcheck API |
| „Sesja wygasła” przy każdym żądaniu | za krótki `SESSION_TTL_DAYS`, zmieniony `SESSION_SECRET`, zegary kontenera |
| Bardzo wolne listy | baza: indeksy pokrywają główne filtry; sprawdź `make psql` i `EXPLAIN` |
| Adres nie odpowiada z innego komputera | zamknij port w firewalu albo użyj adresu IP/DNS serwera zamiast `localhost` |

## Przeniesienie na inny serwer

1. Na starym serwerze: `make backup`.
2. Skopiuj katalog projektu (bez `node_modules`) i `backups/…sql.gz`.
3. Na nowym serwerze: `./install.sh`, potem `make down`,
   `make restore f=…`, `make up`.
4. Na nowym serwerze nadaj kontom odpowiednie prawa i sprawdź healthchecki.

## Odinstalacja

```bash
make down
docker volume rm webinv_pgdata   # KASUJE wszystkie dane — potwierdź świadomie
```

Zanim to zrobisz, wykonaj `make backup`. `make reset` robi dokładnie to
samo (z potwierdzeniem) wraz z porządkowaniem obrazów.

## Czego instalator nie robi

Żeby nie było nieporozumień — po instalacji nadal odpowiada za:

- **HTTPS** — kontener nasłuchuje na HTTP; TLS terminuje reverse proxy
  przed nim (nginx na hoście, Caddy, Traefik). Szczegóły i kolejność
  kroków: [WDROZENIE.md](WDROZENIE.md#https).
- **Firewalla i ograniczenia dostępu** — konfiguracja jest poza kontenerami.
- **Kopii zapasowych** — instalator ich nie planuje; trzeba ustawić
  harmonogram (np. `cron` z `make backup` i kopiowanie poza serwer).
- **Monitoringu** — endpointy `/api/health` i `/api/health/ready` są gotowe
  do podpięcia, ale nic ich nie odpytuje.
- **Wysokiej dostępności** — jedna instancja API, jeden wolumen bazy.
  Świadome ograniczenia: [WDROZENIE.md](WDROZENIE.md#granice-i-skalowanie).

## Więcej

| Chcę… | Czytam |
|---|---|
| szczegóły wdrożenia produkcyjnego, HTTPS, granice skalowania | [WDROZENIE.md](WDROZENIE.md) |
| bezpieczeństwo, świadome ograniczenia, zgłaszanie podatności | [../SECURITY.md](../SECURITY.md) |
| jak działa aplikacja od środka | [ARCHITEKTURA.md](ARCHITEKTURA.md) |
| wszystkie zmienne środowiskowe | [.env.example](../.env.example) |