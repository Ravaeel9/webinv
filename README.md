# Rejestr Oprogramowania

Aplikacja webowa do prowadzenia rejestru oprogramowania używanego w organizacji:
jakie aplikacje mamy, kto za nimi odpowiada, w jakich środowiskach działają, ile
kosztują i kiedy mają zostać wycofane.

## Co potrafi

- **Rejestr aplikacji** — pełna karta każdej aplikacji: nazwa, wersja, opis,
  właściciel i administrator, status wdrożenia (`PROD`, `TEST`, `DEV`,
  `PLANNED`, `DEPRECATED`, `RETIRED`), klasyfikacja bezpieczeństwa
  (`PUBLIC`…`RESTRICTED`), krytyczność biznesowa, koszt licencji, data
  wycofania, blok dostarczenia i wsparcia (typ, kanał, kontakt), wymagany
  formalny wniosek o dostęp. To centralne źródło prawdy o oprogramowaniu
  w organizacji — zamiast arkusza, o który nikt nie dba, jest wpis, za który
  odpowiada konkretna osoba.
- **Katalog adresów IP (IPAM)** — podsieci z CIDR, VLAN-em i opisem, adresy
  IP ze statusem (`FREE`, `IN_USE`, `DEPRECATED`) i przypisaniem do aplikacji
  typu `self-hosted`. Stawia pytanie „co stoi pod tym adresem?" w kilka sekund.
  Import z pliku nmap uzupełnia katalog wynikiem skanu — inwentaryacja
  realnego stanu zamiast ręcznego przepisywania.
- **Pulpit** — statystyki rejestru w jednym oknie: liczby aplikacji wg statusów
  i klasyfikacji oraz licznik aplikacji z terminem wycofania. Startowy ekran
  „co wymaga uwagi" dla administratora rejestru.
