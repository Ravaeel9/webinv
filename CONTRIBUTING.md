# Współtworzenie

Dokument opisuje konwencje repozytorium i proces zmian. Opis techniczny
znajdziesz w [docs/](docs/) — szczególnie w
[docs/ROZWOJ.md](docs/ROZWOJ.md).

## Ustawienie

```bash
git clone <adres-repo>
cd web-inv
npm ci
```

Do pracy nad kodem: `make db-up && make migrate`, potem `make dev-api` i
`make dev-web` (Vite na 5173 proxyuje `/api` na 3000).

## Zmiany

1. Osobna gałąź: `feat/kolumna-kosztu`, `fix/patch-nul`, `docs/api`.
2. Zmiana wraz z testem tam, gdzie da się ją przetestować bez bazy.
3. Przed pushem:

   ```bash
   npm test
   make typecheck
   ```

   Zmiana w `install.sh` lub `scripts/release.sh` wymaga dodatkowo
   `bash -n install.sh scripts/release.sh` (albo `shellcheck`, jeśli masz
   go zainstalowane).

4. Commit i pull request z krótkim opisem **co się zmienia i dlaczego**.

5. Po zmerowaniu na `main` — `make release` (patrz
   [Wydanie](#wydanie-zmiana-kodu--działająca-aplikacja)). To podbija
   wersję, buduje obraz i weryfikuje, że wersja faktycznie dotarła do
   interfejsu.

CI (`.github/workflows/ci.yml`) uruchamia `bash -n install.sh`, `npm test`
i `make typecheck` na każdym pushu i w każdym PR-ze — wszystko musi być
zielone.

## Konwencje

### Język

- Komentarze w kodzie, komunikaty błędów, teksty w UI, commit messages i
  dokumentacja — **po polsku**.
- Nazwy symboli, pól, plików i endpointów — po angielsku.
- Trasy frontendu: po polsku, bez diakrytyków (`/aplikacje`, `/uzytkownicy`).

### Komentarze

Komentujemy **dlaczego**, nie *co*:

```ts
// źle: zwiększa limit zapytań
// dobrze: Osobny, niski limit na logowanie — chroni przed zgadywaniem haseł.
```

Jeśli kod zawiera komentarz wyjaśniający decyzję, a ty ją zmieniasz —
**zaktualizuj komentarz**. Nie usuwaj i nie zostawiaj w pastie.

### Kod

| Obszar | Reguła |
|---|---|
| DTO | komunikaty walidacji po polsku, jawne transformacje dla tekstów i pustych wartości, `null` = wyczyść, `undefined` = nie ruszaj |
| Serwis | walidacja referencji i dat w serwisie, nie w kontrolerze; sortowanie i filtrowanie tylko z białych list |
| Kontroler | routing, kody HTTP, dekoratory uprawnień; `@Public()` tylko z przemyśleniem, czy widok okrojony jest spójny |
| Zapis | każda operacja zapisu loguje zdarzenie w dzienniku (`action` zgodne z tabelą w [docs/API.md](docs/API.md)) |
| Frontend | hooki w `lib/queries.ts` i klucze w `qk`; typy w `types.ts` (pole ukryte przed gościem = opcjonalne, nie `null`) |
| Uprawnienia | nowe uprawnienie dodaj w `auth/permissions.ts` **i** w `PERMISSIONS` w `apps/web/src/types.ts` |
| Konfiguracja nginx | każde `location` z `add_header` musi mieć `include` nagłówków — test tego pilnuje |

### Testy

- `node:test` + `tsx`, bez bazy danych i bez kontenerów.
- Nazwy przypadków opisują zachowanie po polsku i w cudzysłowie:
  `it('pusty PATCH nie wywala — to był błąd produkcyjny', …)`.
- Testuj funkcje czyste (`buildOrderBy`, `mapPatchDto`, `toPublicView`,
  `AuditService.diff`, politykę haseł) i pliki konfiguracyjne (nginx, `.env`).
- Test, który opisuje **dlaczego** istnieje, jest warty przeczytania — wzór
  findeł w `test/nginx-config.test.ts`.

### Migracje

- `make migrate` po zmianie `schema.prisma`; migracja jest **commitowana**
  (historia wdrożenia).
- Nie edytuj migracji już zastosowanych.
- Zmiany destrukcyjne: najpierw `make backup`, dopiero potem migracja.

## Commity

Proponowany format (Conventional Commits) — krótko, po polsku, z jedną
zmianą logiczną w commicie:

```
typ(działanie/opis)

Dlaczego ta zmiana i jaki ma skutek. Konkretne zachowanie, nie ogólniki.
```

Typy: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `chore`, `perf`.

Przykłady:

```
fix(apps): PATCH nie zerował pól pominiętych w ładunku

mapPatchDto brał mapę z mapDto() i przepisywał do niej wszystkie klucze,
więc brak pola w ładunku kasował wartość bez błędu. Teraz do `data` trafiają
tylko pola obecne w żądaniu.
```

## Wydanie (zmiana kodu → działająca aplikacja)

**Jedyna droga to `make release`.** Nie buduj przez `docker compose build`
i nie podnoś wersji ręcznie — obie drogi dają obraz, w którym plakietka
w prawym dolnym rogu pokazuje `v0.0.0-dev`, bo `APP_VERSION` trafia do
obrazu jako argument budowania, a zwykłe `docker compose` go nie podaje.

```bash
make release
```

Skrypt (`scripts/release.sh`) wykonuje po kolei:

1. **Sprawdza stan repozytorium** — przerywa na brudnym drzewie, na
   gałęzi innej niż `main` i na commicie, który ma już tag. Wersja,
   commit, tag i obraz muszą opisywać ten sam stan.
2. **`npm test` i `make typecheck`** — wersja jest podbijana *po*
   testach, więc zielone testy są warunkiem wydania.
3. **`npm version patch`** — `1.0.0` → `1.0.1`. To jedyne miejsce,
   które zna reguły podbijania; skrypt nie wyznacza wersji obok.
4. **Commit `release: 1.0.1` i tag `v1.0.1`.** Bez `--git-tag-version`,
   bo domyślny commit npm brzmiałby po angielsku i bez kontekstu.
5. **Buduje i uruchamia** z `APP_VERSION` podstawionym z `package.json`.
6. **Weryfikuje zawartość bundla** — szuka wersji w plikach obrazu,
   a nie ufa wyjściu `docker compose`. Ten krok istnieje, bo build
   potrafi przejść, a wersja i tak nie trafi do interfejsu.
7. **Wysyła commit i tag na GitHub.**

Warianty:

```bash
make release-dry             # pokaże, co zrobi, niczego nie zmienia
./scripts/release.sh --no-push   # zbuduje lokalnie, bez wysyłania
```

Wersja rośnie co wydanie, więc po każdej zmianie w kodzie dostajesz
inny numer — to pozwala odpowiedzieć na pytanie „co jest zainstalowane
u klienta” bez zaglądania do kontenera.

### Kiedy `make release` nie wystarczy

- **Zmiana `schema.prisma`** — najpierw `make db-up && make migrate`
  i dołącz migrację do commita. Migracja musi być w repozytorium,
  inaczej kontener API nie wstanie na serwerze.
- **Zmiana `install.sh`** — dodatkowo `bash -n install.sh`.
- **Poprawka w tekście** — `docs: …` wystarczy, wersja rośnie i tak.

### Poza `make release`

Te cele są do prac w trakcie dnia i **nie podbijają wersji**:

| Cel | Po co |
|---|---|
| `make up` | start / restart istniejących obrazów, z wersją z `package.json` |
| `make build` | zbuduj obrazy, nie uruchamiaj |
| `make rebuild` | to samo od zera, bez cache |
| `make dev-api`, `make dev-web` | praca lokalna, Vite na 5173 |

## Wersjonowanie

Wersja to pole `version` w **głównym** `package.json`. Podnosi ją
`make release` (patrz wyżej) — ręcznie nie ruszaj, bo wtedy plakietka
w interfejsie i numer w `package.json` rozjadą się:

```bash
npm version minor        # 1.0.0 → 1.1.0; tylko przy wydaniu dużej wersji
git push --follow-tags  # tag musi trafić na GitHub razem z commitem
```

Domyślnie `make release` podbija tylko patch (`1.0.0` → `1.0.1`), bo
każda zmiana w kodzie ma dostać swój numer. `minor` zostaw sobie na
wydania, które faktycznie zmieniają interfejs API lub model danych.

`npm version` **nie rusza** `apps/api/package.json` ani
`apps/web/package.json` — to konsekwencja npm workspaces, w których
każdy pakiet ma własny manifest. Ich wersje zostaną na `1.0.0`; nie
poprawiaj tego ręcznie, bo tylko rozdzieli historię.

Wersja trafia do interfejsu (plakietka w prawym dolnym rogu) przez
`make release` i `make up`, które czytają ją z `package.json` i przekazują
jako argument budowania obrazu. Budowanie wprost przez
`docker compose build` bez `APP_VERSION` daje w UI `v0.0.0-dev` — to
celowe, żeby dało się rozpoznać obraz zbudowany poza makefile.

## Przegląd zmian

Checklista dla autora PR-a i dla recenzenta:

- [ ] `npm test` i `make typecheck` przechodzą
- [ ] po zmerowaniu na `main` zrobione `make release`, a plakietka pokazuje nową wersję
- [ ] nowa logika ma test tam, gdzie to możliwe bez I/O
- [ ] endpointy mają `@RequirePermission` (albo świadomy komentarz o `@Public()`)
- [ ] zapis loguje zdarzenie w dzienniku, a `changes` nie wpycha całych opisów
- [ ] nowe pola w DTO mają transformację i komunikaty po polsku
- [ ] widok publiczny nie ujawnia nowych pól poufnych (i test to pilnuje)
- [ ] dokumentacja zaktualizowana, gdy zmienia się API, env, komendy lub model
- [ ] `.env.example` zaktualizowany, jeśli doszła zmienna środowiskowa
- [ ] `README.md` nadal zgadza się z liczbą testów i stanem projektu
- [ ] migracja dołączona do commita (jeśli zmiana schematu)

## Dokumentacja

Dokumenty żyją w `docs/` i w korzeniu:

| Plik | Zakres |
|---|---|
| `README.md` | punkt wejścia: co to jest, szybki start, komendy |
| `docs/ARCHITEKTURA.md` | komponenty, przepływ żądania, decyzje i ich koszt |
| `docs/API.md` | endpointy, parametry, błędy, sesje |
| `docs/BAZA-DANYCH.md` | modele, pola, indeksy, migracje |
| `docs/ROZWOJ.md` | praca lokalna, testy, konwencje, typowe problemy, znane niedociągnięcia |
| `docs/WDROZENIE.md` | instalacja produkcyjna, kopie, aktualizacje, granice |
| `SECURITY.md` | model bezpieczeństwa, ograniczenia, checklista |

Dokumentacja nie trafia do obrazów Dockera (`.dockerignore`), więc można ją
pisać swobodnie, bez wpływu na rozmiar wdrożenia.
