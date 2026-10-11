# IPAM — katalog adresów IP w rejestrze oprogramowania

Data: 2026-10-11
Status: zatwierdzony

## Problem

Rejestr oprogramowania (`web-inv`) opisuje aplikacje, w tym te hostowane samodzielnie
(`DeliveryType.SELF_HOSTED`), które dziś mają tylko `baseUrl`, `hostingLocation`
i `adminTeam`. Nie ma miejsca, gdzie trzyma się adresy IP i podsieci. Efekt:
infrastruktura jest opisywana w wolnym polu tekstowym, a ten sam adres może
pojawić się w kilku wpisach niespójnie.

## Cel

Katalog podsieci i adresów IP, oraz powiązanie każdej aplikacji `SELF_HOSTED`
z adresami, które wykorzystuje. Bez automatycznego przydzielania adresów.

## Poza zakresem (v1)

- automatyczne przydzielanie wolnych adresów,
- podsieci IPv6 (walidator odrzuca świadomie, nie cicho),
- eksport CSV dla IPAM,
- skanowanie z serwera (wymagałoby `CAP_NET_RAW` w kontenerze API i otwiera
  powierzchnię SSRF — świadomie odrzucone),
- import portów, MAC i producentów z nmap (pola nie ma w modelu),
- mechanizm rezerwacji i terminów.

## Decyzje

| # | Decyzja | Powód |
|---|---------|-------|
| 1 | Katalog podsieci + adresów, bez automatycznego przydzielania | organizacyjny katalog, nie allocator |
| 2 | Relacja aplikacja ↔ adres many-to-many | jeden adres (VIP, brama, WAF) służy wielu usługom |
| 3 | Pola podsieci i adresu: zestaw podstawowy | mniej pól do utrzymania |
| 4 | Dedykowana sekcja IPAM + sekcja na karcie aplikacji | przegląd i edycja z dwóch stron |
| 5 | ADMIN edytuje, VIEWER czyta | spójne z rolami aplikacji |
| 6 | Walidacja CIDR w TypeScript, kolumny `VarChar` | spójne z resztą schematu, pełne wsparcie Prisma Migrate |
| 7 | Osobne uprawnienia `ipam:read` / `ipam:write` | adresy IP to inna kategoria danych niż aplikacje |
| 8 | `PUT` wymieniający cały zestaw przypisań | formularz wysyła pełną listę |
| 9 | `status` na `IpAddress`, nie na relacji | adres bywa zarezerwowany bez aplikacji |
| 10 | Import z pliku nmap XML, nie skan z serwera | serwer nie dotyka sieci; brak `CAP_NET_RAW`, brak ryzyka SSRF |
| 11 | Dopasowanie po CIDR do najwęższej podsieci | węższa podsieć opisuje faktyczny segment |
| 12 | Ekran podsumowania przed zapisem | import nadpisujący opisy bez podglądu jest nieodwracalny |
| 13 | `lastSeenAt` na `IpAddress` | import wypełnia katalog, ale bez daty nie mówi co zniknęło z sieci |

## 1. Model danych

```prisma
enum IpStatus {
  FREE
  IN_USE
  DEPRECATED
}

model Subnet {
  id          String   @id @default(uuid()) @db.Uuid
  name        String   @unique @db.Citext
  cidr        String   @db.VarChar(18)     // "10.20.0.0/16"
  description String?  @db.Text
  color       String   @default("slate") @db.VarChar(30)
  vlan        Int?     @db.SmallInt
  location    String?  @db.VarChar(200)
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  addresses   IpAddress[]
  @@map("subnets")
}

model IpAddress {
  id          String   @id @default(uuid()) @db.Uuid
  subnetId    String   @map("subnet_id") @db.Uuid
  subnet      Subnet   @relation(fields: [subnetId], references: [id], onDelete: Cascade)
  address     String   @db.VarChar(18)     // "10.20.1.15"
  status      IpStatus @default(FREE)
  description String?  @db.Text
  // Ostatni raz potwierdzony skanem — patrz sekcja 5
  lastSeenAt  DateTime? @map("last_seen_at")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  applications ApplicationIpAddress[]
  @@unique([subnetId, address])
  @@map("ip_addresses")
}

model ApplicationIpAddress {
  applicationId String      @map("application_id") @db.Uuid
  ipAddressId   String      @map("ip_address_id") @db.Uuid
  application   Application @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  ipAddress     IpAddress   @relation(fields: [ipAddressId], references: [id], onDelete: Cascade)
  createdAt     DateTime    @default(now()) @map("created_at")
  @@id([applicationId, ipAddressId])
  @@index([ipAddressId])
  @@map("application_ip_addresses")
}
```

