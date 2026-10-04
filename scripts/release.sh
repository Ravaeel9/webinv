#!/usr/bin/env bash
#
# Jedyna droga od zmiany w kodzie do działającej aplikacji.
#
# Dlaczego osobny skrypt, a nie kilka celów w Makefile: kroków jest
# wystarczająco dużo (testy → podbicie wersji → commit → tag → build →
# weryfikacja → push), a kolejność ma znaczenie. W Makefileu każdy
# warunek wyglądałby jak osobny cel, który da się przypadkiem uruchomić
# samodzielnie — wtedy wersja i obraz rozjeżdżają się po cichu.
#
# Użycie:
#   ./scripts/release.sh              pełne wydanie
#   ./scripts/release.sh --dry        pokaże, co zrobi, nic nie zmieni
#   ./scripts/release.sh --no-push    zbuduje lokalnie, bez wysyłania
#   ./scripts/release.sh --minor      podbije minor zamiast patch
#
# Skrypt jest celowo ostrożny: odmawia pracy na brudnym drzewie i na
# gałęzi innej niż main. Wersja, commit, tag i obraz muszą opisywać
# dokładnie ten sam stan repozytorium.

set -euo pipefail

cd "$(dirname "$0")/.."

DRY=0
PUSH=1
BUMP=patch

for arg in "$@"; do
  case "$arg" in
    --dry) DRY=1 ;;
    --no-push) PUSH=0 ;;
    # `minor` jest zarezerwowane dla wydania, które realnie zmienia
    # interfejs API albo model danych — patrz CONTRIBUTING. Bez tej opcji
    # takie wydanie dostałoby numer patcha, a czytelnik tagów nie
    # odróżniłby go od poprawki w tekście.
    --minor) BUMP=minor ;;
    # Pomoc wypisuje nagłówek pliku — blok komentarza aż do pierwszej
    # linii, która nie zaczyna się od `#`. Zakres `sed` rozjechałby się
    # przy każdej dopisanej linijce komentarza.
    -h|--help) awk 'NR>2 { if ($0 !~ /^#/) exit; print }' "$0"; exit 0 ;;
    *) echo "Nieznana opcja: $arg (spróbuj --dry)" >&2; exit 1 ;;
  esac
done

run() {
  if [ "$DRY" = "1" ]; then
    echo "  [sucho] $*"
  else
    "$@"
  fi
}

die() {
  echo "BŁĄD: $*" >&2
  exit 1
}

step() {
  echo
  echo "── $* ────────────────────────────────────────────"
}

# ─── 0. Warunki wstępne ──────────────────────────────────────

step "Sprawdzenie stanu repozytorium"

command -v npm >/dev/null || die "brak npm"
command -v docker >/dev/null || die "brak Dockera"
docker compose version >/dev/null 2>&1 || die "brak pluginu docker compose"

BRANCH=$(git rev-parse --abbrev-ref HEAD)

[ "$BRANCH" = "main" ] || die "wydanie z gałęzi „$BRANCH” — przejdź na main"

if [ -n "$(git status --porcelain)" ]; then
  git status --short
  die "drzewo roboczne nie jest czyste — commituj lub schowaj zmiany"
fi

if [ -n "$(git tag --points-at HEAD)" ]; then
  die "HEAD jest już oznaczony tagiem — nie ma czego wydawać"
fi

echo "gałąź: $BRANCH (czysta)"

# ─── 1. Testy i typy ─────────────────────────────────────────
#
# Wersja jest podbijana dopiero po tym, jak kod przeszedł testy.
# W drugą stronę nie cofniemy wersji, jeśli testy padną — skrypt
# po prostu nie zrobi niczego.

step "Testy i typy"

run npm test
run make typecheck

# ─── 2. Wersja ──────────────────────────────────────────────
#
# `npm version` zostawiamy bez taga i commita (`--no-git-tag-version`),
# bo domyślny commit brzmiałby „1.0.1” — po angielsku i bez kontekstu.
# Commit i tag robimy sami, po polsku, razem z resztą.

