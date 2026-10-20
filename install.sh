#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  Rejestr Oprogramowania — instalator
#
#  Jedno polecenie stawia cały stos: sprawdza wymagania,
#  tworzy `.env` z losowymi sekretami, pyta o hasło administratora,
#  buduje i uruchamia kontenery oraz weryfikuje, że aplikacja
#  odpowiada. Na końcu wypisuje adres i dane logowania.
#
#  Uruchomienie:
#     ./install.sh                      # tryb z pytaniami
#     ./install.sh -y --admin-password '…'   # bez pytań (automatyzacja)
#     ./install.sh --help
#
#  Skrypt jest idempotentny: ponowne uruchomienie nie kasuje danych
#  i nie nadpisuje istniejących sekretów w `.env`.
# ─────────────────────────────────────────────────────────────

# shellcheck disable=SC1111
# SC1111: polskie cudzysłowy „…” wewnątrz tekstów są tu zamierzone —
# komunikaty mają czytać się jak zwykłe zdania, nie jak kod.
set -euo pipefail

# Katalog skryptu = katalog projektu. Compose, `.env` i `Makefile`
# muszą być widziane z tego samego miejsca, więc niezależnie od tego,
# skąd administrator uruchomił skrypt, przechodzimy do źródła.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE=".env"
ENV_EXAMPLE=".env.example"

# ── Wygląd ───────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[36m'
  C_OFF=$'\033[0m'
else
  C_BOLD=''; C_DIM=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_OFF=''
fi

STEP_NO=0
# Liczba kroków instalatora. Trzymana w zmiennej, a nie w literale
# w `step`, bo kroki dodajemy i usuwamy — przy twardym „/6” numeracja
# rozjeżdża się z rzeczywistością przy pierwszej zmianie.
TOTAL_STEPS=9

step() {
  STEP_NO=$((STEP_NO + 1))
  printf '\n%s── %d/%d %s %s\n' "$C_BLUE" "$STEP_NO" "$TOTAL_STEPS" "$1" "$C_OFF"
}

banner() {
  printf '\n%s── %s %s\n' "$C_BLUE" "$1" "$C_OFF"
}
ok()   { printf '   %s✓%s %s\n' "$C_GREEN" "$C_OFF" "$1"; }
info() { printf '   %s\n' "$1"; }
warn() { printf '   %s!%s %s\n' "$C_YELLOW" "$C_OFF" "$1"; }
die()  { printf '\n   %s✗ %s%s\n\n' "$C_RED" "$1" "$C_OFF" >&2; exit 1; }

# ── Argumenty ────────────────────────────────────────────────
UNATTENDED=0
START_STACK=1
NEW_ENV=0
ARG_PORT=""
ARG_ADMIN_USER=""
ARG_ADMIN_EMAIL=""
ARG_ADMIN_NAME=""
ARG_ADMIN_PASSWORD=""
ARG_COOKIE_SECURE=""
ARG_DEMO_DATA=""

usage() {
  cat <<'EOF'
Instalator Rejestru Oprogramowania.

Użycie:
  ./install.sh [opcje]

Opcje:
  -y, --unattended          Bez pytań. Wymaga --admin-password
                           (albo zmiennej SEED_ADMIN_PASSWORD).
      --port <numer>       Port aplikacji na hoście (domyślnie z .env, albo 8080)
      --admin-user <login>           Login super administratora (domyślnie admin)
      --admin-email <adres>          E-mail administratora (domyślnie admin@firma.local)
      --admin-name "<imię>"          Imię i nazwisko (domyślnie "Administrator Systemu")
      --admin-password "<hasło>"     Hasło startowe; losowe, gdy pominięte
      --cookie-secure true|false     Ciasteczko Secure (dla HTTPS)
      --demo-data true|false   Dane demonstracyjne: przykładowe aplikacje,
                           macierz dostępu i podsieci IP (domyślnie false)
      --new-env           Nadpisz istniejący .env (UWAGA: nowe sekrety sesji
                           unieważniają zalogowane sesje)
      --no-start          Tylko przygotuj .env, nie uruchamiaj kontenerów
      --low-memory        Wymuś tryb oszczędny: ograniczona sterta Node i
                          serwisy budowane po kolei (dla VPS-ów z ~1 GB RAM)
  -h, --help               Ta pomoc

Przykłady:
  ./install.sh
  ./install.sh -y --port 80 --cookie-secure true --admin-password 'Kf3!xRdm9#vQ2'
  ./install.sh --low-memory
EOF
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      -y|--unattended)  UNATTENDED=1 ;;
      --no-start)       START_STACK=0 ;;
      --low-memory)     LOW_MEMORY=1 ;;
      --new-env)        NEW_ENV=1 ;;
      --port)           ARG_PORT="${2:-}"; shift ;;
      --admin-user)     ARG_ADMIN_USER="${2:-}"; shift ;;
      --admin-email)    ARG_ADMIN_EMAIL="${2:-}"; shift ;;
      --admin-name)     ARG_ADMIN_NAME="${2:-}"; shift ;;
      --admin-password) ARG_ADMIN_PASSWORD="${2:-}"; shift ;;
      --cookie-secure)  ARG_COOKIE_SECURE="${2:-}"; shift ;;
      --demo-data)      ARG_DEMO_DATA="${2:-}"; shift ;;
      -h|--help)        usage; exit 0 ;;
      *)                printf 'Nieznana opcja: %s\n\n' "$1" >&2; usage >&2; exit 2 ;;
    esac
    shift
  done
}

