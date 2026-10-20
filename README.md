# Rejestr Oprogramowania

Aplikacja webowa do prowadzenia rejestru oprogramowania używanego w organizacji:
jakie aplikacje mamy, kto za nimi odpowiada, w jakich środowiskach działają, ile
kosztują i kiedy mają zostać wycofane.

## Co potrafi

- **Rejestr aplikacji** — nazwa, wersja, opis, właściciel, status wdrożenia,
  klasyfikacja bezpieczeństwa, krytyczność biznesowa, koszt licencji i data
  wycofania.
- **Katalog adresów IP (IPAM)** — podsieci, adresy i ich przypisania do
  aplikacji typu `self-hosted`.
- **Pulpit** — statystyki rejestru, w tym licznik aplikacji z terminem wycofania.
- **Wyszukiwanie i filtry** — po nazwie, statusie, klasyfikacji, właścicielu,
  środowisku i typie dostarczenia; filtry zapisują się w adresie URL, więc
  widok można udostępnić koledze.
- **Eksport CSV** — bieżący zbiór wyników, razem z zastosowanymi filtrami.
- **Matryca uprawnień do aplikacji** — kto ma dostęp do której aplikacji i
  na jakim poziomie (właściciel, administrator, użytkownik, tylko odczyt),
  z datą nadania i wygaśnięcia. Osoby mające dostęp nie muszą mieć konta
  w panelu: wystarczy imię, nazwisko, stanowisko i dział. To **ewidencja** —
  dostęp nadaje się w narzędziu IAM, rejestr pokazuje, komu go nadano.
- **Import osób z CSV** — np. eksport z Google Workspace; podgląd z podziałem
  na nowe osoby, aktualizacje i błędy przed zapisem.
- **Integracja GLPI** — import osób, oprogramowania i przypisań dostępów
  wynikających z członkostwa w grupach GLPI; podgląd przed zapisem, zapis
  tworzy wyłącznie nowe rekordy. Konfiguracja i import siedzą w panelu pod
  **Ustawienia → GLPI** (tylko super administrator).
- **Tryb demonstracyjny** — wypełnienie bazy danymi próbnymi na czas
  prezentacji; włączenie, wyłączenie i kasowanie danych demo w **Ustawieniach**.
- **Dziennik zdarzeń** — kto, co i kiedy zmienił, z dokładną różnicą.
- **Import adresów z pliku nmap** — uzupełnienie katalogu IP wynikiem skanu.
- **Motyw jasny i ciemny** — przełącznik w prawym górnym rogu.

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