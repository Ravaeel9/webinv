# Matryca uprawnień do aplikacji — specyfikacja

Data: 2026-10-15
Status: design zatwierdzony, do przeniesienia do `docs/superpowers/specs/` po wyjściu z trybu plan

## 1. Problem i cel

Rejestr oprogramowania wie, kto jest administratorem aplikacji **w panelu**
(`Application.admins` → konta `User`). Nie wie natomiast, kto w ogóle ma dostęp do
aplikacji — a są to przede wszystkim osoby spoza panelu, którym dostęp nadaje się
w narzędziu IAM. Brakuje ewidencji tej informacji.

Celem jest moduł **matrycy uprawnień**: lista osób mających dostęp do każdej
aplikacji, z poziomem dostępu i danymi identyfikacyjnymi (imię, nazwisko,
stanowisko, dział), prowadzona **wyłącznie jako ewidencja**.

**Zakres świadomie wyłączony:** system nie mechanizmuje nadania dostępu. Nie
wystawia tokenów, haseł ani zgłoszeń do IAM. Nie tworzy kont panelowych dla tych
osób. Dostęp nadaje się poza systemem; rejestr potwierdza, kto go ma.

## 2. Granice z istniejącym systemem

- `Application.admins` (`User[]`) **zostaje bez zmian** — to osobna rzecz: kto może
  edytować kartę aplikacji w panelu.
- `User` **nietknięty** — osoby z ewidencji nigdy nie stają się kontami, nie mają
  roli, sesji ani haseł.
- Widok publiczny **bez zmian** — matrycy nie pokazuje (dane osobowe).
- Panelowe uprawnienia (`VIEWER` / `ADMIN` / `SUPER_ADMIN`) działają jak dotąd,
  powiększone o `access:read` i `access:write`.

## 3. Model danych

```prisma
enum AccessLevel {
  OWNER     // właściciel
  ADMIN     // administrator
  USER      // użytkownik
  READ_ONLY // tylko odczyt
}

model Person {
  id         String   @id @default(uuid()) @db.Uuid
  firstName  String   @map("first_name") @db.VarChar(100)
  lastName   String   @map("last_name")  @db.VarChar(100)
  email      String   @unique @db.Citext
  position   String?  @db.VarChar(150)  // stanowisko — wolny tekst
  department String?  @db.VarChar(150)  // dział — wolny tekst
  isActive   Boolean  @default(true) @map("is_active")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  access ApplicationAccess[]

  @@index([lastName])
  @@map("persons")
}

model ApplicationAccess {
  applicationId String      @map("application_id") @db.Uuid
  personId      String      @map("person_id") @db.Uuid
  level         AccessLevel @default(USER)
  grantedOn     DateTime    @default(now()) @map("granted_on") @db.Date
  expiresOn     DateTime?   @map("expires_on") @db.Date
  note          String?     @db.Text
  createdAt     DateTime    @default(now()) @map("created_at")

  application Application @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  person      Person      @relation(fields: [personId], references: [id], onDelete: Cascade)

  @@id([applicationId, personId])
  @@index([personId])
  @@index([expiresOn])
  @@map("application_access")
}
```

Ustalenia:

- `email` wymagany i unikalny w `persons` — jednoznaczna tożsamość osoby, bez niej
  ta sama osoba wstępuje wielokrotnie.
- `position` i `department` to wolny tekst — bez tabel słowników, żeby zmiana
  struktury organizacyjnej nie wymagała migracji.
- `expiresOn` wygasa dostęp wizualnie, ale nie kasuje wiersza — historia zostaje.
- Kasowanie osoby to `isActive=false` (dezaktywacja), nie `DELETE` — macierze innych
  aplikacji muszą pozostać czytelne.
- Kaskady z aplikacji są uzasadnione: usunięcie aplikacji nie może zostawić
  wiszących przypisań.

## 4. API

Nowy moduł `apps/api/src/access/` (`access.module.ts`, `access.controller.ts`,
`access.service.ts`, `dto/access.dto.ts`), rejestrowany w `app.module.ts`.

