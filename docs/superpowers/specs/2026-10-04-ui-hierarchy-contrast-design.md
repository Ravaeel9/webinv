# Spójna hierarchia wizualna i poprawne kolory stanów

Data: 2026-10-04

## Problem

Interfejs ma dwie niezaleśne wady, obie zgłoszone jako „nieczytelny":

**Odwrócona hierarchia.** Tytuł strony to 20 px, ale nagłówek sekcji w karcie
to `text-sm font-semibold` — dokładnie tyle co tekst, który opisuje. Powtórzone
w ~20 miejscach jako surowe klasy Tailwinda (`text-sm font-semibold text-fg` +
`Icon… size-4 text-brand-600 dark:text-brand-400`). Rozmiar jest argumentem
przy call-site'cie, więc nie da się go utrzymać: każde nowe miejsce wybiera
swoje.

**Kolory stanów pisane dwa razy.** Odznaki to ręczne stringi Tailwinda w
`types.ts` (`STATUS_COLORS`, `SECURITY_COLORS`, `CRITICALITY_COLORS`,
`DELIVERY_TYPE_COLORS`) — po dwie klasy na wartość, dobrane na oko pod kontrast.
Skutek jest przewidywalny: **6 potwierdzonych błędów**, w tym odznaki ról
`SUPER_ADMIN`/`ADMIN`, które mają wyłącznie klasy `dark:` i dlatego w trybie
jasnym renderują się bez tła. Każda klasa bez `dark:` to osobny defekt, który
przegląd kodu nie wyłapie.

## Decyzje

| # | Decyzja |
|---|---|
| 1 | Hierarchia i tony jako **klasy w `index.css`**, nie jako komponenty React i nie jako surowe rozmiary przy call-site'cie. Zgodne z `docs/ROZWOJ.md`, które wskazuje klasy z `index.css` jako konwencję projektu. |
| 2 | **6 tonów**, każdy z parą jasną i ciemną. Wartości `oklch` należą do projektu, nie do palety Tailwinda — dzięki temu kontrast da się policzyć i zatrzymać testem. |
| 3 | W trybie ciemnym **tła odznak są lite kolory, nie `bg-*/15`**. Alfa jest mieszana przez przeglądarkę w nieznany dla nas sposób, więc kontrastu nie da się policzyć; lite oklch daje wynik dokładny. |
| 4 | Współczynnik kontrastu **jest testem**, nie komentarzem — `ui-contrast.test.ts`. |
| 5 | Status ma 6 wartości na 6 tonów, ale ton się powtarza świadomie: TEST i DEPRECATED to oba „zwróć uwagę", PLANNED i RETIRED to oba „nieaktywne". Kolor niesie znaczenie, a nie tylko odróżnia. |
| 6 | `Inter` usuwamy z `--font-sans` — był zadeklarowany i nigdy nie wczytany, więc każdy użytkownik i tak widział fallback. |
| 7 | Rozmiary, które dziś działają, zostają. Nie ruszamy skali bazowej — zgłoszone problemy to hierarchia i kontrast, nie rozmiar czcionki. |

## Warstwa ról typograficznych

W `@layer components` obok istniejących `.card`, `.label`, `.badge`, `.input`.

| Rola | Klasa | Rozmiar | Zastosowanie |
|---|---|---|---|
| tytuł strony | `.page-title` | 24 px | `<h1>` w `PageHeader` |
| tytuł sekcji | `.section-title` | 16 px | `<h2>` w kartach; ikona jest częścią roli |
| etykieta pola | `.label` | 14 px | bez zmian — to już jest rola |
| treść w karcie | `.card-text` | 14 px | tekst opisowy |
| metadane | `.meta-text` | 12 px | podpowiedzi, stopki, `<dt>` |
| nagłówek tabeli | `.table-head` | 12 px | `<th>` |

`.section-title svg` dostaje kolor ikony, więc call-site to
`<h2 className="section-title"><IconBox />Środowiska</h2>`.

`.page-title` przestaje mieć `truncate` — dziś długa nazwa aplikacji **u sięcina**
zamiast zawijać się.

## Tony

Sześć tonów: `neutral`, `info`, `violet`, `ok`, `warn`, `danger`.
Banery komunikatów mają inny kształt (tło tint + obramowanie), więc osobno:
`.alert` + `.alert-danger`, `.alert-warn`, `.alert-ok`.

