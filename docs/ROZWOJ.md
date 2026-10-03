# Rozwój

## Instalacja

```bash
git clone <adres-repo> web-inv
cd web-inv
npm ci
```

Wymagany Node.js ≥ 22 (`npm ci` korzysta z `package-lock.json`; wersje
zależności są przypięte dokładnie).

Przepełnienie workspace'ów na inne katalogi (`npm i --prefix …`) nie działa —
`npm ci` w monorepo potrzebuje manifestu głównego i obu pakietów jednocześnie.

## Dwa tryby pracy

### A. Całość w Dockerze (jak na serwerze)

```bash
make init     # raz: .env z losowymi sekretami
make up       # buduje obrazy, stos na http://localhost:8080
make logs     # logi na żywo
make down
```

Do zmiany kodu trzeba przebudować obraz: `make rebuild` (bez cache) albo
`make build && make restart`. To najbliższe produkcji, ale najwolniejsze w
pracy dniowej.

### B. Kod lokalnie, baza w Dockerze (zalecane do pracy)

```bash
make db-up    # baza z portem DB_DEV_PORT na hoście (domyślnie 55432)
make migrate # zastosuj/zrób migrację (prisma migrate dev)
make dev-api  # API w watchu: http://localhost:3000
make dev-web  # Vite:            http://localhost:5173
```

Vite dev server proxyuje `/api` na `http://localhost:3000`
(`apps/web/vite.config.ts`), więc w przeglądarce używasz tylko portu 5173.
Sekrety dla lokalnego startu (`SESSION_SECRET`, `SEED_ADMIN_PASSWORD`) wczytuje
Compose; przy `make dev-api` musisz je mieć w powłoce albo w `.env` wczytanym
ręcznie:

```bash
set -a; . ./.env; set +a
npm run dev:api
```

## Polecenia

| Polecenie | Kiedy |
|---|---|
| `npm test` | przed każdym pushem |
| `make typecheck` / `npm run typecheck` | przed każdym pushem |
| `bash -n install.sh` | przy zmianach w instalatorze (CI sprawdza to samo) |
| `make studio` | podgląd danych (port 5555) |
| `make psql` / `make shell` | psql w kontenerze bazy / shell w kontenerze API |
| `make backup` / `make restore f=…` | kopia lokalna |
| `make reset` | **kasuje bazę** — potwierdzenie w terminalu |

## Testy

`npm test` = `typecheck:test` + `tsx --test test/*.test.ts` w `apps/api`.
Testy **nie potrzebują bazy ani kontenerów** — to warte zachowania: każda
funkcja, którą da się przetestować bez I/O, jest testowana bez I/O.

| Plik | Co sprawdza |
|---|---|
| `application-dto.test.ts` | walidację `CreateApplicationDto` / `UpdateApplicationDto` / `ListApplicationsQuery` dokładnie tak, jak robi to `ValidationPipe` w produkcji: puste liczby nie stają się zerem, `null` czyści pole, nieznane pole jest błędem, daty w formacie `RRRR-MM-DD`, zakresy, UUID-y, limity; plus `mapPatchDto`, `CREATE_FIELDS`, `isoDate`, `buildOrderBy` |
| `applications-patch.test.ts` | scalenie PATCH-a: pusty ładunek nie wywala, pominięte pola nie są zerowane, `null` czyści |
| `public-view.test.ts` | `toPublicView()` ukrywa `securityClass`, `criticality`, `owner`, `ownerId` i nie mutuje rekordu źródłowego |
| `public-filters.test.ts` | gość nie może filtrować ani sortować po ukrytych polach (inaczej wartość odzyskałaby się z liczby wyników lub kolejności wierszy) |
| `password.test.ts` | hashowanie i weryfikacja, w tym „atrapę” dla nieistniejącego konta; komunikaty odrzuceń |
| `password-parity.test.ts` | serwer i interfejs mówią to samo o polityce haseł: ta sama długość, ta sama lista popularnych haseł, zgodność na 500 losowych haseł |
| `permissions.test.ts` | komplet i sens przypisań ról → uprawnienia (m.in. że nie da się przez zwykłego panelu odebrać roli `SUPER_ADMIN`) |
| `audit.test.ts` | `AuditService.diff`: pomijanie pól niezmienionych, `0` ≠ `null`, przycinanie długich wartości i `_truncated` |
| `query-cache-401.test.ts` | zachowanie cache po utracie sesji (bez zapętlenia `useQuery`) |
| `seed-password.test.ts` | `assertSeedPasswordIsStrong` oraz to, że `.env.example` nie zawiera hasła przechodzącego politykę |
| `nginx-config.test.ts` | CSP zdefiniowana dokładnie raz, każde `location` z `add_header` ma `include` nagłówków, brak wycofanego `X-XSS-Protection`, zgodność polityki z buildem frontendu (brak `eval`, `import()` CSS, inline scriptów) i z tym, że API nie włącza CSP samo |
| `session-revoke.test.ts` | `RevokeSessionDto` odrzuca pusty payload i nie-UUID (bez tego `sessionId` było `undefined`, a `deleteMany` kasował wszystkie sesje użytkownika) |
| `eol-window.test.ts` | `eolWindow()` liczy granice od początku doby — `sunset_on` to `date`, więc porównanie z timestampem z godziną zaliczało „wycofywane dziś" do „po terminie" |
| `audit-filter.test.ts` | `buildAuditWhere()` filtruje po `entity` + `entityId` (historia jednego rekordu, nie wszystkich) |
| `audit-changes.test.ts` | `visibleChanges()` i `truncatedFields()` przy obu kształtach `_truncated` (lista nazw pól z `diff()` i `true` z listy zdarzeń) |
| `build-query.test.ts` | `buildQuery` przepuszcza `false` — filtr boolean musi dojechać do API, inaczej „tylko aktywne konta” jest ciche |
| `version.test.ts` | formatowanie wersji pokazywanej w interfejsie: prefiks `v`, brak podwajania, `null` bez ARG-a |

