/**
 * Parser CSV macierzy uprawnień — okrężny z eksportem.
 *
 * Wejście to plik, który generuje `budujRaportCsv` (raport całościowy albo
 * jednej aplikacji — kolumny identyczne), po drodze poprawiony przez
 * właściciela w Excelu. Dlatego parser **nie zakłada** poprawności wierszy
 * (każdy dostaje listę kodów błędów), ale zakłada kształt nagłówka:
 * wymagane są kolumny, bez których zapis grantu nie ma sensu.
 *
 * Bez bazy i bez NestJS — wzorzec `csv.ts`, żeby dał się przetestować
 * w jednym pliku. Tokenizer (`parseCsv`) i normalizacja nagłówków
 * (`normalizuj`) pochodzą stamtąd: cudzysłowy, BOM, `\r\n` i autodetekcja
 * separatora są rozwiązane raz, wspólnie dla obu importów.
 */
import { CsvError, MAX_CSV_BYTES, normalizuj, parseCsv } from './csv';

/** Maksymalna liczba wierszy z danymi w jednym pliku macierzy. */
export const MAX_MATRIX_ROWS = 5000;

/**
 * Poziomy dostępu — lista powtórzona ze schematu Prisma, ten sam zestaw
 * co `ACCESS_LEVELS` w DTO. Powtórzona celowo: parser nie ma zależności
 * od DTO (warstwa wyżej), a wartość spoza listy to błąd wiersza
 * `INVALID_LEVEL`, nie wyjątek dla całego pliku.
 */
const POZIOMY = new Set(['OWNER', 'ADMIN', 'USER', 'READ_ONLY']);

/**
 * Mapowanie: znormalizowany nagłówek raportu → pole wiersza importu.
 *
 * Kolumny pochodne (Status aplikacji, Klasyfikacja, Krytyczność, Typ
 * dostarczania, Właściciel aplikacji, Status grantu) celowo nie występują
 * — import ich nie zmienia. `Nadane` też nie: nowy grant dostaje datę
 * dzisiejszą, istniejący zachowuje własną.
 */
const KOLUMNY: Record<string, 'aplikacja' | 'osoba' | 'email' | 'departament' | 'stanowisko' | 'poziom' | 'wygasa' | 'notatka'> = {
  aplikacja: 'aplikacja',
  osoba: 'osoba',
  email: 'email',
  'e-mail': 'email',
  departament: 'departament',
  stanowisko: 'stanowisko',
  poziom: 'poziom',
  wygasa: 'wygasa',
  notatka: 'notatka',
};

/** Wiersz macierzy po parsowaniu — pola surowe, błędy jako kody. */
export type ParsedMatrixRow = {
  /** Numer wiersza w pliku (od 1, z nagłówkiem) — zgadza się z arkuszem. */
  line: number;
  /** Nazwa aplikacji z kolumny; `null` w trybie pojedynczej aplikacji lub przy pustej komórce. */
  aplikacja: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  department: string | null;
  /** Surowa wartość z pliku — walidowana na `POZIOMY`. */
  level: string;
  /** Surowa wartość z pliku (`RRRR-MM-DD`) albo `null`. */
  expiresOn: string | null;
  note: string | null;
  errors: string[];
};

/**
 * Limity długości pól — spójne z `MatrixImportRowDto` (import.dto.ts).
 * Podgląd i zapis mają mówić jednym językiem: gdyby parser przepuszczał
 * pole, które DTO odrzuci, jeden długi wiersz wywróciłby całość requestu
 * HTTP 400 zamiast trafić do `skippedRows` jak pozostałe błędy wiersza.
 */
const LIMITY_POL: Array<[keyof Pick<ParsedMatrixRow, 'email' | 'firstName' | 'lastName' | 'position' | 'department' | 'aplikacja'>, number]> = [
  ['email', 200],
  ['firstName', 100],
  ['lastName', 100],
  ['position', 150],
  ['department', 150],
  ['aplikacja', 200],
];

export type ParsedMatrixCsv = {
  rows: ParsedMatrixRow[];
  summary: { total: number; valid: number; invalid: number };
};

/** Wartość komórki: `null` przy braku kolumny, pusta → `null` po trim. */
function komorka(
  pola: string[],
  indeks: number | undefined,
): string | null {
  if (indeks === undefined) return null;
  const wartosc = pola[indeks]?.trim() ?? '';
  return wartosc === '' ? null : wartosc;
}

/**
 * „Osoba" z raportu to „Imię Nazwisko" — dzielimy na **pierwszej** spacji:
 * nazwiska dwuczłonowe odtwarzają się w całości, a imiona wielowyrazowe
 * są w ewidencji rzadkością. Brak spacji zostawia `lastName: null` —
 * o to, czy to przeszkadza (nowa osoba bez nazwiska), dba serwis.
 */
function rozdzielOsobe(osoba: string | null): { firstName: string | null; lastName: string | null } {
  if (osoba === null) return { firstName: null, lastName: null };
  const spacja = osoba.indexOf(' ');
  if (spacja === -1) return { firstName: osoba, lastName: null };
  return {
    firstName: osoba.slice(0, spacja).trim(),
    lastName: osoba.slice(spacja + 1).trim() || null,
  };
}

/** Data w formacie, w jakim ją zapisał eksport. */
const FORMAT_DATY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parsuje plik CSV macierzy uprawnień.
 *
 * `pojedyncza: true` (import w kontekście jednej aplikacji) zwalnia plik
 * z kolumny `Aplikacja` — nazwa pochodzi z requestu, nie z pliku.
 *
 * Błędy **plikowe** (za duży plik, brak wymaganych kolumn, za dużo wierszy)
 * rzucają `CsvError` — cały plik jest nieprzydatny. Błędy **wierszowe**
 * lądują w `errors` wiersza: podgląd je pokaże, zapis odrzuci, a reszta
 * pliku przechodzi.
 */
