#!/usr/bin/env bash
#
# Ostatni krok w życiu projektu: całkowite usunięcie z maszyny.
#
# Co usuwa (po potwierdzeniu):
#   - kontenery, obrazy, wolumeny (baza!) i sieci Compose tego projektu,
#   - cały katalog repozytorium: źródła, node_modules, .env (sekret!)
#     i backups/.
#
# Czego celowo NIE usuwa: samego Dockera — to systemowa usługa, z której
# mogą korzystać inne projekty. Sprzątane są wyłącznie zasoby
# przypisane do tego projektu.
#
# Użycie:
#   ./scripts/uninstall.sh      pełne usunięcie (pyta o potwierdzenie)
#   ./scripts/uninstall.sh -h   ta pomoc
#
# Skrypt jest interaktywny celowo: operacja jest nieodwracalna, a .env
# zawiera sekrety, których nie da się odtworzyć po fakcie.

set -euo pipefail

die() {
  echo "BŁĄD: $*" >&2
  exit 1
}

step() {
  echo
  echo "── $* ────────────────────────────────────────────"
}

warn() {
  echo "  ⚠︎  $*"
}

# Liczba niepustych wierszy w zebranym wyniku.
block_count() {
  if [ -n "$1" ]; then
    printf '%s\n' "$1" | grep -c .
  else
    echo 0
  fi
}

# Katalog repozytorium wyliczany ze ścieżki skryptu, nie z pwd —
# działa też wtedy, gdy skrypt odpalany jest spoza katalogu projektu.
PROJECT_DIR=$(cd "$(dirname "$0")/.." && pwd -P)
cd "$PROJECT_DIR"

for arg in "$@"; do
  case "$arg" in
    # Pomoc wypisuje nagłówek pliku — blok komentarza do pierwszej
    # linii, która nie zaczyna się od `#` (ta sama sztuczka co w release.sh).
    -h|--help) awk 'NR>2 { if ($0 !~ /^#/) exit; print }' "$0"; exit 0 ;;
    *) echo "Nieznana opcja: $arg (spróbuj -h)" >&2; exit 1 ;;
  esac
done

# ─── 0. Rozpoznanie ───────────────────────────────────────────
#
# Nazwę projektu Compose czytamy z docker-compose.yml, dopóki pliki
# jeszcze istnieją — po skasowaniu katalogu będzie za późno. Fallback
# „webinv” obsługuje przypadek uszkodzonego/niekompletnego pliku.

PROJ=$(grep -E '^name:[[:space:]]+' docker-compose.yml 2>/dev/null | awk '{print $2}' || true)
PROJ=${PROJ:-webinv}
VOLUME="${PROJ}_pgdata"

step "Rozpoznanie stanu"

echo "  projekt:       $PROJ"
echo "  katalog:       $PROJECT_DIR"

DOCKER_OK=1
if ! command -v docker >/dev/null; then
  warn "brak Dockera w PATH — sprzątnę tylko katalog projektu"
  DOCKER_OK=0
elif ! docker info >/dev/null 2>&1; then
  warn "demon Dockera nie odpowiada — sprzątnę tylko katalog projektu"
  DOCKER_OK=0
fi

# Każde zapytanie o stan jest best-effort: demon może paść w dowolnym
# momencie, a sprzątanie po etykietach i nazwach radzi sobie z brakiem
# zasobu, więc pusta lista nie blokuje dalszej pracy.
CONTAINERS=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJ" 2>/dev/null || true)
VOLUMES=$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJ" 2>/dev/null || true)
NETWORKS=$(docker network ls -q --filter "label=com.docker.compose.project=$PROJ" 2>/dev/null || true)
IMAGES=$(docker image ls -q --filter "label=com.docker.compose.project=$PROJ" 2>/dev/null || true)

# Obrazy serwisów Compose nazywają się `<projekt>-<serwis>` (webinv-api,
# webinv-web) i nie zawsze dziedziczą etykietę projektu — trafiają tu
# wprost po nazwie.
SERVICE_IMAGES=$(docker image ls --format '{{.Repository}}' \
  "${PROJ}-api" "${PROJ}-web" 2>/dev/null | grep -v '<none>' || true)

# ─── 1. Podsumowanie i potwierdzenie ──────────────────────────

step "Co zostanie usunięte"

echo "  kontenery:     $(block_count "$CONTAINERS")"
echo "  wolumeny:      $(block_count "$VOLUMES") (w tym $VOLUME — baza danych)"
echo "  sieci:         $(block_count "$NETWORKS")"
echo "  obrazy:        $(block_count "$IMAGES") z etykietą projektu${SERVICE_IMAGES:+ + serwisowe: $SERVICE_IMAGES}"
echo "  katalog repo:  $PROJECT_DIR (w nim .env z sekretami i backups/)"

# Rozmiar bazy daje poczucie skali tego, co przepada. Katalog wolumenu
# zwykle czytelny tylko dla roota — wtedy zostaje „nieznany”.
if [ -r "/var/lib/docker/volumes/$VOLUME/_data" ]; then
  echo "  rozmiar bazy:  $(du -sh "/var/lib/docker/volumes/$VOLUME/_data" 2>/dev/null | awk '{print $1}')"
fi

echo
warn "Operacja NIEODWRACALNA: baza danych, .env (sekrety) i backups/ przepadają bezpowrotnie."
warn "Samego Dockera i jego innych projektów to NIE dotyczy."
echo