ask() {
  # ask <pytanie> <wartość domyślna>  → wynik na stdout
  local prompt="$1" default="$2" answer
  if [ -t 0 ]; then
    IFS= read -r -p "   ${prompt} [${default}]: " answer </dev/tty
  else
    printf '%s' "$default"
    return 0
  fi
  printf '%s' "${answer:-$default}"
}

ask_yes_no() {
  # ask_yes_no <pytanie> <domyślnie: y|n>  → 0 gdy tak
  local prompt="$1" default="$2" answer hint
  case "$default" in y) hint="T/n" ;; *) hint="t/N" ;; esac
  IFS= read -r -p "   ${prompt} [${hint}]: " answer </dev/tty
  answer="${answer:-$default}"
  [ "$answer" = "y" ] || [ "$answer" = "Y" ] || [ "$answer" = "t" ] || [ "$answer" = "T" ]
}

# ── Sekrety ──────────────────────────────────────────────────
random_hex() {
  #openssl jest na praktycznie każdym serwerze, ale /dev/urandom
  # jako zapasowy generator nie zależy od niczego poza jądrem.
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    od -An -tx1 -N "$1" /dev/urandom | tr -d ' \n'
  fi
}

strong_password() {
  # Składniki dobrane tak, żeby hasło zawsze przechodziło politykę:
  # mała litera, wielka litera, cyfra i znak specjalny są gwarantowane
  # przez stałe fragmenty, a entropia pochodzi z 24 znaków hex
  # (12 bajtów z `random_hex`).
  printf 'Wb9-%s-Zx!' "$(random_hex 12)"
}

