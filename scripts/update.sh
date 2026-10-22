#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  Rejestr Oprogramowania — aktualizacja na serwerze
#
#  Jedno polecenie podnosi działającą instancję do najnowszego
#  taga wydania vA.B.C: kopia bazy → przełączenie na tag →
#  przebudowa → start → weryfikacja, że nowa wersja naprawdę
#  siedzi w bundlu frontendu. Kolejność ma znaczenie — kopię
#  robimy PRZED dotknięciem kodu, bo migracja bazodanowa, która
#  pójdzie źle, cofa się dopiero z kopii (patrz docs/WDROZENIE.md).
#
#  Uruchomienie:
#     ./scripts/update.sh               # pełna aktualizacja
#     ./scripts/update.sh --dry         # pokazuje plan, nic nie zmienia
#     ./scripts/update.sh --no-backup   # świadome pominięcie kopii
#     ./scripts/update.sh --no-cache    # przebudowa od zera (make rebuild)
#     ./scripts/update.sh --help
#
#  Produkcja jeździ po tagach wydania, nie po HEAD gałęzi main —
#  tag jest sygnalizowany plakietką wersji bez dopisku „-dev”
#  (patrz Makefile → APP_VERSION). Skrypt jest idempotentny:
#  ponowne uruchomienie na najnowszym tagu kończy się komunikatem
#  i kodem 0, nie przepuszcza pół aktualizacji.
# ─────────────────────────────────────────────────────────────

# shellcheck disable=SC1111
# SC1111: polskie cudzysłowy „…” wewnątrz tekstów są tu zamierzone —
# tak samo jak w install.sh, komunikaty mają czytać się jak zdania.
set -euo pipefail

# ── Wygląd ───────────────────────────────────────────────────
# Ten sam zestaw co w install.sh, żeby oba skrypty mówiły tym
# samym „głosem” na terminalu administratora.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[36m'
  C_OFF=$'\033[0m'
else
  C_BOLD=''; C_DIM=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_OFF=''
fi

ok()   { printf '   %s✓%s %s\n' "$C_GREEN" "$C_OFF" "$1"; }
info() { printf '   %s\n' "$1"; }
warn() { printf '   %s!%s %s\n' "$C_YELLOW" "$C_OFF" "$1"; }
die()  { printf '\n   %s✗ %s%s\n\n' "$C_RED" "$1" "$C_OFF" >&2; exit 1; }

step() {
  printf '\n%s── %s %s\n' "$C_BLUE" "$1" "$C_OFF"
}

sucho() {
  # Komunikat trybu --dry: wszystko, co zmienia stan serwera,
  # przechodzi przez tę funkcję, więc podgląd nie pomija kroku po
  # cichu (ten sam pomysł co `run` w release.sh).
  printf '   %s[sucho]%s %s\n' "$C_DIM" "$C_OFF" "$1"
}

# ── Argumenty ────────────────────────────────────────────────
DRY=0
BACKUP=1
CACHE=1

usage() {
  cat <<'EOF'
Aktualizacja Rejestru Oprogramowania do najnowszego taga wydania.

Użycie:
  ./scripts/update.sh [opcje]

Opcje:
  --dry         Pokaż plan (tag, kopię, build), niczego nie zmieniając.
                Nie dotyka sieci — używa tagów już pobranych lokalnie.
  --no-backup   Pomiń kopię bazy (make backup) — świadome ryzyko.
  --no-cache    Przebuduj obrazy od zera (make rebuild zamiast make up).
  -h, --help    Ta pomoc
EOF
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry)        DRY=1 ;;
      --no-backup)  BACKUP=0 ;;
      --no-cache)   CACHE=0 ;;
      -h|--help)    usage; exit 0 ;;
      *) printf 'Nieznana opcja: %s\n\n' "$1" >&2; usage >&2; exit 2 ;;
    esac
    shift
  done
}

# ── Porównywanie wersji ─────────────────────────────────────
# `sort -V` sortuje semantycznie: v1.10.0 > v1.9.0, czego
# porównanie tekstem (albo git tag --sort bez -V) nie daje.
# To krytyczne miejsce — cichy wybór starszego taga przełączyłby
# produkcję na poprzednie wydanie.

tag_gt() {
  # tag_gt vA vB → kod 0, gdy vA > vB (semantycznie)
  [ "$1" = "$2" ] && return 1
  [ "$(printf '%s\n' "$1" "$2" | sort -V | tail -n 1)" = "$1" ]
}

newest_of() {
  # newest_of vA vB … → najwyższy tag vMAJOR.MINOR.PATCH z podanych.
  # Bez argumentów czyta ze standardowego wejścia — główny przebieg
  # pipe'uje tu wyjście `git tag` (patrz wywołania w main).
  # Tagi bez pełnego numerka (np. adnotacje, rc) są wycinane, bo
  # produkcja nie ma jechać na niczym, czego wersji nie da się
  # pokazać na plakietce.
  local tags=("$@")
  if [ "${#tags[@]}" -eq 0 ]; then
    tags=($(cat))
  fi
  printf '%s\n' "${tags[@]}" 2>/dev/null \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
    | sort -V | tail -n 1 || true
}