| Zestaw | Mapowanie |
|---|---|
| Status | PROD→`ok`, TEST→`warn`, DEV→`info`, PLANNED→`neutral`, DEPRECATED→`warn`, RETIRED→`neutral` |
| Bezpieczeństwo | PUBLIC→`neutral`, INTERNAL→`info`, CONFIDENTIAL→`warn`, RESTRICTED→`danger` |
| Krytyczność | 1→`neutral`, 2→`info`, 3→`warn`, 4→`danger` |
| Dostarczanie | GENERAL_USE→`neutral`, SELF_HOSTED→`info`, SAAS→`violet`, VENDOR_MANAGED→`warn` |
| Role | SUPER_ADMIN→`violet`, ADMIN→`info`, VIEWER→`neutral` |

Wynik: `class="badge tone-warn"` zamiast 6 ręcznie dobranych klas. **Nie da się
napisać połowy odznaki.**

## Naprawiane błędy

| # | Miejsce | Błąd |
|---|---|---|
| 1 | `UsersPage.tsx` — odzniki ról | `SUPER_ADMIN`/`ADMIN` miały wyłącznie klasy `dark:` → w trybie jasnym bez tła |
| 2 | `UsersPage.tsx` — odznika stanu | `dark:text-emerald-200` sparowane z jasnym `bg-emerald-100` |
| 3 | `UsersPage.tsx` — ostrzeżenie | tekst amber bez ciemnego tła |
| 4 | `PasswordField.tsx` | `text-emerald-700` bez wariantu ciemnego |
| 5 | `ApplicationDetailPage.tsx`, `AuditPage.tsx` | `text-amber-700` bez wariantu ciemnego |
| 6 | `index.css` `.input-error` | brak pary `dark:` (`.error-text` ją ma) |
| 7 | `AppLayout.tsx` — aktywny nav | tryb jasny używa krytych `brand-50/accent-50`, ciemny `*/15` — strukturalnie różne |
| 8 | `index.css` `--font-sans` | `Inter` zadeklarowany, nigdy nie wczytany |

## Weryfikacja

Kontrast jest liczony, nie oceniany. `apps/api/test/ui-contrast.test.ts`
czytasz `apps/web/src/index.css`, parsuje klasy `.tone-*` i `.alert-*`, i
wymaga ≥ 4.5:1 (odznaki mają 12 px, więc to próg „normalnego" tekstu wg
WCAG AA) dla każdej pary w obu motywach. Test:

- oblicza kontrast z wartości `oklch` (oklab → liniowy sRGB → luminancja
  względna → WCAG), więc zgodny jest z tym, co przeglądarka faktycznie pokaże;
- pilnuje też kontrastu tokenów `--c-fg`, `--c-fg-muted`, `--c-fg-subtle`,
  których obecne wartości ręczne opisują komentarze w `index.css`.

Precedens: `apps/api/test/nginx-config.test.ts` czyta plik spoza swojego
workspace (`nginx/`), więc test UI w `apps/api/test/` nie jest wyjątkiem.

## Sprzątanie przy okazji

W tych samych plikach, bo leżą w linii zmian:

- `Th` skopiowany 2× (lista aplikacji, użytkownicy) → jeden eksport;
- `FIELD_LABELS` ×2 po ~40 wpisów → jeden moduł;
- 3 przyciski wyręczone z pominięciem `Button` → `<Button>`;
- martwe `.surface-2`, `focus:opacity-100 group-hover:opacity-100`, `.animate-in-up`
  bez konsumenta → usuwamy.

## Poza zakresem

- rozmiar bazowy tekstu i paleta brandu (nie były zgłoszone jako problem);
- nawigacja — pasek u góry zostaje, bez panelu bocznego;
- `<Link><Button/></Link>` w 4 miejscach: to `<a><button></a>`, czyli
  **niepoprawny HTML** i niewiarygodne działanie klawiatury. Błąd poprawności,
  nie wyglądu — zgłoszony osobno, nie naprawiany tutaj;
- focus trap w modalu, ARIA dla pasków postępu na pulpicie;
- duplikat `ChangeList` między szczegółami a audytem.