| Metoda | Ścieżka | Uprawnienie | Zastosowanie |
|---|---|---|---|
| GET | `/api/access/applications/:id` | `access:read` | macierz dla aplikacji |
| POST | `/api/access/applications/:id` | `access:write` | dodanie osoby do aplikacji (tworzy `Person`, jeśli nie istnieje) |
| PATCH | `/api/access/applications/:id/:personId` | `access:write` | poziom, `expiresOn`, `note` |
| DELETE | `/api/access/applications/:id/:personId` | `access:write` | usunięcie przypisania (osoba zostaje w katalogu) |
| GET | `/api/access/persons` | `access:read` | katalog osób: wyszukiwanie, filtr dział/aktywność |
| GET | `/api/access/persons/:id` | `access:read` | osoba + lista przypisań |
| POST | `/api/access/persons` | `access:write` | nowa osoba |
| PATCH | `/api/access/persons/:id` | `access:write` | edycja danych osoby |
| DELETE | `/api/access/persons/:id` | `access:write` | dezaktywacja (`isActive=false`) |
| GET | `/api/access/matrix` | `access:read` | macierz zbiorcza: `applicationId`, `department`, `personId`, `level` |

`GET /api/access/matrix` zwraca płaską listę wierszy
`{ application, person, level, grantedOn, expiresOn, note }` — pod raport
„kto z działu X ma dostęp do czego" i pod eksport CSV.

### Walidacja i reguły (w serwisie, nie tylko w DTO)

1. Ponowny e-mail w `persons` → `409 Conflict`; odpowiedź podpowiada istniejący
   `personId`, żeby panel mógł zaproponować „dodaj do macierzy zamiast tworzyć”.
2. Ta sama osoba dwa razy w jednej aplikacji → `409`.
3. Nieaktywna osoba (`isActive=false`) nie da się dodać do macierzy → `400`.
   Istniejące przypisania zostają, UI pokazuje ostrzeżenie.
4. `expiresOn` w przeszłości: dozwolone przy **edycji** (porządkowanie danych),
   odrzucone przy **dodaniu** → `400`.
5. `Person` nigdy nie otrzymuje roli, sesji ani hasła.

DTO (`class-validator`, wzorzec z `auth/dto/auth.dto.ts`): `firstName`/`lastName`
1–100 znaków, `email` `@IsEmail` + maks 200, `level` z enumu, `expiresOn`
`@IsDateString`, `note` maks 2000 znaków.

## 5. Uprawnienia panelu

W `apps/api/src/auth/permissions.ts`:

- `access:read` i `access:write` trafiają do `ADMIN` i `SUPER_ADMIN`.
- `VIEWER` nie dostaje żadnego z nich.
- Nowe nazwy dopisywane są do `ALL_PERMISSIONS`, żeby test kompletności ich nie
  pominął.

Osobne uprawnienia zamiast ponownego użycia `app:write` — dziś tożsame, ale
pozwalają później wyłączyć edycję osobom z samym odczytem bez zmian w kontrolerach.

## 6. Interfejs

### Sekcja w karcie aplikacji

`ApplicationDetailPage.tsx`, nowa `card-section` „Uprawnienia do aplikacji"
po „Dostęp i wsparcie":

- kolumny: Imię i nazwisko | Stanowisko | Dział | Poziom (badge
  `OWNER`/`ADMIN`/`USER`/`READ_ONLY`) | Nadano | Wygasa | akcje;
- wiersze z `expiresOn` w przeszłości lub `person.isActive=false` mają
  ostrzegawcze tło i badge „wygasł" / „nieaktywna";
- „Dodaj osobę" tylko przy `access:write`: modal z e-mailem (podpowiednia
  z katalogu, wykrywa duplikat i proponuje istniejącą osobę), imieniem, nazwiskiem,
  stanowiskiem, działem, poziomem, datą wygaśnięcia i uwagą;
