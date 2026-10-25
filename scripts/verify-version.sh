#!/usr/bin/env bash
#
# Weryfikacja wersji wydania w bundlu frontendu.
#
# Szuka wersji **w chunku aplikacji** (`index-*.js`) — tam żyje plakietka
# z wersją. Dlaczego nie w całym katalogu assets: numer wydania bywa też
# fragmentem numeru wersji zależności w `vendor-*.js`. Wydanie 1.7.0
# przeszło wtedy kontrolę na starym bundlu (plakietka 1.6.1), bo zbieżny
# napis w vendorze dał fałszywy pozytyw.
#
# Użycie:
#   scripts/verify-version.sh 1.7.0            # sprawdza działający kontener web
#   scripts/verify-version.sh 1.7.0 /tmp/dir   # sprawdza katalog z plikami `assets/`
#
# Katalog jest wyjściem dla testów — pozwalają one podstawić sztuczne
# assets zamiast podnosić Dockera. Brak wersji w plakietce kończy się
# kodem różnym od 0; wydanie ma wtedy stanąć zamiast udawać sukces.
set -euo pipefail

WERSJA="${1:?podaj wersję do weryfikacji}"
KATALOG="${2:-}"

if [ -z "$KATALOG" ]; then
  # Live: glob `index-*.js` zawsze coś dopasuje w poprawnej budowie,
  # a jego brak wywala glob w sh — grep wykona się z błędem i kod wyjścia
  # będzie różny od 0 (porażka), nie ciche przejście.
  exec docker compose exec -T web sh -c \
    "grep -q '$WERSJA' /usr/share/nginx/html/assets/index-*.js"
fi

# Tryb testowy: katalog z podkatalogiem `assets`, jak w prawdziwym bundlu.
exec grep -q "$WERSJA" "$KATALOG"/assets/index-*.js
