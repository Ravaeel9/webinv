# AGENTS.md — konwencje pracy z repozytorium web-inv

## Budowanie i uruchamianie — JEDNA ścieżka

Projekt buduje się **wyłącznie** przez Makefile albo skrypt wydania.
Nigdy przez gołe `docker compose build` / `docker compose up`.

| Cel | Polecenie |
|---|---|
| Zbuduj i uruchom cały stos | `make up` |
| Zbuduj tylko obrazy | `make build` |
| Przebuduj od zera (bez cache) | `make rebuild` |
| Wersja deweloperska (dev compose) | `make dev` |
| Pełne wydanie (testy → wersja → tag → build) | `./scripts/release.sh` |
| Podgląd wydania bez zmian | `./scripts/release.sh --dry` |
| Wydanie bez wysyłania na origin | `./scripts/release.sh --no-push` |

### Dlaczego nie `docker compose build` bezpośrednio

Wersja trafia do obrazu web jako build-arg `VITE_APP_VERSION`
(`docker-compose.yml`), a Makefile podstawia ją z `package.json`
i stanu tagów gita (`Makefile`, zmienna `APP_VERSION`). Build z
pominięciem `make` dostaje fallback `0.0.0-dev` — plakietka w UI
pokazuje wtedy bezsensowną wersję. To nie jest kosmetyka: wersja
ma wiązać obraz z tagiem wydania.

### Semantyka wersji

- HEAD oznaczony tagiem `vX.Y.Z` (stan zaraz po `./scripts/release.sh`)
  → plakietka `vX.Y.Z`.
- Commit po wydaniu, przed następnym release → `vX.Y.Z-dev`.
- Build poza repozytorium gita (brak node/gita) → `0.0.0-dev`
  (celowo „nieuczciwie zerowy", żeby build nie udawał wydania).

## Testy i typy — przed każdym commitem

```bash
make typecheck   # tsc dla api + web
npm test         # node --test w apps/api (testy żyją w apps/api/test/)
npm run lint     # ESLint (flat config, eslint.config.mjs) — 0 błędów musi przechodzić
```

Lint nie pilnuje formatowania — łapie to, czego typecheck nie widzi:
martwe zmienne, błędy hooków Reacta (`react-hooks`), przypadkowe
wytłumienia reguł. Ostrzeżenia `react-hooks/set-state-in-effect`
są zadokumentowane w `eslint.config.mjs` jako praca do refaktoringu —
nie dodawaj nowych miejsc z tym wzorcem.

CI (`.github/workflows/ci.yml`) uruchamia dokładnie to samo plus
`npm ci` i generowanie klienta Prisma — nie dodawaj do CI kroków,
których nie przechodzi lokalny `make test`.

## Konwencje kodu

- Komentarze i komunikaty dla użytkownika: po polsku.
- Testy API żyją w `apps/api/test/`, atrapa bazy: `test/helpers/access-fake.ts`.
- Nazwy plików komponentów: PascalCase; hooki i biblioteki: camelCase.
- Walidacja danych wejściowych zawsze w serwisie, przed pierwszym
  zapisem (patrz komentarze w `apps/api/src/access/access.service.ts`).
