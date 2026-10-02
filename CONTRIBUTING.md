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

   Zmiana w `install.sh` wymaga dodatkowo `bash -n install.sh`
   (albo `shellcheck install.sh`, jeśli masz go zainstalowane).

4. Commit i pull request z krótkim opisem **co się zmienia i dlaczego**.

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

## Przegląd zmian

Checklista dla autora PR-a i dla recenzenta:

- [ ] `npm test` i `make typecheck` przechodzą
- [ ] nowa logika ma test tam, gdzie to możliwe bez I/O
- [ ] endpointy mają `@RequirePermission` (albo świadomy komentarz o `@Public()`)
- [ ] zapis loguje zdarzenie w dzienniku, a `changes` nie wpycha całych opisów
- [ ] nowe pola w DTO mają transformację i komunikaty po polsku
- [ ] widok publiczny nie ujawnia nowych pól poufnych (i test to pilnuje)
- [ ] dokumentacja zaktualizowana, gdy zmienia się API, env, komendy lub model
- [ ] `.env.example` zaktualizowany, jeśli doszła zmienna środowiskowa
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
