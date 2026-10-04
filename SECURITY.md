# Bezpieczeństwo

## Zgłaszanie problemu

To repozytorium jest prywatne i należy do organizacji. Podatności i błędy
bezpieczeństwa zgłasz **bez publicznego issue** — bezpośrednio do administratora projektu (właściciel repozytorium, konto GitHub
`Ravaeel9`) i ustal kanał (e-mail organizacji, bezpieczny komunikator).
Podanie w issue jest równoznaczne z publikacją.

W zgłoszeniu przyda się: opis zachowania, kroki reprodukcji (najlepiej żądanie
HTTP i odpowiedź), warunki (rola użytkownika, zalogowany czy gość), wpływ na
dane, propozycja poprawki.

Nie publikuj w dzienniku zdarzeń ani w repozytorium danych wrażliwych, które
opisały problem.

## Model zagrożeń

Chronimy: dostęp do panelu (zapis rejestru, konta, dziennik zdarzeń) oraz
**klasyfikowane dane** w rejestrze (klasyfikacja bezpieczeństwa, krytyczność,
właściciel aplikacji) przed osobami niezalogowanymi.

Świadomie nie chronimy: dostępności publicznego odczytu rejestru — to jest
funkcja produktu, a nie podatność. Publiczny odczyt to lista aplikacji
z wersjami, opisami i linkami, bez pól poufnych.

## Co jest zaimplementowane

### Uwierzytelnianie i sesje

| Mechanizm | Gdzie |
|---|---|
| Hasła w Argon2id (`memoryCost=19456`, `timeCost=2`, `parallelism=1`) | `apps/api/src/auth/password.ts` |
| Polityka haseł: ≥ 12 znaków, wielka i mała litera, cyfra, znak specjalny, odrzucane typowe hasła; max. 200 znaków | tamże + kopia w UI objęta testem zgodności |
| Jednakowy komunikat błędu logowania („konto nie istnieje” i „złe hasło” brzmią tak samo) | `auth.service.ts` |
| Weryfikacja „na atrapie” dla nieistniejącego konta — czas odpowiedzi nie zdradza, czy konto istnieje | `password.ts` |
| Sesja w ciasteczku `httpOnly`, `sameSite=lax`, `secure` z konfiguracji; brak `localStorage`, brak tokenu w JS | `sessions.service.ts` |
| W bazie **wyłącznie skrót** tokenu (SHA-256) — wyciek bazy nie pozwala podszyć się pod sesję | `password.ts`, `sessions.service.ts` |
| Limit bezczynności (2 dni) i wygaśnięcie (`SESSION_TTL_DAYS`), sprzątanie leniwe | `sessions.service.ts` |
| Unieważnianie wszystkich sesji przy zmianie hasła, resetach, zmianie roli i wyłączeniu konta | `auth.service.ts`, `users.service.ts` |
| Panel „Moje konto” pozwala zobaczyć i zakończyć własne sesje | `AccountPage.tsx` |
| Konto z hasłem nadanym przez administratora nie wchodzi w nic poza `/konto` — wymusza to **guard**, nie UI | `auth.guard.ts` |

### Autoryzacja

- Uprawnienia zdefiniowane raz (`auth/permissions.ts`) i egzekwowane w guardzie:
  `@RequirePermission('app:write')` na każdym zapisie, `user:write` tylko dla
  `SUPER_ADMIN`.
- Ochrona przed utratą jedynego super administratora (zdegradowanie roli,
  usunięcie konta) i przed wyłączeniem/zmianą roli własnego konta.
- Nie da się usunąć konta będącego właścicielem aplikacji.
- Uprawnienia i role użytkownika sprawdzane są **przy każdym żądaniu** — zmiana
  roli natychmiast unieważnia sesje, więc nie działa „stare uprawnienie”.

### Widok publiczny

- Pola poufne (`securityClass`, `criticality`, `ownerEmail`) są usuwane
  **z odpowiedzi** na serwerze, nie ukrywane w HTML.
- Filtry i sortowanie po tych polach są **ignorowane** dla gościa — kolejność
  wierszy i liczba wyników nie mogą zdradzić ukrytej wartości.
- Wyszukiwanie po nazwisku właściciela/administratora jest wyłączone dla gościa
  (samo trafienie zdradzałoby imię).
- Granica przypięta testami (`public-view.test.ts`, `public-filters.test.ts`).

### Wejście (walidacja i injekcje)

- Globalny `ValidationPipe` z `whitelist` + `forbidNonWhitelisted`: nieznane pole
  w ładunku jest błędem 400, a nie cichym odrzuceniem.
- Nazwa kolumny sortowania przechodzi przez **białą listę** (`SORTABLE`,
  `GUEST_SORTABLE`) — nigdy nie trafia do `ORDER BY` z klienta.
- Zapytania budowane przez Prisma (parametryzowane); nie ma sklejania SQL
  w kodzie aplikacji.
- Zapisy znoszące dane potwierdza UI, ale **to nie ochrona serwera** — dostęp
  chroni `app:write`/`user:write`.

### Nagłówki i transport