export function parseMatrixCsv(
  text: string,
  opts: { pojedyncza: boolean },
): ParsedMatrixCsv {
  if (Buffer.byteLength(text, 'utf8') > MAX_CSV_BYTES) {
    throw new CsvError('Plik przekracza 2 MB.', 'FILE_TOO_LARGE');
  }

  // Linia „Raport wygenerowano: <data>" to dowód momentu przeglądu, nie
  // nagłówek — parser bierze pierwszą niepustą linię za nagłówek, więc
  // bez jej odjęcia każdy plik z eksportu wyglądałby na jednokolumnowy.
  const bezRaportu = text.replace(/^\ufeff?[^\r\n]*raport wygenerowano[^\r\n]*(\r?\n)/i, '');

  const { header, rows } = parseCsv(bezRaportu);
  if (rows.length > MAX_MATRIX_ROWS) {
    throw new CsvError(`Plik przekracza limit ${MAX_MATRIX_ROWS} wierszy.`, 'TOO_MANY_ROWS');
  }

  const polaNaglowka = new Map<string, number>();
  header.forEach((nazwa, i) => {
    const pole = KOLUMNY[normalizuj(nazwa)];
    if (pole && !polaNaglowka.has(pole)) polaNaglowka.set(pole, i);
  });

  const wymagane: Array<[string, string]> = [['email', 'E-mail'], ['poziom', 'Poziom']];
  if (!opts.pojedyncza) wymagane.unshift(['aplikacja', 'Aplikacja']);
  const brakujace = wymagane.filter(([pole]) => !polaNaglowka.has(pole));
  if (brakujace.length > 0) {
    throw new CsvError(
      `Plik nie ma kolumn: ${brakujace.map(([, nazwa]) => nazwa).join(', ')}.`,
      'MISSING_COLUMNS',
    );
  }

  const idx = (pole: string) => polaNaglowka.get(pole);

  const wynik: ParsedMatrixRow[] = [];
  const widziane = new Set<string>();

  // `line` = pozycja wiersza danych w całym pliku: nagłówek to linia 1
  // (plus ewentualna linia raportu przed nim), a odczyt `rows` z `parseCsv`
  // liczy się od zera — stala różnica zależy od tego, czy linię raportu
  // odjęliśmy.
  const numerLiniiNaglowka = header.length > 0 && bezRaportu !== text ? 2 : 1;

  rows.forEach((pola, i) => {
    const line = numerLiniiNaglowka + 1 + i;
    const errors: string[] = [];

    if (pola.length !== header.length) errors.push('ROW_WIDTH');

    const osoba = komorka(pola, idx('osoba'));
    // Wiersz „(brak pozycji)" to sygnał, że aplikacja nie ma grantów —
    // z eksportu, nie od człowieka, więc nie ma go czego importować.
    if (osoba === '(brak pozycji)') return;

    const email = komorka(pola, idx('email')) ?? '';
    if (email === '') errors.push('MISSING_EMAIL');

    const level = komorka(pola, idx('poziom')) ?? '';
    if (!POZIOMY.has(level)) errors.push('INVALID_LEVEL');

    const wygasa = komorka(pola, idx('wygasa'));
    if (wygasa !== null && !(FORMAT_DATY.test(wygasa) && !Number.isNaN(new Date(wygasa).getTime()))) {
      errors.push('INVALID_DATE');
    }

    const notatka = komorka(pola, idx('notatka'));
    if (notatka !== null && notatka.length > 2000) errors.push('NOTE_TOO_LONG');

    const { firstName, lastName } = rozdzielOsobe(osoba);

    const aplikacja = komorka(pola, idx('aplikacja'));

    // Limity pól jak w DTO (wyżej): sprawdzone tu, żeby podgląd pokazał
    // wiersz jako błędny, a nie całość importu na 400 przy zapisie.
    const wartosci: Record<string, string | null> = {
      email,
      firstName,
      lastName,
      position: komorka(pola, idx('stanowisko')),
      department: komorka(pola, idx('departament')),
      aplikacja,
    };
    for (const [pole, limit] of LIMITY_POL) {
      const wartosc = wartosci[pole];
      if (wartosc !== null && wartosc !== undefined && wartosc.length > limit) {
        errors.push('FIELD_TOO_LONG');
        break;
      }
    }
    // Duplikat w pliku: ta sama osoba w tej samej aplikacji drugi raz.
    // Klucz case-insensitive jak citext w bazie, żeby „JAN@F.PL" nie
    // utworzyło złudzenia dwóch osób.
    const klucz = `${aplikacja ?? ''}\u0000${email.toLowerCase()}`;
    if (email !== '' && widziane.has(klucz)) errors.push('DUPLICATE_IN_FILE');
    if (email !== '') widziane.add(klucz);

    wynik.push({
      line,
      aplikacja,
      email,
      firstName,
      lastName,
      position: komorka(pola, idx('stanowisko')),
      department: komorka(pola, idx('departament')),
      level,
      expiresOn: wygasa,
      note: notatka,
      errors,
    });
  });

  return {
    rows: wynik,
    summary: {
      total: wynik.length,
      valid: wynik.filter((w) => w.errors.length === 0).length,
      invalid: wynik.filter((w) => w.errors.length > 0).length,
    },
  };
}