# ── Zdrowie kontenerów ──────────────────────────────────────
# Nazwy zaszyte w docker-compose.yml (container_name), te same,
# na które patrzy install.sh — dlatego skrypt działa z każdego
# katalogu, nie tylko z /opt/webinv.

container_health() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || echo "brak"
}

wait_healthy() {
  local timeout=300 waited=0 db api web
  step "Czekam na zdrowie kontenerów"
  info "Baza, API i aplikacja (maks. ${timeout}s)…"

  while [ "$waited" -lt "$timeout" ]; do
    db="$(container_health webinv_db)"
    api="$(container_health webinv_api)"
    web="$(container_health webinv_web)"
    if [ "$db" = "healthy" ] && [ "$api" = "healthy" ] && [ "$web" = "healthy" ]; then
      printf '\n'
      ok "Wszystkie kontenery są zdrowe"
      return 0
    fi
    # Pętla restartu API po aktualizacji to prawie zawsze migracja,
    # która nie przeszła — kontener API stawia schemat PRZED main.js,
    # więc dalej czekać nie ma sensu. Wypisujemy logi i mówimy wprost.
    if [ "$api" = "restarting" ] && [ "$waited" -ge 30 ]; then
      printf '\n'
      warn "Kontener API wchodzi w pętlę restartu. Logi:"
      docker compose logs --tail=40 api 2>/dev/null || true
      info "Najczęstsza przyczyna: nieudana migracja bazy."
      info "Cofnięcie: make restore f=<najnowsza kopia z ./backups/>,"
      info "potem git checkout na poprzedni tag i make up."
      die "Aktualizacja nie powiodła się — API nie chce wystartować."
    fi
    printf '.'
    sleep 3
    waited=$((waited + 3))
  done

  printf '\n'
  warn "Kontenery nie osiągnęły stanu „healthy” w ${timeout}s. Stan:"
  docker compose ps 2>/dev/null || true
  docker compose logs --tail=40 2>/dev/null || true
  die "Aktualizacja nie dokończona — przeanalizuj logi powyżej."
}

verify_bundle_version() {
  # To samo, co krok 5 w release.sh: wersja potrafi NIE trafić do
  # bundla (build z pominięciem APP_VERSION), a wtedy „aktualizacja”
  # tylko wyglądała na udaną. Sprawdzamy zawartość obrazu, nie
  # wyjście docker-compose.
  local version="${1#v}"
  step "Weryfikacja wersji w zbudowanym obrazie"
  if docker compose exec -T web sh -c \
      "grep -rq '$version' /usr/share/nginx/html/assets/ 2>/dev/null"; then
    ok "Wersja $1 jest w bundlu"
  else
    docker compose logs --tail=30 web 2>/dev/null || true
    die "Wersji $1 nie ma w bundlu — build nie przeszedł z APP_VERSION. Nie udawaj, że aktualizacja się udała."
  fi
}

