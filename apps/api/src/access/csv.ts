/**
 * Parser CSV osób — bez bazy i bez NestJS, żeby dał się przetestować
 * w jednym pliku.
 *
 * Wejście przychodzi z eksportu Google Workspace, więc zakładamy, że jest
 * „normalne": cudzy separator, cudze nazwy kolumn, cudzy zapis aktywności.
 * To, czego parser **nie** zakłada, to poprawność — każdy wiersz dostaje
 * listę kodów błędów i nigdy nie jest zapisywany „na nadzieję".
 */

/** Maksymalny rozmiar pliku — 2 MB. */
export const MAX_CSV_BYTES = 2 * 1024 * 1024;

/** Maksymalna liczba wierszy z danymi w jednym pliku. */
export const MAX_PERSON_ROWS = 2000;

/** Pola osoby, które da się wypełnić z pliku. */
export type PersonField = 'email' | 'firstName' | 'lastName' | 'position' | 'department' | 'isActive';

/** Mapowanie: pole osoby → nazwa kolumny w pliku (pusta = brak). */
export type HeaderMapping = Record<PersonField, string>;

export type ParsedPersonRow = {
  line: number;
  email: string;
  firstName: string;
  lastName: string;
  position: string | null;
  department: string | null;
  isActive: boolean;
  errors: string[];
};

export type ParsedPersonsCsv = {
  rows: ParsedPersonRow[];
  mapping: HeaderMapping;
  /** Nagłówki, których nie umiemy przypisać — UI pokazuje je do ręcznego wyboru. */
  unmapped: string[];
  summary: { total: number; valid: number; invalid: number };
};

/** Błąd wejścia — komunikat idzie prosto do administratora. */
export class CsvError extends Error {
  constructor(
    message: string,
    readonly kod: string,
  ) {
    super(message);
    this.name = 'CsvError';
  }
}

/**
 * Aliasy nagłówków. Klucz to pole, lista to zapisy, jakie admin może
 * w pliku użyć — polskie i angielskie, bo eksport Workspace jest
 * angielski, a nazwy plików robionych „w firmie" bywają polskie.
 */
const ALIASY: Record<PersonField, string[]> = {
  email: ['email', 'e-mail', 'email address', 'mail', 'adres email', 'adres e-mail', 'login', 'uzytkownik'],
  firstName: ['first name', 'firstname', 'imie', 'drugie imie', 'given name'],
  lastName: ['last name', 'lastname', 'surname', 'nazwisko', 'family name'],
  position: ['job title', 'title', 'position', 'stanowisko', 'zadanie'],
  department: ['department', 'org unit', 'organizational unit', 'dzial', 'zespol'],
  isActive: ['suspended', 'archived', 'status', 'nieaktywny', 'aktywnosc', 'zawieszony', 'disabled'],
};

/** Wartości kolumny statusu, które oznaczają osobę aktywną. */
const AKTYWNE = ['', 'true', 'yes', 'tak', 'aktywny', 'aktywna', 'aktywne', '1'];
/** …a te — nieaktywną. */
const NIEAKTYWNE = ['false', 'no', 'nie', 'suspended', 'archived', 'nieaktywny', 'nieaktywna', 'zawieszony', 'disabled', '0'];

function normalizuj(naglowek: string): string {
  return naglowek
    .trim()
    .toLowerCase()
    // Polskie znaki z „Adres e‑mail" w UTF-8 i z Windows-1250 muszą dać
    // ten sam klucz, inaczej jedna kopia pliku przestaje się rozpoznawać.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

/** Wykrywa separator z wiersza nagłówkowego — częstszy wygrywa. */
function wykryjSeparator(pierszyWiersz: string): string {
  const przecinki = (pierszyWiersz.match(/,/g) ?? []).length;
  const sredniki = (pierszyWiersz.match(/;/g) ?? []).length;
  return sredniki > przecinki ? ';' : ',';
}

/**
 * Podział pliku na wiersze i pola.
 *
 * `line` w wyniku to numer wiersza w pliku (licząc od 1, nagłówek włącznie)
 * — administrator widzi go w podglądzie, więc musi zgadzać się z tym,
 * co pokazuje arkusz kalkulacyjny.
 */
export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const tresc = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const wiersze: string[][] = [];
  let biezace: string[] = [];
  let pole = '';
  let wCudzyslowie = false;

  for (let i = 0; i < tresc.length; i++) {
    const znak = tresc[i]!;
    if (wCudzyslowie) {
      if (znak === '"') {
        // Podwójny cudzysłów wewnątrz pola to znak `"`, nie koniec pola.
        if (tresc[i + 1] === '"') {
          pole += '"';
          i++;
        } else {
          wCudzyslowie = false;
        }
      } else {
        pole += znak;
      }
      continue;
    }

    if (znak === '"' && pole === '') {
      wCudzyslowie = true;
      continue;
    }

    const koniecWiersza = znak === '\n' || znak === '\r';
    if (koniecWiersza) {
      biezace.push(pole);
      pole = '';
      // `\r\n` to jeden koniec wiersza, nie dwa — inaczej po każdym wierszu
      // wjeżdżałby pusty.
      if (znak === '\r' && tresc[i + 1] === '\n') i++;
      wiersze.push(biezace);
      biezace = [];
      continue;
    }

    const separator = wykryjSeparator(tresc.split(/\r?\n/, 1)[0]!);
    if (znak === separator) {
      biezace.push(pole);
      pole = '';
      continue;
    }

    pole += znak;
  }

  if (pole !== '' || biezace.length > 0) {
    biezace.push(pole);
    wiersze.push(biezace);
  }

  const niepuste = wiersze.filter((w) => w.some((p) => p.trim() !== ''));
  if (niepuste.length === 0) {
    throw new CsvError('Plik jest pusty.', 'NO_HEADER');
  }

  return { header: niepuste[0]!, rows: niepuste.slice(1) };
}