- edycja danych osoby z poziomu matrycy aktualizuje rekord w katalogu.

### Pozycja menu „Uprawnienia"

`/panel/uprawnienia`, widoczna wyłącznie dla ADMIN i SUPER_ADMIN:

- katalog osób: imię i nazwisko, stanowisko, dział, e-mail, liczba aplikacji,
  aktywność; filtry dział/aktywność + wyszukiwarka;
- macierz zbiorcza z filtrami aplikacja / dział / poziom;
- eksport CSV (styl istniejącego eksportu aplikacji);
- po kliknięciu osoby: jej dane + lista przypisań + „Dodaj do aplikacji".

Frontend w istniejących wzorcach: `lib/queries.ts` (hooki React Query),
`lib/api.ts` (`credentials: 'include'`), `types.ts` (typy `Person`,
`ApplicationAccess`, `AccessLevel`), `router.tsx` + `components/layout/guards.tsx`
(`RequirePermission`), pozycja w `AppLayout.tsx`.

## 7. Dziennik zdarzeń

| Zdarzenie | `entity` | `changes` |
|---|---|---|
| `access.granted` | `ApplicationAccess` | poziom i daty; przy pierwszym nadaniu także `{ person: { from: null, to: "Jan Kowalski (IT)" } }` |
| `access.updated` | `ApplicationAccess` | `AuditService.diff` po poziomie i datach |
| `access.revoked` | `ApplicationAccess` | `{ person: { from: "Jan Kowalski (IT)", to: null } }` |
| `person.created` / `person.updated` | `Person` | `AuditService.diff` po imieniu, nazwisku, stanowisku, dziale, aktywności |
| `person.deactivated` | `Person` | `{ isActive: { from: true, to: false } }` |

Wpisy trafiają na dotychczasową stronę „Dziennik zdarzeń" (`audit:read`) — bez
zmian w kodzie audytu.

## 8. Testy

Vitest + supertest, wzorzec z `apps/api/test/`:

- serwis: dodanie tworzy `Person` + przypisanie; ponowny e-mail → 409; ta sama
  osoba dwa razy w aplikacji → 409; nieaktywna osoba → 400; `expiresOn` w przeszłości
  przy dodaniu → 400, przy edycji → 200; usunięcie przypisania zostawia osobę;
  dezaktywacja osoby nie kasuje macierzy;
- uprawnienia: VIEWER dostaje 403 na wszystkich endpointach modułu; ADMIN i
  SUPER_ADMIN dostają 201;
- macierz zbiorcza: filtry `department` / `level` / `applicationId`; wygasłe
  przypisania pozostają w wyniku;
- audyt: każda operacja zapisuje dokładnie jeden wpis z poprawnym `action`;
- `permissions.ts`: test kompletności `ALL_PERMISSIONS` obejmuje nowe nazwy;
- Prisma: migracja przechodzi na czystej bazie; seed demo dodaje 2–3 osoby z
  przypisaniami, żeby ekran nie był pusty w instalacji próbnej.

## 9. Migracja i wdrożenie

Jedna nowa migracja SQL: enum `AccessLevel`, tabela `persons`, tabela
`application_access` z indeksami. Bez ruszania istniejących danych — nic nie jest
przenoszone ani kasowane. `install.sh` bez zmian (migracje idą przez Prisma).

## 10. Dokumentacja

- `docs/BAZA-DANYCH.md` — tabele `persons`, `application_access`, enum `AccessLevel`
- `docs/API.md` — 12 endpointów modułu `access` (macierz, CRUD osób i przypisań,
  import CSV `preview`/`apply`)
- `docs/ARCHITEKTURA.md` — moduł `access` i jawna granica: ewidencja, nie mechanizm
  nadania dostępu
- `README.md` — punkt „Uprawnienia do aplikacji" i „Import osób z CSV" w sekcji
  „Co potrafi"

## 11. Import osób z CSV