Stan: **253 przypadków, 33 suite'y, wszystkie przechodzą**, plus
`tsc --noEmit` w obu pakietach.

CI uruchamia dokładnie te dwa polecenia (`.github/workflows/ci.yml`).

## Konwencje

### Język

Komentarze, komunikaty błędów, etykiety UI i dokumentacja są **po polsku**.
Nazwy symboli, pól i plików — po angielsku (tak jest w całym ekosystemie).
Trasy frontu są po polsku i bez diakrytyków (`/aplikacje`, `/uzytkownicy`).

### Komentarze

Kod w tym repozytorium jest komentowany **podpowiednio**: nie tłumaczy, *co*
robi kod, tylko **dlaczego** tak, a nie inaczej, i co by się zepsuło przy
„posprzątaniu". Wzorzec:

```ts
/**
 * Leniwe sprzątanie wygasłych sesji — nie ma crona w tym projekcie,
 * więc robimy to tu, najwyżej raz na godzinę (limit w serwisie).
 */
```

Przed dopisaniem komentarza sprawdź, czy istniejący nie wyjaśnia tego samego.
Przed zmianą kodu, który ma komentarz wyjaśniający decyzję, **zaktualizuj
komentarz** — nie zostawiaj go w pastie.

### API

- kontroler: routing + dekoratory, bez reguł biznesowych;
- serwis: walidacja krzyżowa, budowa `where`/`orderBy` z **białych list**,
  scalanie PATCH-a, serializacja, audyt;
- nowe pole w DTO **musi** mieć transformację, jeśli przychodzi jako tekst
  lub pusta wartość (patrz `toOptionalNumber`, `emptyToUndefined`) — kolejność
  dekoratorów jest znacząca;
- nazwa pola sortowania trafia do `ORDER BY`, więc nowa kolumna wymaga wpisu w
  `SORTABLE` i (jeśli ma być ukryta przed gościem) poza `GUEST_SORTABLE`;