| Nagłówek | Wartość |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=()` |
| `X-XSS-Protection` | **nie ustawiamy** (dyrektywa wycofana; ochronę daje CSP) |

- CSP ustawia wyłącznie nginx (`snippets/security-headers.conf`); API ma CSP
  wyłączone, bo zwraca tylko JSON. Spójność pilnuje test `nginx-config.test.ts`
  (polityka jest zdefiniowana dokładnie raz i pasuje do realiów buildu: bez
  `eval`, bez `import()` CSS, bez inline scriptów).
- Dodatkowo `@fastify/helmet` w API (te nagłówki są dublowane świadomie, żeby
  nie dało się ich wyłączyć poza kontenerem nginx).
- Brak zewnętrznych skryptów, fontów i połączeń sieciowych w UI.

### Sieć i ekspozycja

- Baza danych **nie wystawia portu** — dostęp tylko z sieci wewnętrznej Compose.
  Nakładka `docker-compose.dev.yml` istnieje wyłącznie do prac lokalnych.
- API nie jest wystawione na host; jedyny port to ten z nginx (`APP_PORT`).
- `trustProxy: true` w Fastify + `X-Forwarded-*` od nginx — limity i dziennik
  widzą prawdziwe IP klienta.
- Limity żądań: 300/min na IP globalnie, osobno konfiguracyjny limit logowania.

### Dziennik zdarzeń

- Logowane są: logowania (udane, nieudane, zablokowane), wylogowania, zmiany i
  resety haseł, unieważnione sesje, wszystkie operacje na rejestrze i kontach —
  z aktorem, IP i User-Agentem.
- Wartości w `changes` są **przycinane** do 200 znaków, żeby nie zapisywać
  całych opisów w kolumnie JSON.
- Nazwa aktora jest kopiowana do wpisu (`actor_name`), więc historia przeżywa
  usunięcie konta.

### Sekrety

- `.env`, `backups/`, `graphify-out/` są w `.gitignore`; `.dockerignore` pilnuje,
  żeby sekrety i dokumentacja nie trafiły do obrazów.
- Brak wymaganych sekretów = **kontener nie wstaje** (`required()` w
  `config/configuration.ts`).
- `SESSION_SECRET` musi mieć ≥ 32 znaki; zmiana unieważnia wszystkie sesje
  (świadomie).
- Konto startowe wymusza zmianę hasła przy pierwszym logowaniu; słabe
  `SEED_ADMIN_PASSWORD` blokuje start (także gdy konto już istnieje).

## Świadome ograniczenia

Nie są bugami do zgłoszenia, ale trzeba o nich wiedzieć przed wystawieniem
aplikacji:

1. **Brak TLS w kontenerze.** Nginx nasłuchuje na HTTP. Do HTTPS potrzebne
   reverse proxy + `COOKIE_SECURE=true` (procedura w
   [docs/WDROZENIE.md](docs/WDROZENIE.md#https)).
2. **Brak uwierzytelniania dwuskładnikowego, SSO, LDAP/OIDC.** Hasło jest
   jedynym czynnikiem. Kompensacja: silna polityka haseł, sesje z możliwością
   zakończenia zdalnie, dziennik nieudanych prób, limit logowania.
3. **Limit logowania liczony per IP.** Za NAT-em lub VPN-em kilka kont dzieli
   limit; brak limitu per konto, brak blokady po nieudanych próbach (tylko
   dziennik). Liczniki są w pamięci instancji — restart je zeruje.
4. **Brak limitu rozmiaru i retencji dziennika oraz sesji poza sprzątaniem.**
   Przy dużym wolumenie tabela `audit_logs` rośnie w nieskończoność
   (wymaga planowania pojemności albo dodania retencji).
5. **Brak uwierzytelnienia na publicznym odczycie.** Rejestru nie da się
   ukryć hasłem ani wyłączyć go dla gościa — to funkcja produktu. Jeśli ma być
   zamknięty, trzeba ograniczyć dostęp sieciowo (firewall/proxy).
6. **Brak szyfrowania danych w spoczynku** (baza i wolumen zależą od hosta).
   Szyfrowanie dysku na warstwie hosta jest obowiązkiem operatora.
7. **`X-Forwarded-For` jest ufany.** API ufa nagłówkom (konieczne przy proxy).
   Jeśli kiedykolwiek API dostałoby bezpośredni dostęp z sieci publicznej,
   limity per IP da się obejść podszywając nagłówek. Nie wystawiaj API wprost.
8. **Brak eksportu i importu całego rejestru** (jest tylko CSV, maks. 10 000
   rekordów) oraz brak API integracji (webhooki, sync).
9. **Kopia zapasowa to zwykły `pg_dump`** — plik na dysku, w katalogu projektu
   domyślnie. Traktuj ją jak dane wrażliwe i trzymaj poza repozytorium.

## Checklista przed wystawieniem poza organizację

- [ ] reverse proxy z HTTPS i przekierowaniem `http → https`
- [ ] `COOKIE_SECURE=true`
- [ ] `HSTS` + `upgrade-insecure-requests` dopiero po potwierdzeniu działającego TLS
- [ ] `CORS_ORIGINS` puste (same-origin) albo ściśle wskazane domeny
- [ ] `SEED_ADMIN_PASSWORD` wygenerowane, konto super admina z własnym hasłem
- [ ] `SESSION_SECRET` i `POSTGRES_PASSWORD` losowe, `SESSION_TTL_DAYS` dobrane do potrzeb
- [ ] port `APP_PORT` niepubliczny, jeśli rejestr ma być dostępny tylko wewnątrz
- [ ] baza nieosiągalna z sieci (nie używasz `docker-compose.dev.yml`)
- [ ] `docker compose up -d` jako konto nieuprzywilejowane (root w grupie `docker` to root na hoście)
- [ ] kopie zapasowe poza katalogiem repozytorium, jedna przetestowana
- [ ] `make typecheck` i `npm test` przechodzą na wdrażanej rewizji
- [ ] wyłączne logi i dostęp do hosta zabezpieczone (ssh, firewalld/ufw)