Osobny podmoduł modułu `access`: `apps/api/src/access/csv.ts` (parser i
auto-detekcja, testowalne bez bazy) + dwa endpointy w stylu istniejącego importu
nmap (`preview` → `apply`, plik jako tekst w JSON, bez multipart).

Zakres: import **wypełnia katalog osób**. Nie nadaje dostępu do aplikacji —
poziom nadaje się ręcznie w macierzy, bo plik nie jest wiarygodnym źródłem
uprawnień.

### Założenia

- Wejście: CSV do 2000 wierszy i 2 MB, kodowanie UTF-8 lub Windows-1250.
  Dekodowanie robi przeglądarka (`TextDecoder`), API przyjmuje tekst — tak jak
  przy imporcie nmap. Stałe `MAX_CSV_BYTES` i `MAX_PERSON_ROWS` eksportowane
  z `csv.ts`, żeby testy nie powielały liczb.
- Separator `,` lub `;`, cudzysłowy i escapowane separatory obsłużone w parserze,
  BOM zjadany przy wejściu.
- Auto-detekcja nagłówków polskich i angielskich z eksportu Workspace
  (`First name`, `Last name`, `Email`, `Department`, `Job title`, `Suspended`,
  `Archived`, …). Nierozpoznane nagłówki UI pozwala przypisać do pól ręcznie,
  po czym podgląd leci ponownie z poprawionym `mapping`.
- Wymagane: `email`, `firstName`, `lastName`. Opcjonalne: `position`,
  `department`, status aktywności.
- Kolumna statusu (`Suspended`, `Archived`, `Nieaktywny`) steruje `isActive`:
  zawieszenie w Workspace od razu wyłącza osobę.
- Wiersz bez e-maila, z błędnym e-mailem albo z samymi pustymi imieniem
  i nazwiskiem → `ERROR` z powodem, nigdy nie trafi do zapisu.

### API

| Metoda | Ścieżka | Uprawnienie | Zastosowanie |
|---|---|---|---|
| POST | `/api/access/import/preview` | `access:write` | `{ csv, mapping? }` → wiersze `NEW`/`UPDATE`/`ERROR` + powody, podsumowanie, wykryte mapowanie |
| POST | `/api/access/import/apply` | `access:write` | wybrane wiersze, **ponownie zwalidowane po stronie serwera**, zapis |

Polityka duplikatów: e-mail obecny już w `persons` → `UPDATE` (nadpisujemy imię,
nazwisko, stanowisko, dział i `isActive`). Osoby brakującej w pliku **nie**
dezaktywujemy — brak w pliku niczego nie znaczy.

### Interfejs

W stronie „Uprawnienia" przycisk „Importuj z CSV", trzy kroki: plik → podgląd z
mapowaniem kolumn i listą błędów → zapis. Wizualnie i strukturalnie wprost jak
`ImportPage` dla nmap: odznaczanie wierszy, grupowanie „nowe / do aktualizacji /
błędne", podsumowanie przed zapisem.

### Audyt

Jedno zdarzenie `person.imported` (`entity: 'Person'`) z liczbami nowych,
zaktualizowanych i pominiętych — nie tysiąc pojedynczych wpisów na import.

### Testy

parser CSV (cudzysłowy, `;`, BOM, puste pola), auto-detekcja nagłówków PL/EN,
klasyfikacja wierszy, limit 2000 wierszy i 2 MB, `UPDATE` po istniejącym e-mailu,
ponowna walidacja w `apply` (modyfikacja danych po podglądzie nie przechodzi),
dezaktywacja przez `Suspended`, brak dezaktywacji osób nieobecnych w pliku,
VIEWER dostaje 403.

## 12. Świadomie poza zakresem

Mechanizm nadawania dostępu, eksport do IAM, tokeny, konta panelowe dla osób
z ewidencji, powiązanie osoby z `User`, widoczność matryzy w widoku publicznym,
słowniki działów i stanowisk, zatwierdzanie/przegląd macierzy workflow,
nadawanie dostępu do aplikacji z pliku CSV, import XLSX, import dzielony na
portcje przetwarzane w tle.