W `Application` dochodzi relacja:

```prisma
ipAddresses ApplicationIpAddress[]
```

### Uzasadnienia

**Brak zakresów adresów.** Rekord reprezentuje pojedynczy adres IPv4. Zakres
(np. `10.20.1.10-10.20.1.20`) nie mieści sie w `VarChar(18)` — dodanie go
wymagałoby osobnej walidacji i osobnego modelu kolizji. Wartość pojawia się,
gdy realnie jej potrzebujemy.

**`status` na `IpAddress`, nie na relacji.** Adres jest zarezerwowany, ale nie
jeszcze przypisany — to stan, którego relacja nie potrafi odwzorować. Serwis
nie przymusza kompatybilności `status` i przypisań; pilnuje tylko, żeby
soft-delete aplikacji przywracał `FREE`.

**Brak soft-delete na `Subnet`.** `IpAddress` i przypisania kasują się kaskadowo.
Podsieć bez adresów nie ma wartości, a soft-delete przy kaskadzie i tak nie
działa. **Konieczne zabezpieczenie UI:** potwierdzenie usunięcia pokazuje liczbę
adresów i przypisań, które znikną razem z podsiecią.

**Kolizja zakresów jest błędem.** Dwie podsieci o nakładających się zakresach
opisywałyby ten sam obszar, a unikalność `IpAddress` przestałaby cokolwiek
znaczyć. Serwis odrzuca taką konfigurację z nazwą kolidującej podsieci.

**`Application.deletedAt` (soft delete) a kaskada.** Usunięcie aplikacji musi
usunąć jej przypisania IP, a status adresów wrócić do `FREE`. Obsługa
w `ApplicationsService.remove`.

## 2. Walidacja CIDR

Nowy modul `apps/api/src/ipam/cidr.ts` — czyste funkcje, bez zależności:

```
parseCidr(text) -> { network, prefix, broadcast, first, last } | null
isValidIpv4(text) -> boolean
containsSubnet(child: Cidr, parent: Cidr) -> boolean
sortCidrs(list: Cidr[]) -> Cidr[]
```

Używane przez DTO (format) i serwis (zawieranie, kolizje). Sortowanie numeryczne
po prefiksie, nie leksykograficzne — inaczej `10.9.0.0/8` sortowałoby się po
`10.10.0.0/8`.

## 3. API

Nowy modul `apps/api/src/ipam/` obok `applications/`:
`ipam.module.ts`, `ipam.controller.ts`, `ipam.service.ts`, `cidr.ts`, `dto/`.

Prefiks `/api/ipam`:

| Metoda | Ścieżka | Uprawnienie |
|---|---|---|
| GET | `/subnets` | `ipam:read` |
| GET | `/subnets/:id` | `ipam:read` |
| POST | `/subnets` | `ipam:write` |
| PATCH | `/subnets/:id` | `ipam:write` |
| DELETE | `/subnets/:id` | `ipam:write` |
| GET | `/subnets/:id/addresses` | `ipam:read` |
| POST | `/subnets/:id/addresses` | `ipam:write` |
| PATCH | `/addresses/:id` | `ipam:write` |
| DELETE | `/addresses/:id` | `ipam:write` |
| GET | `/addresses/:id/applications` | `ipam:read` |
| GET | `/applications/:appId/ip-addresses` | `app:read` |
| PUT | `/applications/:appId/ip-addresses` | `app:write` |
| POST | `/import/preview` | `ipam:write` |
| POST | `/import/apply` | `ipam:write` |