password_errors() {
  # Zwraca listę powodów odrzucenia na stdout, pusta lista = hasło OK.
  # Reguły muszą odpowiadać validatePasswordStrength() w API —
  # inaczej instalator przepuściłby hasło, którego kontener odmówi.
  local p="$1" errs=()
  local lower="${p,,}"

  [ "${#p}" -lt 12 ] && errs+=("minimum 12 znaków (ma ${#p})")
  [ "${#p}" -gt 200 ] && errs+=("maksimum 200 znaków (ma ${#p})")

  case "$lower" in
    password|password1|password123|admin|admin123|administrator|qwerty|\
    123456789012|letmein12345|changeme123|zaq12wsx)
      errs+=("to hasło jest zbyt popularne — wybierz inne") ;;
  esac

  [[ "$p" =~ [a-z] ]] || errs+=("wymaga małej litery")
  [[ "$p" =~ [A-Z] ]] || errs+=("wymaga wielkiej litery")
  [[ "$p" =~ [0-9] ]] || errs+=("wymaga cyfry")
  [[ "$p" =~ [^A-Za-z0-9] ]] || errs+=("wymaga znaku specjalnego")

  # Wartość trafia do .env i jest czytana przez Compose, więc cudzysłowy
  # i znaki podstawienia trzeba odrzucić — inaczej kontener dostałby
  # inny sekret niż administrator wpisał.
  [[ "$p" == *'"'* ]] && errs+=('nie może zawierać " (cudzysłowu)')
  [[ "$p" == *'$'* ]] && errs+=('nie może zawierać $ — Compose podstawia tam zmienne')
  [[ "$p" == *'\'* ]] && errs+=('nie może zawierać \ (odwrotnego ukośnika)')
  [[ "$p" == *$'\n'* ]] && errs+=("nie może zawierać znaków nowej linii")

  printf '%s\n' "${errs[@]:-}"
  [ "${#errs[@]}" -eq 0 ]
}

read_password() {
  # Czytanie bez echa. Wymaga terminala — bez niego prosimy
  # o --admin-password, żeby hasło nie trafiło na listę procesów.
  local prompt="$1" p1 errs
  if [ ! -t 0 ]; then
    die "Brak terminala do bezpiecznego wpisania hasła. Użyj --admin-password „…”."
  fi
  while true; do
    printf '   %s' "$prompt" >&2
    IFS= read -rs p1 </dev/tty
    printf '\n' >&2
    # Nie sprawdzamy tu `password_errors ... | grep -q .`: przy
    # `pipefail` status potoku to 1 z funkcji (a nie z grepa), więc
    # `!` uznałby błędne hasło za poprawne. Porównujemy treść wyjścia.
    errs="$(password_errors "$p1")" || true
    if [ -z "$errs" ]; then
      printf '   %s✓%s Hasło spełnia wymagania.\n' "$C_GREEN" "$C_OFF" >&2
      printf '%s' "$p1"
      return 0
    fi
    printf '   %s✗%s Hasło nie spełnia wymagań:\n' "$C_RED" "$C_OFF" >&2
    printf '%s\n' "$errs" | sed 's/^/     · /' >&2
  done
}

# ── Obsługa .env ─────────────────────────────────────────────
env_get() {
  local key="$1" default="${2:-}" line
  line="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n 1 || true)"
  # Cudzysłów w rozwinięciu: bez niego klucz byłby wzorcem glob,
  # a nie literałem — klucz ze znakami `*` lub `?` dopasowałby za dużo.
  line="${line#"${key}"=}"
  # Zdejmij cudzysłowy, jeśli ktoś wpisał wartość w cudzysłowach
  line="${line%\"}"; line="${line#\"}"
  line="${line%\'}"; line="${line#\'}"
  printf '%s' "${line:-$default}"
}

env_set() {
  # Przepisuje plik przez awk, a nie sed: hasła administratora
  # zawierają &, / i #, które w sed są znakami specjalnymi.
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  KEY="$key" VALUE="$value" awk '
    BEGIN { key = ENVIRON["KEY"]; value = ENVIRON["VALUE"]; found = 0 }
    index($0, key "=") == 1 { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$ENV_FILE" >"$tmp"
  mv "$tmp" "$ENV_FILE"
}

# ── Krok 1: wymagania ────────────────────────────────────────
check_requirements() {
  step "Sprawdzam wymagania"

  command -v docker >/dev/null 2>&1 \
    || die "Brak Dockera. Zainstaluj Docker Engine 24+ ze strony https://docs.docker.com/engine/install/ i zacznij od nowa."

  local compose_version
  if ! compose_version="$(docker compose version --short 2>/dev/null)"; then
    die "Brak Docker Compose v2 (polecenie „docker compose”). Zaktualizuj Docker Engine — Compose v1 (docker-compose) nie jest obsługiwany."
  fi
  ok "Docker Engine $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?'), Compose ${compose_version}"

  if ! docker info >/dev/null 2>&1; then
    printf '\n'
    warn "Docker nie odpowiada — albo demon nie działa, albo brak uprawnień."
    info  "Sprawdź:  systemctl status docker"
    info  "Uprawnienia:  sudo usermod -aG docker \$USER   (potem wyloguj się i zaloguj ponownie)"
    info  "Alternatywnie uruchom skrypt przez sudo:  sudo ./install.sh"
    printf '\n'
    die "Nie mogę kontynuować bez działającego Dockera."
  fi
  ok "Daemon Dockera działa"

  command -v openssl >/dev/null 2>&1 \
    && ok "openssl dostępny (generowanie sekretów)" \
    || warn "Brak openssl — użyję /dev/urandom"

  [ -f "$ENV_EXAMPLE" ] || die "Brak pliku $ENV_EXAMPLE w katalogu $SCRIPT_DIR."
  ok "Wzorzec konfiguracji: $ENV_EXAMPLE"
}

# ── Krok 2: zasoby maszyny ────────────────────────────────────
# Budowa obrazów jest jedynym etapem instalacji, który potrafi
# przekroczyć gigab RAM: trzy pełne `npm ci` (dwa w API, jeden
# we webie). Dlatego sprawdzamy zasoby ZANIM cokolwiek zbudujemy,
# a nie wtedy, gdy instalator padnie z OOM-killem.
LOW_MEMORY=0

mem_available_mb() {
  # MemAvailable z /proc/meminfo mówi ile RAM jest realnie do dyspozycji
  # (po cache jądra), więc jest trafniejszy niż MemTotal. W kontenerach
  # i na części dystrybucji pliku nie ma — wtedy sięgamy po `free`.
  # Oba źródła dają wartość w KILOBAJTACH: /proc/meminfo ma kolumnę kB,
  # a `free -k` wymusza kB (domyślny `free -m` dałby MB — po dzieleniu
  # przez 1024 wynik byłby 1024× zaniżony i tryb oszczędny włączałby
  # się fałszywie).
  local kb
  kb="$(awk '/^MemAvailable:/ {print $2; exit}' /proc/meminfo 2>/dev/null || true)"
  if [ -z "$kb" ]; then
    kb="$(free -k 2>/dev/null | awk '/^Mem:/ {print $7}')"
  fi
  case "$kb" in
    ''|*[!0-9]*) return 1 ;;
  esac
  printf '%s' "$((kb / 1024))"
}

has_swap() {
  # Sprawdzamy ROZMIAR swapu, nie to, ile jest aktualnie zajęte:
  # szukamy rady „dodaj swap”, a niewykorzystany swap właśnie jest
  # tym, czego brakuje. `free` ma w wierszu „Swap:” tylko trzy
  # liczby (total, used, free) — czwarta i dalsze to puste, stąd $2.
  local total
  total="$(free -k 2>/dev/null | awk '/^Swap:/ {print $2}')"
  case "$total" in
    ''|*[!0-9]*) return 1 ;;
    0) return 1 ;;
  esac
  return 0
}

