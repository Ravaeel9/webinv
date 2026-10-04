# Przebudowa kategorii oprogramowania na typ dostarczenia

Data: 2026-10-04

## Problem

Encją w repo jest `Application` (`applications`, `/api/applications`, `/aplikacje`).
„Kategoria" to dziś jedna kolumna wolnego tekstu `Application.category String?` —
bez słownika, bez walidacji, bez kontrolki w UI. Wpisuje się tam wartości
domenowe („Finanse", „HR", „Infrastruktura"), przez co agregacja na pulpicie
rozpada się na warianty wielkości liter i pisowni.

Realne potrzeby są inne: rejestr musi rozróżniać **aplikacje ogólnego użytku**
(7-Zip, czytnik PDF) od **usług hostowanych** — lokalnie (self-hosted) i SaaS.
Dla usług potrzebny jest rozszerzony opis: kto i jak prowadzi wsparcie oraz dane
kontaktowe do wsparcia. Dzisiejszy model nie ma na to miejsca.

## Decyzje

| # | Decyzja |
|---|-------|
| 1 | `category` (wolny tekst) zostaje **usunięta bez śladu**. Wszystkie istniejące rekordy dostają `GENERAL_USE`, poprawki robi się ręcznie w UI. |
| 2 | Typ dostarczenia to **enum Prisma**, nie słownik w bazie — nie planujemy dodawania typów z UI. |
| 3 | Wartości: `GENERAL_USE`, `SELF_HOSTED`, `SAAS`, `VENDOR_MANAGED`. |
| 4 | Wsparcie to **jeden wspólny blok** pól, pokazywany warunkowo. Nie osobny model. |
| 5 | Pola wsparcia/hostingu są **zawsze opcjonalne** (walidacja miękka — formularz podpowiada, ale nie blokuje zapisu). |
| 6 | Zmiana typu na `GENERAL_USE` **nie czyści** danych — zostają w bazie, tylko ich nie widać. |
| 7 | Widok publiczny (gość): `deliveryType` i `baseUrl` widoczne; `adminTeam`, `hostingLocation` i cały blok wsparcia **ukryte po stronie serwera**. |

## Model danych

Trzy nowe typy enums:

```prisma
enum DeliveryType {
  GENERAL_USE
  SELF_HOSTED
  SAAS
  VENDOR_MANAGED
}

enum SupportOwnerType {
  INTERNAL
  VENDOR
}

enum SupportChannel {
  EMAIL
  PHONE
  PORTAL
  CHAT
  ON_SITE
}
```

W `Application` dodajemy blok „dostarczanie i wsparcie":

| Pole | Typ | Uwagi |
|---|---|---|
| `deliveryType` | `DeliveryType @default(GENERAL_USE)` | jedyne pole z `NOT NULL` |
| `baseUrl` | `String? @db.VarChar(500)` | adres dostępowy do usługi |
| `hostingLocation` | `String? @db.VarChar(200)` | gdzie fizycznie stoi |
| `adminTeam` | `String? @db.VarChar(200)` | kto technicznie zarządza |
| `supportOwnerType` | `SupportOwnerType?` | kto prowadzi wsparcie |
| `supportOwnerName` | `String? @db.VarChar(200)` | kto konkretnie |
| `supportEmail` | `String? @db.Citext` | e-mail do zgłoszeń |
| `supportUrl` | `String? @db.VarChar(500)` | portal zgłoszeń |
| `supportChannel` | `SupportChannel?` | główny kanał |
| `supportNotes` | `String? @db.Text` | proces zgłaszania, uwagi |

Plus indeks `@@index([deliveryType])`. Usuwamy `category` i `@@index([category])`.

W DTO nie używamy `@IsEnum` z Prisma — repo ma już konwencję `as const` + `@IsIn`
z polskimi komunikatami (`SECURITY_CLASSES`, `APP_STATUSES`). Nowe listy:
`DELIVERY_TYPES`, `SUPPORT_OWNER_TYPES`, `SUPPORT_CHANNELS`.

Świadomie **bez** pól `supportPhone`, `supportHours`, `supportSla` (rozważane,
odrzucone).

## API

- `CreateApplicationDto`: `category` → `deliveryType` + 9 pól support/hosting.
  `supportEmail` walidowany `@IsEmail`, `baseUrl`/`supportUrl` przez `@IsUrl`
  (wzorem `websiteUrl`). Wszystkie 10 pól **musi** być zadeklarowane w DTO —
  `mapPatchDto` rzuca wyjątkiem na zmapowane pole spoza `CREATE_FIELDS`.
- `ListApplicationsQuery`: `?category=` → `?deliveryType=` (`@IsIn`).
- `SORTABLE` i `GUEST_SORTABLE`: `category` → `deliveryType`.
- `PUBLIC_HIDDEN_FIELDS` += `supportOwnerType`, `supportOwnerName`, `supportEmail`,
  `supportUrl`, `supportNotes`, `adminTeam`, `hostingLocation`.
- `stats`: `groupBy(['deliveryType'])` **bez `take: 12`** i bez `NOT: {null}` —
  cztery wartości, zero ucinania. Klucz odpowiedzi `byCategory` → `byDeliveryType`.
- Wyszukiwanie `q`: usuwamy `category` z `contains` (na enumie nie ma `contains`).
- Eksport CSV: `Kategoria` → `Typ dostarczenia` + 9 nowych kolumn.

## Frontend

- `types.ts`: `Application` (10 nowych pól, bez `category`),
  `ApplicationFilters.deliveryType`, `Stats.byDeliveryType`, oraz mapy
  `DELIVERY_TYPE_LABELS`, `DELIVERY_TYPE_DESCS`, `SUPPORT_OWNER_LABELS`,
  `SUPPORT_CHANNEL_LABELS`.
- `ApplicationFormPage`: `Select "Typ dostarczenia"` z podpowiedziami. Dla typów
  hostowanych warunkowo renderowane panele *Dostęp i hosting* oraz *Wsparcie*.
  Wartości pozostają w stanie formularza przy zmianie typu w obie strony, więc
  payload zawsze je zawiera — ukrycie tylko wizualne.
- `ApplicationsListPage`: nowa kontrolka filtra `Select "Typ dostarczenia"`
  (dziś żadnej nie ma), chip, kolumna w tabeli i karcie.
- `DashboardPage`: „Najczęstsze kategorie" → „Podział wg typu dostarczenia".
- `ApplicationDetailPage`: podpis z etykietą typu; panele *Dostęp i hosting*
  i *Wsparcie* tylko dla typów hostowanych i tylko dla zalogowanych (gość
  nie dostaje tych pól z API). `FIELD_LABELS` w `ApplicationDetailPage`
  i `AuditPage` dostają polskie nazwy nowych pól.

## Migracja

`20261004120000_owner_email` jest precedensem (ręcznie pisane SQL z komentarzami).
Kolejność kroków:

1. `CREATE TYPE` × 3.
2. `ADD COLUMN` × 10 (`delivery_type` z `NOT NULL DEFAULT 'GENERAL_USE'`,
   reszta nullable).
3. `CREATE INDEX applications_delivery_type_idx`.
4. `DROP INDEX applications_category_idx`, `DROP COLUMN category`.

## Testy

- `application-dto.test.ts`: `deliveryType: ''` odrzucane; poprawna wartość
  przechodzi; błędna wartość odrzucana z polskim komunikatem; `supportEmail`
  walidowany.
- `applications-patch.test.ts`: wszystkie 10 nazw pól zadeklarowane w DTO.
- `public-filters.test.ts`: filtr `deliveryType` działa dla gościa.
- `public-view.test.ts`: ukryte pola znikają, `deliveryType`/`baseUrl` zostają.
- `audit.test.ts`: dane testowe na nowych polach.

## Dokumentacja

`docs/API.md` (filtr, sortowanie, pole DTO), `docs/BAZA-DANYCH.md`
(kolumny, indeksy, nowe typy enums).

## Poza zakresem

- Osobny model `Supplier` / `License` — dziś `vendor` i `license` to tekst.
- Rejestrowanie historii zmian dostawcy wsparcia.
- Pola `supportPhone`, `supportHours`, `supportSla`.
- Słownik kategorii domenowych (odrzucony wraz z `category`).