# ── Główny przebieg ─────────────────────────────────────────
main() {
  parse_args "$@"

  printf '\n%s  Rejestr Oprogramowania — aktualizacja%s\n' "$C_BOLD" "$C_OFF"

  # Skrypt żyje w scripts/, a compose, .env i Makefile są w korzeniu
  # repozytorium — przechodzimy tam, niezależnie od tego, skąd
  # administrator go uruchomił. Przed source (testy) ten krok
  # się nie wykonuje — guard jest na końcu pliku.
  cd "$(dirname "${BASH_SOURCE[0]}")/.."

  # ── Warunki wstępne ──
  step "Sprawdzenie stanu"
  [ -d .git ] || die "To nie jest repozytorium gita — aktualizacja jest tylko dla instalacji z klonu."
  [ -f .env ] || die "Brak pliku .env — to wygląda na świeżą maszynę. Zacznij od: make install"

  # Brudne drzewo: git checkout na tag mógłby odmówić w połowie
  # aktualizacji. Ignorujemy NIEŚLEDZONE pliki (.env, backups/ —
  # te na serwerze mają prawo istnieć), pilnujemy zmienionych
  # śledzonych, bo o takich checkout nie da rady ostrzec z góry.
  if [ -n "$(git status --porcelain | grep -v '^??' || true)" ]; then
    git status --short | grep -v '^??' || true
    die "Drzewo robocze ma zmienione pliki śledzone — commituj albo schowaj (git stash) i uruchom ponownie."
  fi
  ok "Drzewo robocze czyste (poza plikami nieśledzonymi)"

  # Docker potrzebny dopiero do realnego przebiegu — dry ma działać
  # na każdej maszynie, także bez demonów.
  if [ "$DRY" = "0" ]; then
    command -v docker >/dev/null || die "Brak Dockera — na tym serwerze nie da się zbudować aplikacji."
    docker compose version >/dev/null 2>&1 || die "Brak pluginu docker compose (Compose v1 nie jest obsługiwany)."
    docker info >/dev/null 2>&1 || warn "Docker nie odpowiada — budowa może się wysypać."
  fi

  # ── Wybór wersji ──
  step "Wybór wersji"
  if [ "$DRY" = "0" ]; then
    # Tagi pobieramy, zanim je porównamy — inaczej „aktualizacja”
    # do najnowszego taga wybrałaby najnowszy Z LOKALNYCH, czyli
    # zwykle ten, na którym serwer już stoi.
    git fetch --tags --quiet origin || die "Nie mogę pobrać tagów z origin — sprawdź sieć i dostęp do repozytorium."
  else
    info "Tryb sucho: używam tagów lokalnych (bez git fetch)"
  fi

  NEWEST="$(newest_of $(git tag --list 'v[0-9]*' 2>/dev/null) || true)"
  [ -n "$NEWEST" ] || die "Brak tagów wydania (vX.Y.Z) — najpierw wydaj wersję na maszynie deweloperskiej (make release)."

  # Aktualna wersja: tag wskazujący dokładnie HEAD, a gdy HEAD jest
  # pomiędzy wydaniem — najbliższy tag w dół (git describe), żeby
  # komunikat mówił prawdę także po buildach z dopiskiem -dev.
  CURRENT="$(git tag --points-at HEAD | newest_of || true)"
  if [ -z "$CURRENT" ]; then
    CURRENT="$(git describe --tags --match 'v*' --abbrev=0 2>/dev/null || echo 'brak')"
  fi
  printf '   Aktualna:  %s\n   Docelowa:  %s\n' "$CURRENT" "$NEWEST"

  if [ "$CURRENT" = "$NEWEST" ]; then
    printf '\n'
    ok "Serwer jest już na najnowszym wydaniu ($NEWEST) — nic do zrobienia."
    exit 0
  fi
  if tag_gt "$CURRENT" "$NEWEST"; then
    warn "Aktualny tag ($CURRENT) jest NOWSZY niż docelowy ($NEWEST) — sprawdzaj, czy nie cofasz wydania."
  fi

  # Tag poza origin/main = wydanie z gałęzi pobocznej. Nie blokuję,
  # bo tag mógł powstać przed skaladniścią — ale administrator ma
  # to wiedzieć, zanim produkcja na nim stanie.
  if ! git merge-base --is-ancestor "$NEWEST" origin/main 2>/dev/null; then
    warn "Tag $NEWEST nie jest przodkiem origin/main — to wydanie z pobocznej gałęzi?"
  fi

  # ── Plan / kopia / przełączenie ──
  if [ "$BACKUP" = "1" ]; then
    step "Kopia bazy"
    if [ "$DRY" = "1" ]; then
      sucho "make backup → ./backups/backup-<data>.sql.gz"
    else
      make backup || die "Kopia bazy nie powiodła się — nie ruszam dalej bez kopii."
      info "Kopię trzymaj też POZA katalogiem repozytorium — zawiera dane wrażliwe."
    fi
  fi

  step "Przełączenie na $NEWEST"
  if [ "$DRY" = "1" ]; then
    sucho "git checkout $NEWEST"
  else
    git checkout "$NEWEST" --quiet || die "git checkout odmówił — zobacz komunikat powyżej."
    ok "HEAD na $NEWEST"
  fi

  # ── Budowa i start ──
  # `make` jest tu celowo, nie docker compose: tylko Makefile
  # podstawia APP_VERSION z taga do bundla (VITE_APP_VERSION).
  # Domyślnie build z cache — szybciej; --no-cache przechodzi na
  # make rebuild dla sytuacji podejrzanych (patrz docs/WDROZENIE.md).
  step "Budowanie i uruchamianie"
  if [ "$DRY" = "1" ]; then
    if [ "$CACHE" = "1" ]; then
      sucho "make up   (build z cache)"
    else
      sucho "make rebuild   (build bez cache)"
    fi
    sucho "czekam na zdrowie kontenerów, potem weryfikuję $NEWEST w bundlu"
    printf '\n'
    info "Tryb sucho zakończony — plan wygląda w porządku? Usuń --dry."
    exit 0
  fi
  if [ "$CACHE" = "1" ]; then
    make up
  else
    make rebuild
    make up
  fi

  wait_healthy
  verify_bundle_version "$NEWEST"

  # ── Podsumowanie ──
  local port
  port="$(grep -E '^APP_PORT=' .env 2>/dev/null | cut -d= -f2 || echo 8080)"
  local last_backup
  last_backup="$(ls -t backups/backup-*.sql.gz 2>/dev/null | head -n 1 || true)"
  printf '\n%s── Gotowe %s\n' "$C_BLUE" "$C_OFF"
  cat <<EOF

  Wersja:    $CURRENT → $NEWEST
  Aplikacja: http://localhost:$port
EOF
  if [ -n "$last_backup" ]; then
    printf '  Kopia:     %s\n' "$last_backup"
    printf '\n  Cofnięcie wydania:\n'
    printf '    make restore f=%s\n' "$last_backup"
    printf '    git checkout %s && make up\n' "$CURRENT"
  fi
  printf '\n'
}

# Guard: zaisowanie (testy) ma tylko dostarczyć funkcje — `cd` w main
# przenosiłoby katalog testu, a pełny przebieg wymagałby Dockera.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