read -r -p "Usuń projekt „$PROJ” i katalog $PROJECT_DIR? Wpisz „y”, aby kontynuować: " ANSWER \
  || die "przerwano (puste wejście) — nic nie zostało zmienione"
[ "$ANSWER" = "y" ] || die "przerwano — nic nie zostało zmienione"

# ─── 2. Sprzątanie Dockera ────────────────────────────────────
#
# Najpierw oficjalna droga (compose down -v), potem poszukiwanie
# resztek po etykietach — down nie zawsze ruszy wszystko, np. gdy ktoś
# ręcznie dołożył kontenery albo pliki compose nie otwierają się.

step "Usuwam zasoby Dockera"

if [ "$DOCKER_OK" = "1" ]; then
  if docker compose version >/dev/null 2>&1 && [ -f docker-compose.yml ]; then
    echo "  docker compose down -v --remove-orphans"
    docker compose down -v --remove-orphans || warn "compose down zgłosił błąd — spróbuję posprzątać po etykietach"
  else
    warn "brak pluginu compose albo pliku docker-compose.yml — czyszczę po etykietach"
  fi

  # Kontenery (włącznie z uruchomionymi, wymuszone), potem sieci —
  # kolejność ma znaczenie, bo sieć zajęta przez kontener usunie się
  # dopiero po nim.
  # shellcheck disable=SC2086  # rozbicie wierszy na ID jest zamierzone
  [ -n "$CONTAINERS" ] && docker rm -f $CONTAINERS 2>/dev/null || true
  # shellcheck disable=SC2086
  [ -n "$NETWORKS" ] && docker network rm $NETWORKS 2>/dev/null || true

  # Wolumen bazy ma jawną nazwę w compose, więc poza filtrem etykiety
  # dodaję go wprost — inaczej mógłby zostać niedostrzeżony. Dedup
  # przez sort -u, żeby explicit name zdublowany z filtrem etykiety
  # nie wywołał fałszywego ostrzeżenia przy drugim usunięciu.
  ALL_VOLUMES=$(printf '%s\n' "$VOLUME" "$VOLUMES" | sort -u)
  # shellcheck disable=SC2086  # lista ID wiersz po wierszu
  for v in $ALL_VOLUMES; do
    echo "  docker volume rm $v"
    docker volume rm "$v" 2>/dev/null || warn "wolumen $v został — spróbuj: docker volume rm $v"
  done

  if [ -n "$IMAGES$SERVICE_IMAGES" ]; then
    echo "  docker image rm (obrazy projektu)"
    ALL_IMAGES=$(printf '%s\n' "$IMAGES" "$SERVICE_IMAGES" | sort -u)
    # shellcheck disable=SC2086
    for i in $ALL_IMAGES; do
      docker image rm "$i" 2>/dev/null || true
    done
  fi
fi

# ─── 3. Kontrola resztek ──────────────────────────────────────
#
# Raport po fakcie, nie ufanie poleceniom: jeśli coś zostało,
# użytkownik dostaje konkretną wskazówkę zamiast mgłowego „coś nie
# zeszło”.

step "Kontrola resztek"

if [ "$DOCKER_OK" = "1" ]; then
  LEFT_C=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJ" 2>/dev/null || true)
  LEFT_V=$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJ" 2>/dev/null || true)
  LEFT_N=$(docker network ls -q --filter "label=com.docker.compose.project=$PROJ" 2>/dev/null || true)
  # Wolumen bazy wyszukuję po nazwie, bo etykietę mógł stracić w drodze.
  LEFT_DB=$(docker volume ls -q --filter "name=$VOLUME" 2>/dev/null | grep -x "$VOLUME" || true)
  if [ -n "$LEFT_C$LEFT_V$LEFT_N$LEFT_DB" ]; then
    warn "po sprzątaniu zostało: kontenery:${LEFT_C:+ $LEFT_C} wolumeny:${LEFT_V:+ $LEFT_V}${LEFT_DB:+ $LEFT_DB} sieci:${LEFT_N:+ $LEFT_N}"
    warn "usuń je ręcznie: docker rm -f … / docker volume rm … / docker network rm …"
  else
    echo "  zasoby Dockera projektu $PROJ: czysto"
  fi
fi

# ─── 4. Kasowanie katalogu projektu ───────────────────────────
#
# Celowo ostatni krok: skrypt żyje w tym katalogu, więc każde wcześniejsze
# kasowanie byłoby samobójstwem. Unix dodatkowo pomaga: plik skryptu
# czytany jest z otwartego deskryptora, więc unlink nie przerywa
# wykonania.

step "Kasowanie katalogu projektu"

# Zabezpieczenie przed absurdem: nigdy / ani katalog domowy.
case "$PROJECT_DIR" in
  / | "$HOME") die "odmawiam kasowania „$PROJECT_DIR” — to wygląda jak systemowy katalog, a nie projekt" ;;
esac

echo "  kasuję: $PROJECT_DIR"
cd /
rm -rf -- "$PROJECT_DIR"
echo "  usunięto"

# ─── Podsumowanie ─────────────────────────────────────────────

step "Gotowe"

cat <<EOF
  Projekt „$PROJ” usunięty wraz z zasobami Dockera i katalogiem.
  Celowo zostawiono: samego Dockera oraz obraz bazowy postgres.
  Jeśli chcesz zwolnić też obraz bazy:  docker image rm postgres:17-alpine
EOF