`GET /subnets` zwraca listę z `addressCount` i `applicationCount`.
`GET /subnets/:id` zwraca podsieć, jej adresy i przypisane aplikacje.
`PUT` przyjmuje `{ ipAddressIds: string[] }` i zapisuje różnicę transakcyjnie.

### Uzasadnienia

**Osobne uprawnienia.** Dodane do `PERMISSIONS`: VIEWER → `ipam:read`,
ADMIN → `ipam:read` + `ipam:write`, SUPER_ADMIN → oba. Osobne, bo adresy IP to
dane o infrastrukturze i naturalnie rozdzielą się role. Koszt dodania —
jedna linijka; koszt wycofania `app:write` z edycji IP po wdrożeniu —
migracja danych i zmiana uprawnień.

**Osobny kontroler dla tras aplikacji.** `applications.controller.ts` ma już
ponad 150 linii, a `@Controller` przyjmuje jeden prefiks. `IpamController`
obsługuje też trasy `applications/:appId/...`, korzystając z
`ApplicationsService` tylko do walidacji istnienia aplikacji.

**Klamry w odpowiedziach** — `{ subnets, total }`, `{ subnet }`, zgodnie
z konwencją `applications`.

**Błędy.** `ConflictException` z `{ conflictingSubnet: { name, cidr } }` przy
nakładaniu zakresów i duplikacie adresu; `BadRequestException` przy adresie
spoza podsieci oraz przy zmianie CIDR, który nie mieści istniejących adresów.
Komunikaty po polsku — UI pokazuje je wprost.

**Audyt.** `AuditLog` z `entity: 'subnet'` / `'ip_address'`, zmiany diffem pól.
Wymiana przypisań logowana jako jeden wpis na aplikację
(`action: 'ip_addresses.update'`), inaczej audyt zaśmiecałby się przy każdym
checkboxie.

## 4. UI

**Nawigacja** — wpis w `NAV` (`AppLayout.tsx`): `/ipam`, „Adresy IP",
`permission: 'ipam:read'`, `requiresAuth: true`. IPAM wymaga zalogowania — to
wewnętrzna mapa infrastruktury, nie treść publiczna jak rejestr aplikacji.

**Trasy:**

```
/ipam                             → IpamListPage
/ipam/nowa                        → SubnetFormPage
/ipam/:id                         → SubnetDetailPage
/ipam/:id/edycja                  → SubnetFormPage
```

**`IpamListPage`** — tabela podsieci: nazwa, CIDR, VLAN, liczba adresów
(wolne / zajęte), liczba aplikacji, kolor. Wiersz rozwija się drill-downiem i
pokazuje adresy podsieci bez nawigacji. Nagłówek podsumowuje liczbę podsieci,
adresów i wolnych adresów.

**`SubnetDetailPage`** — pełna lista adresów podsieci: adres, status, opis,
przypisane aplikacje (linki do kart), akcje edycji i usunięcia.

**Sekcja na aplikacji** — nowa `<section className="card-section">` obok
„Dostęp i wsparcie" w `ApplicationDetailPage.tsx` oraz pole w
`ApplicationFormPage.tsx`: wielokrotny wybór adresów grupowany po podsieciach,
z wyszukiwarką. Sekcja warunkowa: tylko gdy `deliveryType === 'SELF_HOSTED'`,
zgodnie z istniejącą logiką bloków zależnych od typu dostarczenia. Niewidoczna
dla gościa — `ipam:read` wymaga sesji.

**Formularze** — `SubnetFormPage` obsługuje dodanie i edycję jednym
komponentem, jak `ApplicationFormPage`. Walidacja CIDR po stronie klienta daje
natychmiastowy komunikat; prawdziwa walidacja i tak jest po stronie API.

**Pliki:**