check_resources() {
  step "Sprawdzam zasoby maszyny"

  local mem
  if mem="$(mem_available_mb)"; then
    if [ "$mem" -lt 900 ]; then
      LOW_MEMORY=1
      warn "Mało dostępnej pamięci: ${mem} MB"
      info "Włączam tryb oszczędny — budowa pójdzie wolniej, ale się uda."
    else
      ok "Dostępne pamięci: ${mem} MB"
    fi
  else
    warn "Nie umiem odczytać ilości pamięci — pomijam sprawdzenie."
  fi

  if [ "$LOW_MEMORY" = "1" ] && ! has_swap; then
    warn "Brak swapu. To najczęstsza przyczyna OOM-killa przy budowie."
    info "Dodaj swap poleceniem (jednorazowo):"
    printf '     %s\n' "sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile"
  fi

  # Dokumentacja mówi o ~3 GB na obrazy i dane. Nie blokujemy, bo
  # katalog docelowy może być montowany z innego dysku — ostrzegamy.
  local avail_mb
  avail_mb="$(df -Pk "$SCRIPT_DIR" 2>/dev/null | awk 'NR==2 {print $4}')"
  case "$avail_mb" in
    ''|*[!0-9]*) : ;;
    *)
      avail_mb=$((avail_mb / 1024))
      if [ "$avail_mb" -lt 4096 ]; then
        warn "Mało miejsca na dysku: ${avail_mb} MB wolnego w $SCRIPT_DIR"
        info "Aplikacja potrzebuje ok. 3 GB na obrazy i dane."
      else
        ok "Wolnego miejsca na dysku: ${avail_mb} MB"
      fi
      ;;
  esac

  # Budujemy serwisy po kolei zawsze, nie tylko przy małym RAM.
  # Równoległy build dwóch obrazów na 1 vCPU nie jest szybszy, a
  # podwaja szczytowe zużycie pamięci.
  export COMPOSE_PARALLEL_LIMIT=1
  if [ "$LOW_MEMORY" = "1" ]; then
    # Limit sterty dociera do buildów przez build.args w compose.yml.
    export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=768}"
    ok "Tryb oszczędny: limity Node ustawione"
  fi
}

# ── Krok 3: konfiguracja (.env) ──────────────────────────────
prepare_env() {
  step "Przygotowuję konfigurację (.env)"

  REUSED_ENV=0
  if [ -f "$ENV_FILE" ]; then
    if [ "$NEW_ENV" = "1" ]; then
      warn "Tworzę nowy .env na Twoje życzenie (--new-env)."
      info  "Stare sesje przestaną działać — hasła i konta w bazie zostają."
      cp "$ENV_FILE" ".env.bak.$(date +%Y%m%d-%H%M%S)"
      info  "Kopię starego pliku: $(ls -t .env.bak.* | head -n 1)"
      cp "$ENV_EXAMPLE" "$ENV_FILE"
    else
      REUSED_ENV=1
      ok "Plik .env już istnieje — używam go (sekretów nie zmieniam)"
    fi
  else
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    ok "Utworzyłem .env na podstawie .env.example"
  fi

  # Uzupełniam tylko to, czego brakuje — nie ma tu żadnych wartości
  # domyślnych dla sekretów, bo kontener i tak ich wymaga.
  local secret
  if [ -z "$(env_get SESSION_SECRET)" ]; then
    secret="$(random_hex 32)"
    env_set SESSION_SECRET "$secret"
    ok "SESSION_SECRET — wygenerowany (64 znaki)"
  else
    ok "SESSION_SECRET — już ustawiony"
  fi

  if [ -z "$(env_get POSTGRES_PASSWORD)" ]; then
    secret="$(random_hex 24)"
    env_set POSTGRES_PASSWORD "$secret"
    ok "POSTGRES_PASSWORD — wygenerowany (48 znaków)"
  else
    ok "POSTGRES_PASSWORD — już ustawiony"
  fi

  # Plik z sekretami nie powinien być czytelny dla innych użytkowników
  # serwera (np. współdzielonego konta, kontenerów innych osób).
  chmod 600 "$ENV_FILE"
}