- **Wyszukiwanie i filtry** — po nazwie, statusie, klasyfikacji, właścicielu,
  środowisku i typie dostarczenia; filtry zapisują się w adresie URL, więc
  widok można udostępnić koledze albo podpiąć pod zakładkę (np. „wszystkie
  `SAAS` z klasyfikacją `CONFIDENTIAL`" jako stały link).
- **Eksport CSV** — bieżący zbiór wyników, razem z zastosowanymi filtrami.
  Materiał do rozliczeń, arkuszy budżetowych i załączeń do audytu.
- **Matryca uprawnień do aplikacji** — katalog osób (imię, nazwisko,
  stanowisko, dział — bez kont w panelu) i przypisania: kto ma dostęp do której
  aplikacji, na jakim poziomie (`OWNER`, `ADMIN`, `USER`, `READ_ONLY`), od kiedy
  i do kiedy. Wygasły dostęp nie znika — zostaje w macierzy z ostrzeżeniem,
  bo to historia nadania. Granica jest świadoma: **to ewidencja** — dostęp
  nadaje się w narzędziu IAM, rejestr pokazuje, komu go nadano. Import osób
  z CSV (np. eksport z Google Workspace) wypełnia katalog z podglądem
  i klasyfikacją wierszy przed zapisem.
- **Weryfikacje dostępów** — rejestr przeglądów macierzy: „dnia X osoba Y
  potwierdziła, że zapisane dostępy do tej aplikacji / wiersza / całej macierzy
  są aktualne". Wpis znacznikuje datę przeglądu na grantach w swoim zasięgu;
  zmiana poziomu dostępu unieważnia znacznik (stan po przeglądzie nie może
  udawać zweryfikowanego). Powtórka tego samego zasięgu w ciągu 24 godzin jest
  blokowana, a datę można odnotować najwyżej 180 dni wstecz — rejestr dowodzi
  cyklicznego przeglądu, nie „odświeżania" dat jednym kliknięciem.
- **Import macierzy z CSV** — okrężny z eksportem: plik wygenerowany przez
  rejestr można zmodyfikować i wgrać z powrotem jako upsert grantów (podgląd
  przed zapisem). Brak osoby w pliku nie odbiera jej dostępu — plik nigdy
  nie odbiera uprawnień.
- **Integracja GLPI** — import osób, oprogramowania i przypisań dostępów
  wynikających z członkostwa w grupach GLPI; podgląd przed zapisem, zapis
  tworzy wyłącznie nowe rekordy (rejestr nie nadpisuje tego, co człowiek
  dopisał ręcznie). Konfiguracja i import siedzą w panelu pod
  **Ustawienia → GLPI** (tylko super administrator). Stosunek do GLPI:
  rejestr jest uzupełnieniem — GLPI wie, co jest w grupach, rejestr wie,
  kto za co odpowiada i ile to kosztuje.
- **Tryb demonstracyjny** — wypełnienie bazy danymi próbnymi na czas
  prezentacji; włączenie, wyłączenie i kasowanie danych demo w **Ustawieniach**.
  Pokazanie systemu zarządowi bez ryzyka dla prawdziwej ewidencji.
- **Dziennik zdarzeń** — kto, co i kiedy zmienił, z dokładną różnicą pól
  (`from` → `to`), adresem IP i przeglądarką; logowane są też logowania
  (udane i nieudane). Odpowiedź na „kto to zmienił i kiedy" bez zaglądania
  do logów serwera.
- **Import adresów z pliku nmap** — uzupełnienie katalogu IP wynikiem skanu.
- **Motyw jasny i ciemny** — przełącznik w prawym górnym rogu.

## Kiedy się przydaje

Scenariusze, dla których rejestr był budowany:

- **Półroczny przegląd uprawnień** (audyt bezpieczeństwa): otwierasz macierz,
  przechodzisz aplikację po aplikacji z właścicielami, odnotowujesz
  weryfikację — rejestr trzyma „kto, kiedy, co potwierdził" i sam pilnuje,
  żeby nie odnotować dwa razy w jednym dniu. Dowód gotowy do załączenia.
- **Odprawa pracownika**: katalog osób → jego przypisania → lista aplikacji
  i poziomów do odebrania, z notatką przy każdym z nich. Nic nie umyka,
  bo macierz jest jedną tabelą, nie rozmowami na czacie.
- **Budżet i odnowienia licencji**: koszty + statusy + daty wycofania
  w jednym zbiorze; eksport CSV z filtrami daje materiał do planowania
  i arkuszy budżetowych bez ręcznego składania danych.
- **Planowanie wycofań aplikacji**: licznik na pulpicie pokazuje, co ma
  termin wycofania; właściciel i wsparcie są w karcie aplikacji, więc wiadomo,
  kogo powiadomić.
- **Awaria na serwerze**: „co działa pod 10.20.3.14?" — IPAM wskazuje
  przypisaną aplikację, a z nią właściciela i krytyczność biznesową.
- **Rozliczenie z dostawcą albo audytorem**: wysyłasz link do publicznego
  widoku — odbiorca sprawdzi, czy aplikacja istnieje, w jakiej jest wersji
  i środowisku, bez konta i bez wglądu w dane poufne.
- **Inwentaryzacja z GLPI**: import pokazuje różnicę między grupami GLPI
  a rejestrem; nowe zespoły i oprogramowanie wchodzą jednym podglądem
  i zatwierdzeniem.

## Dwa widoki

- **Publiczny** (bez logowania) — lista i szczegóły aplikacji, okrojone o dane
  poufne: klasyfikację bezpieczeństwa, krytyczność, właściciela oraz blok
  dostarczenia i wsparcia. Dzięki temu dostawca albo audytor sprawdzi, czy dana
  aplikacja w ogóle u nas jest, bez znajomości loginu i hasła.
- **Panel** (po zalogowaniu) — pełne dane, edycja, pulpit, katalog IP,
  macierz uprawnień do aplikacji i **Ustawienia**: konta, dziennik zdarzeń,
  tryb demo, integracja GLPI.

Granica jest egzekwowana **po stronie serwera** — brak sesji oznacza brak danych,
filtra i sortowania po polach poufnych, a nie tylko ich ukrycie w interfejsie.
Katalog IP należy wyłącznie do panelu: gość nie widzi nawet liczby podsieci.
Także macierz uprawnień — zawiera dane osobowe osób spoza panelu, więc
widzą ją tylko role z uprawnieniem `access:read` (administrator
i super administrator).

## Szybki start

Wymagania: Linux, Docker Engine 24+ z Compose v2, jeden wolny port, ~1 GB RAM
na działanie (2 GB albo swap na czas pierwszej instalacji).

```bash
git clone <adres-repozytorium> /opt/webinv
cd /opt/webinv
./install.sh
```

Instalator sprawdza wymagania, generuje sekrety, pyta o port, HTTPS i hasło
administratora, buduje kontenery i sprawdza, czy aplikacja odpowiada. Aplikacja
wystawia się pod `http://<adres-serwera>:8080`.

Bez instalatora (albo do prac lokalnych):

```bash
make init     # tworzy .env z losowymi sekretami
# edytuj .env i ustaw SEED_ADMIN_PASSWORD
make up       # buduje i uruchamia cały stos
```

Pełna instrukcja dla administratora serwera:
**[docs/INSTALACJA.md](docs/INSTALACJA.md)**.

## Pierwsze kroki po instalacji

- [ ] **Zmień hasło administratora** przy pierwszym logowaniu — aplikacja wymusi
      to sama, a konto z niezmienionym hasłem wchodzi wyłącznie na stronę „Moje
      konto".
- [ ] **Ustaw `COOKIE_SECURE=true`** w `.env` i wykonaj `make up`, jeśli aplikacja
      jest za HTTPS. Bez tego ciasteczko sesji działa także po HTTP.
- [ ] **Ogranicz dostęp firewallem** do portu aplikacji. Sama aplikacja nie ma
      listy dozwolonych adresów — ktoś, kto dotrze do portu, zobaczy publiczny
      rejestr i będzie mógł próbować się logować.
- [ ] **Sprawdź, że kopia bazy się tworzy:** `make backup`. Kopie trzymaj **poza
      katalogiem projektu** — zawierają nazwiska, adresy e-mail i koszty licencji.
- [ ] **Nie wypychaj `.env` do repozytorium.** Plik jest na liście ignorowanych, a
      instalator ustawia na nim prawa `600`.

## Codzienna obsługa

Wszystko kręci się wokół `Makefile`; pełna lista: `make help`.

| Polecenie | Kiedy |
|---|---|
| `make ps` | czy kontenery działają |
| `make logs` / `make logs api=api` | logi na żywo (wszystkie / tylko API) |
| `make restart` | restart bez przebudowy |
| `make down` / `make up` | zatrzymanie / uruchomienie (dane zostają) |
| `make backup` | kopia bazy do `backups/backup-YYYYMMDD-HHMMSS.sql.gz` |
| `make restore f=backups/…` | przywrócenie kopii — **nadpisuje obecne dane** |
| `make psql` | konsola PostgreSQL |
| `make rebuild` | przebudowa obrazów bez cache |
| `make reset` | **kasuje bazę i wolumen** (pyta o potwierdzenie) |

Logi kontenerów są limitowane (10 MB × 3 na kontener), więc nie rosną
w nieskończoność.

## Konta i role

Konto zakłada administrator (`admin` na starcie). Role:

| Rola | Co może |
|---|---|
| **Obserwator** | przeglądać rejestr, katalog IP i konta |
| **Administrator** | j.w. plus edycja rejestru, katalogu IP i macierzy uprawnień oraz zarządzanie kontami |
| **Super administrator** | j.w. plus panel ustawień (tryb demonstracyjny, kasowanie danych i dziennik zdarzeń) |

Konto z hasłem nadanym przez administratora wchodzi wyłącznie na stronę „Moje
konto" i musi ustawić własne hasło.

## Aktualizacja po zmianie kodu

```bash
git pull
make migrate   # tylko jeśli doszła zmiana w schema.prisma
make release   # podbicie wersji, build, start, tag, push
```

Bez `make release` plakietka wersji w interfejsie pokaże `v0.0.0-dev` —
szczegóły: [CONTRIBUTING.md](CONTRIBUTING.md#wydanie-zmiana-kodu--działająca-aplikacja).

## Dokumentacja

Administrator serwera zaczyna od **[docs/INSTALACJA.md](docs/INSTALACJA.md)**
i **[docs/WDROZENIE.md](docs/WDROZENIE.md)**. Reszta:

| Plik | Zawartość |
|---|---|
| [docs/INSTALACJA.md](docs/INSTALACJA.md) | instalacja krok po kroku, weryfikacja, codzienna obsługa, problemy |
| [docs/WDROZENIE.md](docs/WDROZENIE.md) | instalacja produkcyjna, HTTPS, kopie zapasowe, limity skalowania |
| [docs/ARCHITEKTURA.md](docs/ARCHITEKTURA.md) | stos technologiczny, komponenty, przepływ żądania, decyzje i ich koszt |
| [docs/API.md](docs/API.md) | wszystkie endpointy, parametry, błędy, sesje, uprawnienia |
| [docs/BAZA-DANYCH.md](docs/BAZA-DANYCH.md) | modele, pola, indeksy, migracje |
| [docs/ROZWOJ.md](docs/ROZWOJ.md) | struktura repozytorium, praca lokalna, testy, konwencje |
| [SECURITY.md](SECURITY.md) | model bezpieczeństwa, świadome ograniczenia, checklista przed wystawieniem |
| [CONTRIBUTING.md](CONTRIBUTING.md) | konwencje, przegląd zmian, migracje, wydanie |

## Licencja

Brak. Kod jest własnością organizacji; repozytorium prywatne, bez pliku
`LICENSE` i bez deklaracji licencji w `package.json`.