/** Dopasowuje nagłówki do pól osoby. */
export function detectMapping(header: string[]): HeaderMapping {
  const mapa = {
    email: '',
    firstName: '',
    lastName: '',
    position: '',
    department: '',
    isActive: '',
  } as HeaderMapping;

  for (const naglowek of header) {
    const klucz = normalizuj(naglowek);
    for (const [pole, aliasy] of Object.entries(ALIASY) as Array<[PersonField, string[]]>) {
      if (mapa[pole] === '' && aliasy.some((alias) => normalizuj(alias) === klucz)) {
        mapa[pole] = naglowek;
      }
    }
  }

  return mapa;
}

/**
 * Kolumny o znaczeniu **negatywnym**: `Suspended`/`Archived` mówią
 * „prawda = wygaszone”, a `Active` — „prawda = działa”. Bez tego rozróżnienia
 * `Suspended = true` wyłączyłoby osobę czynnie odwiedzającą aplikację.
 */
const KOLUMNY_ODWROTNE = new Set(
  ['suspended', 'archived', 'disabled', 'nieaktywny', 'zawieszony'].map(normalizuj),
);

/** Czytanie kolumny statusu — puste znaczy „aktywny”, bo tak jest w Workspace. */
function czytajAktywnosc(wartosc: string | undefined, odwrotna = false): boolean {
  const wartoscOdczytana = czytajWartoscAktywnosci(wartosc);
  return odwrotna ? !wartoscOdczytana : wartoscOdczytana;
}

function czytajWartoscAktywnosci(wartosc: string | undefined): boolean {
  const znormalizowana = normalizuj(wartosc ?? '');
  if (NIEAKTYWNE.includes(znormalizowana)) return false;
  if (AKTYWNE.includes(znormalizowana)) return true;
  // Nieznana wartość (np. „Inactive (2024-05)") nie może przesunąć wyłączenia
  // w drugą stronę niż milczenie — traktujemy ją jako nieaktywną tylko
  // wtedy, gdy wyraźnie zawiera słowo oznaczające zawieszenie.
  return !/suspend|archiv|nieaktyw|zawiesz|disabled/.test(znormalizowana);
}

/**
 * Pełne czytanie pliku: rozpoznanie kolumn, wiersze i ich błędy.
 *
 * `mapping` z podglądu ma pierwszeństwo — administrator poprawia
 * przypisanie kolumn ręcznie i chce zobaczyć wynik bez zmiany pliku.
 */
export function parsePersonsCsv(text: string, mapping?: HeaderMapping): ParsedPersonsCsv {
  if (Buffer.byteLength(text, 'utf8') > MAX_CSV_BYTES) {
    throw new CsvError('Plik przekracza 2 MB.', 'FILE_TOO_LARGE');
  }

  const { header, rows } = parseCsv(text);
  if (rows.length > MAX_PERSON_ROWS) {
    throw new CsvError(
      `Plik ma ${rows.length} wierszy, a limit to ${MAX_PERSON_ROWS}.`,
      'TOO_MANY_ROWS',
    );
  }

  const mapa = mapping ?? detectMapping(header);
  if (!mapa.email) {
    throw new CsvError(
      'Nie znaleziono kolumny z adresem e-mail. Wskaż ją ręcznie.',
      'MISSING_EMAIL_COLUMN',
    );
  }

  const przypisane = new Set(Object.values(mapa).filter(Boolean));
  const unmapped = header.filter((n) => !przypisane.has(n));

  const indeksy = Object.fromEntries(
    (Object.keys(mapa) as PersonField[]).map((pole) => [pole, mapa[pole] ? header.indexOf(mapa[pole]) : -1]),
  ) as Record<PersonField, number>;

  const statusOdwrotny = KOLUMNY_ODWROTNE.has(normalizuj(mapa.isActive || ''));

  const widziane = new Map<string, number>();
  const wynik: ParsedPersonRow[] = rows.map((pola, i) => {
    const wartosc = (pole: PersonField) =>
      indeksy[pole] === -1 ? '' : (pola[indeksy[pole]] ?? '').trim();

    const email = wartosc('email');
    const klucz = email.toLowerCase();
    const errors: string[] = [];

    if (!email) errors.push('MISSING_EMAIL');
    else if (widziane.has(klucz)) errors.push('DUPLICATE_IN_FILE');
    else widziane.set(klucz, i + 2);

    if (!wartosc('firstName')) errors.push('MISSING_FIRST_NAME');
    if (!wartosc('lastName')) errors.push('MISSING_LAST_NAME');

    return {
      line: i + 2,
      email,
      firstName: wartosc('firstName'),
      lastName: wartosc('lastName'),
      position: wartosc('position') || null,
      department: wartosc('department') || null,
      isActive: czytajAktywnosc(wartosc('isActive'), statusOdwrotny),
      errors,
    };
  });

  return {
    rows: wynik,
    mapping: mapa,
    unmapped,
    summary: {
      total: wynik.length,
      valid: wynik.filter((w) => w.errors.length === 0).length,
      invalid: wynik.filter((w) => w.errors.length > 0).length,
    },
  };
}