# ── Krok 4: port i ciasteczka ────────────────────────────────
configure_port() {
  step "Ustawiam port i zabezpieczenie ciasteczek"

  local port="${ARG_PORT}"
  if [ -z "$port" ]; then
    port="$(env_get APP_PORT 8080)"
    if [ "$UNATTENDED" = "0" ]; then
      port="$(ask 'Port, pod którym ma być dostępna aplikacja' "$port")"
    fi
  fi
  case "$port" in
    ''|*[!0-9]*) die "Port musi być liczbą, a jest: „$port”." ;;
  esac
  env_set APP_PORT "$port"
  ok "APP_PORT=$port"

  # Zajęty port nie blokuje instalacji (kontener może już działać
  # albo to może być inna usługa), więc tylko ostrzegamy.
  if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -qE "[:.]${port}[[:space:]]"; then
    warn "Port $port wygląda na zajęty. Jeśli to obecna instalacja — OK."
    info  "Jeśli nie: inna usługa go używa, więc serwer nie odpowie pod http://adres:$port"
  fi

  local secure="${ARG_COOKIE_SECURE}"
  if [ -z "$secure" ]; then
    if [ "$UNATTENDED" = "0" ] && [ -t 0 ]; then
      if ask_yes_no "Czy aplikacja będzie wystawiona przez HTTPS (reverse proxy z TLS)?" "n"; then
        secure="true"
      else
        secure="false"
      fi
    else
      secure="$(env_get COOKIE_SECURE false)"
    fi
  fi
  case "$secure" in
    true|false) ;;
    *) die "Wartość --cookie-secure musi być true albo false, a jest: „$secure”." ;;
  esac
  env_set COOKIE_SECURE "$secure"
  if [ "$secure" = "true" ]; then
    ok "COOKIE_SECURE=true — ciasteczka tylko przez HTTPS"
  else
    ok "COOKIE_SECURE=false"
    info "Po włączeniu HTTPS wróć tu i ustaw true (patrz docs/INSTALACJA.md)."
  fi
}

# ── Krok 5: konto administratora ─────────────────────────────
configure_admin() {
  step "Konfiguruję konto super administratora"

  # Zwykle ustawia to prepare_env; wartość domyślna chroni przed
  # skutkiem zmiany kolejności kroków w main.
  REUSED_ENV="${REUSED_ENV:-0}"

  local username="${ARG_ADMIN_USER}"
  [ -n "$username" ] || username="$(env_get SEED_ADMIN_USERNAME admin)"
  if [ -z "$username" ] && [ "$UNATTENDED" = "0" ]; then
    username="$(ask 'Login super administratora' admin)"
  fi
  username="${username:-admin}"
  env_set SEED_ADMIN_USERNAME "$username"

  local email="${ARG_ADMIN_EMAIL}"
  [ -n "$email" ] || email="$(env_get SEED_ADMIN_EMAIL admin@firma.local)"
  if [ -z "$email" ] && [ "$UNATTENDED" = "0" ]; then
    email="$(ask 'E-mail administratora' admin@firma.local)"
  fi
  env_set SEED_ADMIN_EMAIL "${email:-admin@firma.local}"

  local fullname="${ARG_ADMIN_NAME}"
  [ -n "$fullname" ] || fullname="$(env_get SEED_ADMIN_FULLNAME 'Administrator Systemu')"
  env_set SEED_ADMIN_FULLNAME "${fullname:-Administrator Systemu}"
  ok "Administrator: $username <${email}>"

  local password
  if [ -n "$ARG_ADMIN_PASSWORD" ]; then
    password="$ARG_ADMIN_PASSWORD"
  elif [ -n "${SEED_ADMIN_PASSWORD:-}" ]; then
    password="$SEED_ADMIN_PASSWORD"
  elif [ -n "$(env_get SEED_ADMIN_PASSWORD)" ] && [ "$UNATTENDED" = "1" ]; then
    password="$(env_get SEED_ADMIN_PASSWORD)"
  elif [ -n "$(env_get SEED_ADMIN_PASSWORD)" ]; then
    # .env ma już hasło — pytanie tylko o potwierdzenie, czy go użyć.
    if [ -t 0 ] && ! ask_yes_no "W .env jest już hasło administratora. Zostawić je?" "y"; then
      password=""
    else
      password="$(env_get SEED_ADMIN_PASSWORD)"
    fi
  else
    password=""
  fi

  GENERATED_PASSWORD=""
  if [ -z "$password" ]; then
    # Domyślnie losowe hasło: administrator i tak musi je zmienić
    # przy pierwszym logowaniu, więc nie sprowadzamy go do
    # wymyślania czegoś „na siłę" pod rząd.
    if [ "$UNATTENDED" = "1" ]; then
      # Tryb bez pytań ma NIE pytać — także na maszynie z terminalem
      # (CI, `ssh -t`). Losowe hasło instalator wypisze w podsumowaniu.
      password="$(strong_password)"
      GENERATED_PASSWORD="$password"
    elif ask_yes_no "Wygenerować losowe hasło administratora?" "y"; then
      password="$(strong_password)"
      GENERATED_PASSWORD="$password"
    else
      password="$(read_password 'Hasło startowe administratora (bez echa): ')"
    fi
  fi

  local errs
  # `password_errors` kończy się kodem 1, gdy hasło jest złe — bez
  # `|| true` `set -e` ubiłoby skrypt, zanim zdążyłby o tym powiedzieć.
  errs="$(password_errors "$password")" || true
  if [ -n "$errs" ]; then
    printf '\n'
    printf '   %s✗%s Hasło administratora nie spełnia wymagań:\n' "$C_RED" "$C_OFF"
    printf '%s\n' "$errs" | sed 's/^/     · /'
    printf '\n'
    info "Wymagane: minimum 12 znaków, mała i wielka litera, cyfra oraz"
    info "znak specjalny (nie „$”, nie cudzysłów, nie odwrotny ukośnik)."
    die "Popraw hasło i uruchom skrypt ponownie."
  fi

  # Cudzysłowy chronią spacje i znaki # w pliku .env
  env_set SEED_ADMIN_PASSWORD "\"${password}\""
  ok "Hasło startowe ustawione"

  if [ "$REUSED_ENV" = "1" ]; then
    info "Uwaga: jeśli to konto już istniało w bazie, hasło z .env go nie zmienia."
    info "Po zalogowaniu możesz je zresetować w panelu albo przez „make psql”."
  fi
}