- nieznane pole w ładunku to błąd 400 — nie dodawaj pola „na wyrostek”;
- każda operacja zapisu zapisuje zdarzenie w dzienniku z akcją z tabeli
  w [API.md](API.md#dziennik-zdarzeń-apiaudit).

### Frontend

- jeden plik `lib/queries.ts` na hooki i jeden zestaw kluczy `qk`; nowe
  zapytanie dopisujemy tam, nie „obok";
- `types.ts` trzyma ręcznie pisane typy odpowiedzi; pole, którego publiczny
  odczyt nie zwraca, jest **opcjonalne** (`?:`), nie `null`;
- komponenty dostępnościowe i klasy Tailwinda z `index.css`; sprawdź kontrast
  w obu motywach (jasne tło w trybie ciemnym jest nieczytelne — stąd podwójne
  klasy `dark:` w `types.ts`);
- nowy widok dostępny dla gościa musi respektować cięcia z
  [ARCHITEKTURA.md](ARCHITEKTURA.md#6-widok-publiczny-a-pełny).

## Dodawanie endpointu — checklista

1. DTO w `dto/*.dto.ts` z komunikatami po polsku i jawnymi transformacjami.
2. Metoda w serwisie: walidacja referencji, `AuditService.record()` po zapisie.
3. Kontroler: `@RequirePermission(...)`, `@Public()` tylko jeśli endpoint ma być
   dostępny bez sesji — i wtedy sprawdź, czy widok okrojony jest spójny.
4. Hook w `apps/web/src/lib/queries.ts` + typ w `apps/web/src/types.ts`.
5. Test w `apps/api/test/` — na funkcjach czystych, bez bazy.
6. `npm test && make typecheck`.

## Migracje po zmianie schematu

```bash
make db-up
make migrate            # prisma migrate dev — pyta o nazwę migracji
```

Potem `npm run prisma:generate`, jeśli migracja sama tego nie zrobiła.
Migracja trafia do `apps/api/prisma/migrations/` i **jest commitowana** —
to historia wdrożenia, nie lokalny śmieć.

## Typowe problemy

| Objaw | Przyczyna i rozwiązanie |
|---|---|
| `Brak wymaganej zmiennej środowiskowej: …` przy starcie API | brak sekretu w środowisku. Lokalnie: `set -a; . ./.env; set +a`. W kontenerze: `make init` + edycja `.env` |
| `SESSION_SECRET musi mieć co najmniej 32 znaki` | `openssl rand -hex 32` i podmiana w `.env` |
| `did not initialize yet` przy starcie kontenera API | klient Prisma nie wygenerowany w etapie obrazu — `make rebuild` |
| `type citext does not exist` przy `migrate dev` | shadow database bez rozszerzenia; zadziałaj `initShadowDb` z `prisma.config.ts`, nie ręcznie usuwaj migracji |
| `P1001 Cannot reach database` | baza nie działa — `make ps`, `docker compose logs db` |
| Ciasteczko sesji nie działa po zmianie `SESSION_SECRET` | stare sesje są nieważne (w bazie jest skrót starego tokenu) — zaloguj się ponownie |
| 404 na `/api/...` w produkcji | nginx przepuszcza tylko ścieżki `/api/`; ścieżka bez prefiksu `/api` idzie do SPA |
| Konto wisi na „Musisz najpierw ustawić własne hasło” | flaga `mustChange_password` — zaloguj się i zmień hasło w `/konto` albo zresetuj hasło przez super admina (hasło z `.env` po utworzeniu konta nie działa) |
| Baza startuje, ale jest „nieznane środowisko” | kontener bazy powstał przed włączeniem `citext` — skrypty initdb działają tylko przy pierwszym `initdb`; potrzebny `make reset` albo `CREATE EXTENSION citext;` ręcznie |
| `docker compose` nie widzi `.env` | uruchamiaj `make`/`docker compose` z katalogu repozytorium |

## Znane niedociągnięcia

Utrzymywane świadomie albo do poprawki — warto wiedzieć, zanim zaczniesz
szukać błędu „w kodzie":

1. **Filtr dziennika po `entityId` nie istnieje.** Klient wysyła
   `entityId`, kontroler go ignoruje, więc „historia zmian” na stronie
   aplikacji pokazuje ostatnie zdarzenia typu encji, nie jednego rekordu.
   Naprawa: dodać `@Query('entityId')` w `AuditController.list` i warunek
   w `where` (indeks `(entity, entity_id)` już jest).
2. **Limit zapytań liczony per IP, na instancję.** Za NAT-em kilka osób
   dzieli limit, po restarcie kontenera liczniki startują od zera, przy
   kilku instancjach API nie są wspólne (brak Redis).
3. **Brak retencji dziennika zdarzeń.** Tabela rośnie w nieskończoność; przy
   dużym ruchu warto dodać `retentionDays` i sprzątanie (`make` celowo nie ma
   crona — patrz `SessionsService.purgeExpiredAtMostHourly`).
4. **`/api/applications/stats`, `/api/applications/export` i `/api/users/options`
   wymagają sesji**, choć reszta odczytu jest publiczna. Dla gościa to
   świadoma decyzja (statystyki ujawniają ukryte pola, eksport byłby drogą do
   tych samych danych), ale warto o tym wiedzieć.
5. **Dwa miejsca do zsynchronizowania przy nowym polu uprawnień:**
   `apps/api/src/auth/permissions.ts` i `PERMISSIONS` w `apps/web/src/types.ts`
   (test zgodności dotyczy haseł, nie uprawnień).