| Plik | Rola |
|---|---|
| `apps/web/src/pages/IpamListPage.tsx` | lista podsieci + drill-down |
| `apps/web/src/pages/SubnetDetailPage.tsx` | adresy jednej podsieci |
| `apps/web/src/pages/SubnetFormPage.tsx` | dodanie/edycja podsieci |
| `apps/web/src/components/ipam/AddressTable.tsx` | tabela adresów |
| `apps/web/src/components/ipam/IpAddressPicker.tsx` | wybór w formularzu aplikacji |
| `apps/web/src/lib/queries.ts` | hooki + klucze `qk.ipam*` |
| `apps/web/src/pages/ImportPage.tsx` | wgranie pliku, podgląd, zatwierdzenie |
| `apps/web/src/types.ts` | `Subnet`, `IpAddress`, `IpStatus`, odpowiedzi |

Nowy katalog `components/ipam/` — komponenty są specyficzne dla domeny i nie
pasują do `components/ui/`, które jest warstwą prezentacyjną bez wiedzy
o domenie.

## 5. Import z pliku nmap XML

`nmap -oX wynik.xml 10.20.0.0/24` na stacji skanującej → wgranie pliku do
przeglądarki → podgląd → zapis. **Serwer nie skanuje.**

**Dlaczego nie skan z serwera.** Panel wysyłający zakres zamienia aplikację w
sondę sieciową: każdy zalogowany `ADMIN` (a w razie CSRF także klikający w link,
nie logując się) mógłby kazać serwerowi odpytać dowolny zakres w sieci
wewnętrznej. Do tego `nmap` w kontenerze API wymagałby `CAP_NET_RAW` albo
`setcap`, a skan trwa minuty i nie mieści się w synchronicznym request/response.
Import z pliku omija wszystkie trzy problemy.

**Parsowanie** — nowa zależność `fast-xml-parser` (lekka, bez zależności).
Moduł `apps/api/src/ipam/nmap-xml.ts`:

```
parseNmapXml(xml: string) -> { hosts: ScannedHost[], issues: ParseIssue[] }
type ScannedHost = { address: string; hostname: string | null }
```

Wyciągamy **tylko adres i hostname**. Porty, MAC i vendor pomijamy — nie mają
miejsca w modelu.

**Zabezpieczenia parsera** (plik od użytkownika = dane niezaufane):
`processEntities: false` (blokuje billion-laughs i XXE), limit uploadu **5 MB**,
limit **10 000** hostów. Uszkodzony XML → `BadRequestException` z czytelnym
powodem, nie stack trace.

**Przepływ trzykrokowy:**

1. `POST /api/ipam/import/preview` → `{ new: [], existing: [], unmatched: [] }`.
   `existing` niesie porównanie opisów. **Nic nie jest zapisywane.**
2. `ImportPage` pokazuje trzy grupy z checkboxami; domyślnie zaznaczone `new`.
   `unmatched` wymaga wskazania podsieci — bez niej zapis jest odrzucany
   (`BadRequest`), bo przypisanie w ciemno do najszerszej podsieci byłoby błędem.
3. `POST /api/ipam/import/apply` → `{ selections: [{ address, subnetId, description }] }`.
   Serwis **nie dopasowuje ponownie** — dane z ekranu ktoś obejrzał i zatwierdził.
   Zapis w `$transaction`, `upsert` per adres.

**Dopasowanie po CIDR** — host trafia do **najwęższej** zawierającej go podsieci
(`10.20.5.0/24` zamiast `10.20.0.0/16`). Reguła w `cidr.ts`, testowalna bez bazy.

**Idempotencja** — powtórny import nie tworzy duplikatów: `upsert` aktualizuje
opis zamiast tworzyć drugi rekord.

**Zmiana modelu** — `IpAddress` dostaje `lastSeenAt DateTime?`, ustawiane przy
importzie. Bez tego import wypełnia katalog, ale nie mówi nic o tym, co zniknęło
z sieci. Dodajemy od razu, bo migracja później wymagałaby ponownego wgrania.

**Audyt** — jedno zdarzenie: `entity: 'subnet'`, `action: 'ip_addresses.import'`,
`changes: { subnetName, count, source: 'nmap-xml' }`, bez listy setek adresów.