# ── Krok 6: dane demonstracyjne ──────────────────────────────
configure_demo() {
  step "Dane demonstracyjne"

  # Decyzja zapisywana w `.env` jako `SEED_DEMO_APPS`. Świeża instalacja
  # nie ma jeszcze wpisu w tabeli ustawień, więc przy pierwszym starcie
  # kontenera decyduje ta zmienna; później administrator może tryb demo
  # przełączać w panelu i jego decyzja wygrywa ze zmienną (patrz
  # SettingsService.shouldSeedDemo).
  local demo="${ARG_DEMO_DATA}"
  if [ -z "$demo" ]; then
    if [ "$UNATTENDED" = "0" ] && [ -t 0 ]; then
      if ask_yes_no "Włączyć dane demonstracyjne (przykładowe aplikacje, macierz dostępu, podsieci IP)?" "n"; then
        demo="true"
      else
        demo="false"
      fi
    else
      # Bez terminala i bez flagi zostajemy przy tym, co już jest w .env
      # (domyślnie false z .env.example) — instalacja w kółko nie zmienia
      # decyzji, której nikt nie wyraził.
      demo="$(env_get SEED_DEMO_APPS false)"
    fi
  fi
  case "$demo" in
    true|false) ;;
    *) die "Wartość --demo-data musi być true albo false, a jest: „$demo”." ;;
  esac
  env_set SEED_DEMO_APPS "$demo"

  if [ "$demo" = "true" ]; then
    ok "SEED_DEMO_APPS=true — pierwsze uruchomienie wypełni bazę danymi próbnymi"
    info "Tryb demo wyłączysz później w panelu (Ustawienia) — dane demo"
    info "można tam też usunąć jednym przyciskiem."
  else
    ok "SEED_DEMO_APPS=false — baza startuje pusta (tylko środowiska i konto admina)"
  fi
}

# ── Krok 7: budowa i uruchomienie ─────────────────────────────
# Build i start rozdzielone celowo. `compose up -d --build` miesza
# dwa procesy w jedną czarną skrzynkę i administrator przez kilka
# minut nie wie, co się dzieje — ani ile zostało, ani czy wpadł
# w błąd, czy po prostu wolno liczy.
format_elapsed() {
  local s="$1"
  printf '%02d:%02d' "$((s / 60))" "$((s % 60))"
}

render_build_progress() {
  # Wyłuskuje z wyjścia `build --progress=plain` nazwę bieżącego kroku
  # i pokazuje ją wraz z zegarem. Pełne wyjście zostaje w $BUILD_LOG,
  # bo komunikat OOM („Killed”, „JavaScript heap out of memory”) ginie
  # w filtrze i administrator nie ma gdzie szukać przyczyny.
  local started elapsed line step_name last_name=""
  started="$(date +%s)"
  while IFS= read -r line; do
    printf '%s\n' "$line" >>"$BUILD_LOG"
    # Przykładowa linia:  #7 [3/5] RUN npm ci --no-audit
    step_name="$(printf '%s' "$line" | sed -n 's/^#[0-9]\{1,\} \[[0-9]\{1,\}\/[0-9]\{1,\}\] *//p' | cut -c1-60)"
    case "$step_name" in
      ''|CACHED) continue ;;
    esac
    # Linie zapisujące warstwę powtarzają poprzedni krok — pomijamy.
    case "$line" in
      *'CACHED'*|*'DONE'*) continue ;;
    esac
    # BuildKit wypisuje komendę, a potem jeszcze raz tę samą w
    # pośrednich liniach postępu. Bez tego filtru administrator
    # widzi ten sam krok dwa razy pod rząd.
    [ "$step_name" = "$last_name" ] && continue
    last_name="$step_name"
    elapsed=$(( $(date +%s) - started ))
    if [ -t 1 ]; then
      printf '\r\033[K   %s…%s %s  (%s)\n' "$C_BLUE" "$C_OFF" "$step_name" "$(format_elapsed "$elapsed")"
    fi
  done
  return 0
}