step "Podbicie wersji"

OLD=$(node -p "require('./package.json').version")

if [ "$DRY" = "1" ]; then
  # W podglądzie niczego nie podbijamy, więc nową wersję trzeba
  # wyliczyć na oko. To jedyne miejsce z podobną matematyką — w realnym
  # przebiegu wersję zawsze ustawia `npm version`.
  NEW=$(node -p "
    const v='$OLD'.split('.').map(Number);
    const i='$BUMP' === 'minor' ? 1 : 2;
    v[i] += 1;
    if (i === 1) v[2] = 0;
    v.join('.')
  ")
  echo "wersja: $OLD → $NEW ($BUMP)"
else
  # Czytamy wersję z manifestu, a nie wyznaczamy jej obok — `npm version`
  # jest jedynym miejscem, które zna swoje reguły podbijania. Własne
  # wyliczanie potrafiłoby się z nim rozjechać.
  npm version "$BUMP" --no-git-tag-version
  NEW=$(node -p "require('./package.json').version")
  echo "wersja: $OLD → $NEW ($BUMP)"
fi

# ─── 3. Commit i tag ─────────────────────────────────────────

step "Commit i tag v$NEW"

if [ "$DRY" = "0" ]; then
  git add package.json package-lock.json
  git commit -q -m "release: $NEW"
  git tag "v$NEW"
fi

# ─── 4. Budowanie ────────────────────────────────────────────
#
# APP_VERSION trafia do obrazu jako ARG budowania i ląduje w plakietce
# w prawym dolnym rogu interfejsu. Bez tej zmiennej Docker bierze
# swój fallback 0.0.0-dev i wersja wygląda, jakby ktoś buildował
# obok makefile — dlatego weryfikacja w kroku 5, a nie ufanie.

step "Budowanie i uruchamianie obrazu"

if [ "$DRY" = "0" ]; then
  APP_VERSION="$NEW" docker compose up -d --build
else
  echo "  [sucho] APP_VERSION=$NEW docker compose up -d --build"
fi

# ─── 5. Weryfikacja tego, co naprawdę powstało ────────────────
#
# Budowanie może przejść, a wersja i tak nie trafić do interfejsu —
# dokładnie tak było, gdy obraz zbudowano z pominięciem APP_VERSION.
# Sprawdzamy więc zawartość bundla, a nie wyjście doker-compose.

step "Weryfikacja wersji w zbudowanym obrazie"

if [ "$DRY" = "1" ]; then
  echo "  [sucho] sprawdzę, czy w bundlu jest „$NEW”"
else
  # Czekamy na zdrowy kontener, bo healthcheck frontendu startuje
  # po zbudowaniu, a pliki mogą być jeszcze w trakcie kopiowania.
  for _ in $(seq 1 30); do
    if docker compose ps --status running --services 2>/dev/null | grep -qx web; then
      break
    fi
    sleep 1
  done

  if ! docker compose exec -T web sh -c \
      "grep -rq '$NEW' /usr/share/nginx/html/assets/ 2>/dev/null"; then
    docker compose logs --tail=30 web
    die "wersja $NEW nie znalazła się w bundlu — sprawdź ARG VITE_APP_VERSION"
  fi

  echo "  wersja $NEW jest w obrazie"
fi

# ─── 6. Wysłanie ─────────────────────────────────────────────
#
# Tag musi trafić na GitHub razem z commitem, inaczej `npm version`
# w przyszłości odmówi utworzenia tej samej wersji drugi raz.

step "Wysłanie na GitHub"

if [ "$PUSH" = "0" ] || [ "$DRY" = "1" ]; then
  echo "  pomijam (--no-push)"
else
  git push origin HEAD
  git push origin "v$NEW"
fi

# ─── Podsumowanie ────────────────────────────────────────────

step "Gotowe"

cat <<EOF
  Wersja:   v$NEW
  Aplikacja: http://localhost:$(grep -E '^APP_PORT=' .env 2>/dev/null | cut -d= -f2 || echo 8080)
  Tag:      v$NEW
EOF