**Instrukcja w UI** — stały blok na ekranie importu z poleceniem
`nmap -oX wynik.xml <zakres>`, podpowiedzią `-sn` i zastrzeżeniem o uprawnieniach
root na stacji skanującej.

**Uprawnienia** — `ipam:write` dla `preview` i `apply`.

### Testy importu

`nmap-xml.test.ts` na fixture'ach: host bez hostname, `<host>` bez `<address>`,
wiele adresów na hoście (IPv4 i IPv6), uszkodzony XML, encje w hostname,
plik 50 MB → odrzucenie.

`ipam-import.test.ts`: dopasowanie do najwęższej podsieci, `unmatched` bez podsieci
→ `BadRequest`, podwójny import → brak duplikatów, `lastSeenAt` ustawiane.

## 6. Testy

**`ipam-cidr.test.ts`** — czysty kod, najwyższa wartość:
poprawny CIDR; odrzucenie `10.20.0.0/33`, `999.1.1.1/8`, `10.20.0.0` (brak
prefiksu), CIDR z ustawionymi bitami hosta; `containsSubnet` dla tożsamych,
zawartych, rozłącznych, sąsiadujących; `broadcast` dla `/24` i `/30`;
sortowanie numeryczne (`10.9.0.0/8` przed `10.10.0.0/8`).

**`ipam-service.test.ts`** — utworzenie podsieci; odrzucenie kolizji zakresu
z nazwą kolidującej podsieci w komunikacie; zmiana CIDR na mniejszy nieobejmujący
istniejących adresów → `BadRequest`; adres spoza podsieci → `BadRequest`;
duplikat adresu w podsieci → `Conflict`; usunięcie podsieci kaskaduje na adresy
i przypisania; `PUT` wymieniający zestaw — dodanie, usunięcie, pusty zestaw,
`ipAddressId` spoza istniejących podsieci.

**`ipam-permissions.test.ts`** — spójność `PERMISSIONS` z `ALL_PERMISSIONS`
(wzorzec: `permissions.test.ts`): VIEWER ma tylko `ipam:read`, ADMIN ma
`ipam:write`, każde `ipam:*` figuruje w `ALL_PERMISSIONS`. To najczęstszy błąd
przy dodawaniu uprawnienia — pominięcie wpisu w `ALL_PERMISSIONS` po cichu
osłabia walidację.

**`ipam-app-delete.test.ts`** — soft-delete aplikacji zdejmuje przypisania IP
i odblokowuje status adresów.

**Frontend** — istniejące `ui-class-syntax.test.ts` i `ui-css-builds.test.ts`
obejmą nowe klasy automatycznie. Dołożymy test, że `IpamListPage` renderuje się
dla użytkownika z `ipam:read` i nie pokazuje przycisków edycji bez `ipam:write`.

## 7. Edge-case'y świadomie nieobsłużone w v1

Spisane, żeby nie wróciły jako zgłoszony błąd:

- podsieci IPv6 — walidator odrzuca jawnie, nie cicho,
- jeden adres współdzielony przez wiele aplikacji — dozwolone, bywa realne dla
  VIP-ów i bram,
- eksport CSV dla IPAM — rejestr aplikacji go ma, tu dorobimy gdy poproszą,
- IPv6 w pliku nmap XML — pomijane po cichu przy mapowaniu, bo model jest IPv4.

## 8. Kolejność wdrożenia

1. migracja Prisma i schema
2. `cidr.ts` + testy jednostkowe
3. `ipam.service.ts` + DTO
4. kontroler, uprawnienia, rejestracja modułu
5. hooki i typy po stronie weba
6. `IpamListPage`, `SubnetDetailPage`, `SubnetFormPage`
7. sekcja IP w `ApplicationDetailPage` i `ApplicationFormPage`
8. testy serwisu, uprawnień, soft-delete
9. audyt, potwierdzenie kaskadowego usunięcia podsieci
10. `nmap-xml.ts` + `fast-xml-parser`, `ImportPage` (preview → podgląd → apply)
11. dokumentacja: `docs/API.md`, `docs/BAZA-DANYCH.md`, `docs/ARCHITEKTURA.md`