build_images() {
  # Ścieżka logu musi istnieć PRZED pierwszym wypisaniem jej nazwy —
  # skrypt leczy `set -u`, więb odwołanie do nieprzypisanej zmiennej
  # zatrzymałoby instalację dokładnie wtedy, gdy administrator czeka
  # najbardziej.
  BUILD_LOG="$(mktemp -t webinv-build.XXXXXX.log)"

  info "Budowanie obrazów — pierwszy raz trwa zwykle 3–8 minut."
  info "Postęp i czas poniżej; pełny log: ${C_DIM}${BUILD_LOG}${C_OFF}"
  printf '\n'

  local progress_opt=""
  [ -t 1 ] && progress_opt="--progress=plain"

  # `|| true`: chcemy własną obsługę błędu niż wyjście z `set -e`
  # w środku potoku, bo musimy pokazać ogon logu.
  # shellcheck disable=SC2086
  if ! docker compose build $progress_opt 2>&1 | render_build_progress; then
    printf '\n'
    warn "Budowanie obrazów nie powiodło się. Ostatnie linie logu:"
    printf '\n'
    tail -n 30 "$BUILD_LOG" 2>/dev/null | sed 's/^/     │ /'
    printf '\n'
    # Rozpoznajemy OOM po słowach-kluczach, bo komunikat sam w sobie
    # („Killed”) nie mówi, czym jest. Bez tego administrator szuka
    # przyczyny w kodzie, a problem leży w ilości RAM-u.
    case "$(grep -cE 'Killed|heap out of memory|JavaScript heap' "$BUILD_LOG" 2>/dev/null || true)" in
      0) : ;;
      *)
        if [ "$LOW_MEMORY" = "1" ]; then
          die "Zabrakło pamięci mimo trybu oszczędnego. Dodaj swap (polecenie powyżej) — bez niego budowanie dwóch obrazów nie zmieści się w RAM-ie."
        fi
        die "Zabrakło pamięci podczas budowania. Dodaj swap (polecenie powyżej) i spróbuj ponownie, albo uruchom ./install.sh --low-memory"
        ;;
    esac
    die "Instalacja nie powiodła się. Powyższy log mówi, na którym kroku build padł."
  fi

  [ -t 1 ] && printf '\r\033[K'
  ok "Obrazy zbudowane"
  ok "Szczegółowy log builda: $BUILD_LOG"
}

start_stack() {
  step "Buduję obrazy"
  build_images

  step "Uruchamiam aplikację"
  if ! docker compose up -d; then
    printf '\n'
    warn "docker compose zakończył się błędem. Ostatnie logi:"
    docker compose logs --tail=30 2>/dev/null || true
    die "Instalacja nie powiodła się. Przeczytaj logi powyżej i uruchom skrypt ponownie."
  fi
  printf '\n'
  ok "Kontenery uruchomione"
}

# ── Krok 9: weryfikacja ──────────────────────────────────────
container_health() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || echo "brak"
}

wait_healthy() {
  local timeout=300 waited=0
  step "Sprawdzam, czy wszystko działa"
  info "Czekam na bazę danych, API i aplikację (maks. ${timeout}s)…"

  while [ "$waited" -lt "$timeout" ]; do
    local db api web
    db="$(container_health webinv_db)"
    api="$(container_health webinv_api)"
    web="$(container_health webinv_web)"
    if [ "$db" = "healthy" ] && [ "$api" = "healthy" ] && [ "$web" = "healthy" ]; then
      printf '\n'
      ok "Wszystkie kontenery są zdrowe"
      return 0
    fi
    # Kontener w kółko restartu = coś się nie powiodło; dalsze
    # czekanie tylko marnuje czas administratora.
    if [ "$api" = "restarting" ] && [ "$waited" -ge 30 ]; then
      printf '\n'
      warn "Kontener API wchodzi w pętlę restartu. Logi:"
      docker compose logs --tail=40 api 2>/dev/null || true
      die "Instalacja nie powiodła się — popraw konfigurację (.env) i uruchom skrypt ponownie."
    fi
    printf '.'
    sleep 3
    waited=$((waited + 3))
  done

  printf '\n'
  warn "Kontenery nie osiągnęły stanu „healthy” w ${timeout}s. Stan:"
  docker compose ps 2>/dev/null || true
  printf '\n'
  docker compose logs --tail=40 2>/dev/null || true
  die "Instalacja nie powiodła się — logi powyżej."
}

check_http() {
  local port="$1" body
  command -v curl >/dev/null 2>&1 || { warn "Brak curl — pomijam test HTTP."; return 0; }

  if body="$(curl -fsS --max-time 10 "http://127.0.0.1:${port}/api/health/ready" 2>/dev/null)"; then
    ok "API odpowiada: ${body}"
  else
    warn "API nie odpowiada pod http://127.0.0.1:${port}/api/health/ready"
    return 1
  fi

  if curl -fsS --max-time 10 -o /dev/null "http://127.0.0.1:${port}/" 2>/dev/null; then
    ok "Interfejs odpowiada pod http://127.0.0.1:${port}/"
  else
    warn "Interfejs nie odpowiada pod adresem z APP_PORT."
    return 1
  fi
}

# ── Podsumowanie ─────────────────────────────────────────────
summary() {
  local port="$1"
  local username="$2"
  local password="$3"
  local host_ip
  # `hostname -I` bywa niedostępne (np. w kontenerach i na części
  # dystrybucji) — bez `|| true` `set -e` + `pipefail` ubiły skrypt.
  host_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  [ -n "$host_ip" ] || host_ip="<adres-serwera>"

  banner "Gotowe"

  printf '   %sRejestr Oprogramowania działa.%s\n\n' "$C_BOLD" "$C_OFF"
  printf '   %sAdres na tym serwerze:%s  http://%s:%s\n' "$C_DIM" "$C_OFF" "$host_ip" "$port"
  printf '   %sAdres lokalnie:%s          http://localhost:%s\n' "$C_DIM" "$C_OFF" "$port"
  printf '   %sLogin:%s                  %s\n' "$C_DIM" "$C_OFF" "$username"
  if [ -n "$password" ]; then
    printf '   %sHasło startowe:%s          %s\n' "$C_DIM" "$C_OFF" "$password"
    printf '   %s%s%s\n' "$C_YELLOW" "(wygenerowane — zapisz je teraz; zmienisz je przy pierwszym logowaniu)" "$C_OFF"
  else
    printf '   %sHasło startowe:%s          hasło z .env (SEED_ADMIN_PASSWORD)\n' "$C_DIM" "$C_OFF"
  fi
  printf '\n'
  printf '   %sTrzy kroki, które warto zrobić teraz%s\n' "$C_BOLD" "$C_OFF"
  printf '     1. Zaloguj się na http://%s:%s i %szmień hasło%s (system tego wymaga).\n' "$host_ip" "$port" "$C_BOLD" "$C_OFF"
  printf '     2. Jeśli aplikacja działa pod HTTPS — ustaw COOKIE_SECURE=true\n'
  printf '        w .env i wykonaj: docker compose up -d\n'
  printf '     3. Sprawdź, że kopia bazy się tworzy:  make backup\n'
  printf '\n'
  printf '   %sCodzienna obsługa%s\n' "$C_BOLD" "$C_OFF"
  printf '     make ps          status kontenerów\n'
  printf '     make logs        logi na żywo\n'
  printf '     make backup      kopia bazy do ./backups/\n'
  printf '     make restart     restart bez przebudowy\n'
  printf '\n'
  printf '   Pełna instrukcja: %sdocs/INSTALACJA.md%s\n\n' "$C_BOLD" "$C_OFF"
}

# ── Start ────────────────────────────────────────────────────
main() {
  parse_args "$@"

  printf '\n%s  Rejestr Oprogramowania — instalacja%s\n' "$C_BOLD" "$C_OFF"
  printf '  Katalog: %s\n' "$SCRIPT_DIR"

  check_requirements
  check_resources
  prepare_env
  configure_port
  configure_admin
  configure_demo

  local password=""
  if [ -n "$GENERATED_PASSWORD" ]; then
    password="$GENERATED_PASSWORD"
  fi

  if [ "$START_STACK" = "0" ]; then
    # Bez nagłówka kroku: `--no-start` kończy instalację na kroku 6,
    # a nagłówek „7/9” sugerowałby, że coś jeszcze zostało.
    banner "Konfiguracja gotowa"
    info "Nie uruchamiałem kontenerów (--no-start). Uruchom stos poleceniem:"
    printf '\n     %smake up%s\n\n' "$C_BOLD" "$C_OFF"
    return 0
  fi

  start_stack
  wait_healthy
  local port
  port="$(env_get APP_PORT 8080)"
  check_http "$port" || true

  summary "$port" "$(env_get SEED_ADMIN_USERNAME admin)" "$password"

  # Compose wymaga SEED_ADMIN_PASSWORD („:?” w docker-compose.yml),
  # więc nie da się zostawić go pustego. Zamiast hasła wypisanego
  # na ekran zapisujemy w pliku losowe, którego nikt nie zna —
  # konto i tak wymusza zmianę hasła przy pierwszym logowaniu.
  if [ -n "$password" ]; then
    env_set SEED_ADMIN_PASSWORD "$(strong_password)"
    ok "Hasło startowe nie jest już zapisane w .env (konto wymusi zmianę przy logowaniu)."
  fi
}

main "$@"