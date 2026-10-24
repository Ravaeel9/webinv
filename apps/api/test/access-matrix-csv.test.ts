/**
 * Parser CSV importu macierzy uprawnień — okrężność z eksportem.
 *
 * Import ma przyjmować plik, który generuje eksport (`budujRaportCsv`):
 * dowód półrocznego przeglądu wręcza się właścicielowi, ten go poprawia
 * i zwraca — plik po drodze bywa przycinany, przekodowywany i otwierany
 * w Excelu. Dlatego parser musi przeżyć dokładnie tę drogę:
 *
 *  - linię „Raport wygenerowano: …" przed nagłówkiem,
 *  - wiersze „(brak pozycji)" aplikacji bez grantów,
 *  - separator `;`, BOM, CRLF i cudzysłowy wokół pól ze średnikami.
 *
 * A wiersze, których nie da się odczytać, dostają kody błędów — podgląd
 * je pokaże, zapis odrzuci, ale **żaden wiersz nie może wywrócić pliku**.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  budujRaportCsv,
  type RaportAplikacja,
  type RaportGrantu,
} from '../src/access/access.service';
import { CsvError, MAX_CSV_BYTES } from '../src/access/csv';
import { MAX_MATRIX_ROWS, parseMatrixCsv } from '../src/access/matrix-csv';

/** Nagłówek raportu macierzy — ten sam, który emituje `budujRaportCsv`. */
const NAGLOWEK = [
  'Aplikacja',
  'Status aplikacji',
  'Klasyfikacja',
  'Krytyczność',
  'Typ dostarczania',
  'Właściciel aplikacji',
  'Osoba',
  'E-mail',
  'Departament',
  'Stanowisko',
  'Poziom',
  'Nadane',
  'Wygasa',
  'Status grantu',
  'Notatka',
];

/**
 * Wiersz danych raportu z domyślnymi wartościami — test nadpisuje tylko
 * pola, które sprawdza, żeby przypadki nie rozjechały się między sobą.
 */
function wierszCsv(
  opcje: {
    aplikacja?: string;
    osoba?: string;
    email?: string;
    departament?: string;
    stanowisko?: string;
    poziom?: string;
    wygasa?: string;
    notatka?: string;
  } = {},
): string {
  const w = [
    opcje.aplikacja ?? 'System kadrowy',
    'PROD',
    'INTERNAL',
    '2',
    'CLOUD',
    'Anna Zalewska',
    opcje.osoba ?? 'Jan Kowalski',
    opcje.email ?? 'jan@f.pl',
    opcje.departament ?? 'IT',
    opcje.stanowisko ?? 'Dev',
    opcje.poziom ?? 'ADMIN',
    '2026-09-01',
    opcje.wygasa ?? '',
    '',
    opcje.notatka ?? '',
  ];
  return w.join(';');
}

/** Plik w postaci z eksportu: BOM, linia raportu, nagłówek, CRLF. */
function raportCsv(wiersze: string[], opts: { bezLiniiRaportu?: boolean } = {}): string {
  const linie = [
    ...(opts.bezLiniiRaportu ? [] : ['Raport wygenerowano: 2026-10-24']),
    NAGLOWEK.join(';'),
    ...wiersze,
  ];
  return '\ufeff' + linie.join('\r\n');
}

describe('Parser CSV macierzy — okrężność z eksportem', () => {
  it('plik z budujRaportCsv parsuje się do tych samych danych', () => {
    const aplikacje: RaportAplikacja[] = [
      {
        id: 'a1',
        nazwa: 'System kadrowy',
        status: 'PROD',
        klasyfikacja: 'INTERNAL',
        krytycznosc: 2,
        typDostarczania: 'CLOUD',
        wlasciciel: 'Anna Zalewska',
      },
      {
        id: 'a2',
        nazwa: 'Wiki',
        status: 'PROD',
        klasyfikacja: 'INTERNAL',
        krytycznosc: 1,
        typDostarczania: 'CLOUD',
        wlasciciel: '',
      },
    ];
    const granty: RaportGrantu[] = [
      {
        aplikacjaId: 'a1',
        osoba: 'Jan Kowalski',
        email: 'jan@f.pl',
        departament: 'IT',
        stanowisko: 'Dev',
        poziom: 'ADMIN',
        nadane: '2026-09-01',
        wygasa: '2027-01-01',
        // Średnik w środku pola — eksport kwotuje, parser ma odczytać.
        notatka: 'nota;ze średnikiem',
      },
      {
        aplikacjaId: 'a1',
        osoba: 'Anna Zalewska',
        email: 'anna@f.pl',
        departament: null,
        stanowisko: null,
        poziom: 'USER',
        nadane: '2026-08-01',
        wygasa: null,
        notatka: null,
      },
    ];

    const wynik = parseMatrixCsv(budujRaportCsv(aplikacje, granty, '2026-10-24'), {
      pojedyncza: false,
    });

    // Wiki nie ma grantów → wiersz „(brak pozycji)" pomijamy całkiem.
    assert.equal(wynik.rows.length, 2);
    const [jan, anna] = wynik.rows;
    assert.equal(jan!.aplikacja, 'System kadrowy');
    assert.equal(jan!.email, 'jan@f.pl');
    assert.equal(jan!.firstName, 'Jan');
    assert.equal(jan!.lastName, 'Kowalski');
    assert.equal(jan!.position, 'Dev');
    assert.equal(jan!.department, 'IT');
    assert.equal(jan!.level, 'ADMIN');
    assert.equal(jan!.expiresOn, '2027-01-01');
    assert.equal(jan!.note, 'nota;ze średnikiem');
    assert.deepEqual(jan!.errors, []);
    assert.equal(anna!.note, null);
    assert.equal(anna!.expiresOn, null);
    assert.deepEqual(wynik.summary, { total: 2, valid: 2, invalid: 0 });
  });

  it('nagłówek bez linii „Raport wygenerowano" też działa', () => {
    const wynik = parseMatrixCsv(raportCsv([wierszCsv()], { bezLiniiRaportu: true }), {
      pojedyncza: false,
    });
    assert.equal(wynik.rows.length, 1);
    assert.equal(wynik.rows[0]!.email, 'jan@f.pl');
  });

  it('nazwisko dwuczłonowe trafia w całości do lastName', () => {
    const wynik = parseMatrixCsv(raportCsv([wierszCsv({ osoba: 'Anna Maria Kowalska' })]), {
      pojedyncza: false,
    });
    assert.equal(wynik.rows[0]!.firstName, 'Anna');
    assert.equal(wynik.rows[0]!.lastName, 'Maria Kowalska');
  });

  it('Osoba bez spacji daje lastName null — o resztę dba serwis', () => {
    const wynik = parseMatrixCsv(raportCsv([wierszCsv({ osoba: 'Zaratustra' })]), {
      pojedyncza: false,
    });
    assert.equal(wynik.rows[0]!.firstName, 'Zaratustra');
    assert.equal(wynik.rows[0]!.lastName, null);
  });

  it('brak kolumny Osoba nie jest błędem — istniejące osoby nie potrzebują imienia', () => {
    const bezOsoby = NAGLOWEK.filter((k) => k !== 'Osoba').join(';');
    const plik = '\ufeff' + ['Raport wygenerowano: 2026-10-24', bezOsoby, 'System kadrowy;PROD;INTERNAL;2;CLOUD;Anna;jan@f.pl;IT;Dev;ADMIN;2026-09-01;;;;'].join('\r\n');
    const wynik = parseMatrixCsv(plik, { pojedyncza: false });
    assert.equal(wynik.rows.length, 1);
    assert.equal(wynik.rows[0]!.firstName, null);
  });
});

describe('Parser CSV macierzy — błędy plikowe', () => {
  it('pusty plik → CsvError NO_HEADER', () => {
    assert.throws(() => parseMatrixCsv('', { pojedyncza: false }), (blad: unknown) => {
      assert.ok(blad instanceof CsvError);
      assert.equal((blad as CsvError).kod, 'NO_HEADER');
      return true;
    });
  });

  it('plik za duży → FILE_TOO_LARGE', () => {
    const zaDuzo = 'x'.repeat(MAX_CSV_BYTES + 1);
    assert.throws(() => parseMatrixCsv(zaDuzo, { pojedyncza: false }), (blad: unknown) => {
      assert.ok(blad instanceof CsvError);
      assert.equal((blad as CsvError).kod, 'FILE_TOO_LARGE');
      return true;
    });
  });

  it('brak kolumny Aplikacja w trybie całościowym → MISSING_COLUMNS', () => {
    const bezAplikacji = NAGLOWEK.filter((k) => k !== 'Aplikacja').join(';');
    const plik = [bezAplikacji, 'PROD;INTERNAL;2;CLOUD;Anna;Jan Kowalski;jan@f.pl;IT;Dev;ADMIN;2026-09-01;;;;'].join('\r\n');
    assert.throws(() => parseMatrixCsv(plik, { pojedyncza: false }), (blad: unknown) => {
      assert.ok(blad instanceof CsvError);
      assert.equal((blad as CsvError).kod, 'MISSING_COLUMNS');
      return true;
    });
  });

  it('tryb pojedynczej aplikacji akceptuje nagłówek bez kolumny Aplikacja', () => {
    const bezAplikacji = NAGLOWEK.filter((k) => k !== 'Aplikacja').join(';');
    const plik = [bezAplikacji, 'PROD;INTERNAL;2;CLOUD;Anna;Jan Kowalski;jan@f.pl;IT;Dev;ADMIN;2026-09-01;;;;'].join('\r\n');
    const wynik = parseMatrixCsv(plik, { pojedyncza: true });
    assert.equal(wynik.rows.length, 1);
    assert.equal(wynik.rows[0]!.aplikacja, null);
  });

  it('brak kolumny E-mail → MISSING_COLUMNS', () => {
    const bezEmail = NAGLOWEK.filter((k) => k !== 'E-mail').join(';');
    const plik = [bezEmail, 'System kadrowy;PROD;INTERNAL;2;CLOUD;Anna;Jan Kowalski;IT;Dev;ADMIN;2026-09-01;;;;'].join('\r\n');
    assert.throws(() => parseMatrixCsv(plik, { pojedyncza: false }), (blad: unknown) => {
      assert.ok(blad instanceof CsvError);
      assert.equal((blad as CsvError).kod, 'MISSING_COLUMNS');
      return true;
    });
  });

  it('brak kolumny Poziom → MISSING_COLUMNS', () => {
    const bezPoziomu = NAGLOWEK.filter((k) => k !== 'Poziom').join(';');
    const plik = [bezPoziomu, 'System kadrowy;PROD;INTERNAL;2;CLOUD;Anna;Jan Kowalski;jan@f.pl;IT;Dev;2026-09-01;;;;'].join('\r\n');
    assert.throws(() => parseMatrixCsv(plik, { pojedyncza: false }), (blad: unknown) => {
      assert.ok(blad instanceof CsvError);
      assert.equal((blad as CsvError).kod, 'MISSING_COLUMNS');
      return true;
    });
  });

  it('ponad MAX_MATRIX_ROWS wierszy → TOO_MANY_ROWS', () => {
    const wiersze = Array.from({ length: MAX_MATRIX_ROWS + 1 }, (_, i) =>
      wierszCsv({ email: `osoba${i}@f.pl` }),
    );
    assert.throws(() => parseMatrixCsv(raportCsv(wiersze), { pojedyncza: false }), (blad: unknown) => {
      assert.ok(blad instanceof CsvError);
      assert.equal((blad as CsvError).kod, 'TOO_MANY_ROWS');
      return true;
    });
  });
});

describe('Parser CSV macierzy — błędy wierszowe', () => {
  it('wiersz o innej liczbie pól → ROW_WIDTH', () => {
    const krotszy = 'System kadrowy;PROD;INTERNAL;2;CLOUD;Anna;Jan Kowalski;jan@f.pl;IT;Dev;ADMIN;2026-09-01;';
    const wynik = parseMatrixCsv(raportCsv([krotszy]), { pojedyncza: false });
    assert.deepEqual(wynik.rows[0]!.errors, ['ROW_WIDTH']);
    assert.equal(wynik.summary.invalid, 1);
  });

  it('pusty e-mail → MISSING_EMAIL', () => {
    const wynik = parseMatrixCsv(raportCsv([wierszCsv({ email: '' })]), { pojedyncza: false });
    assert.deepEqual(wynik.rows[0]!.errors, ['MISSING_EMAIL']);
  });

  it('poziom spoza enumu → INVALID_LEVEL', () => {
    const wynik = parseMatrixCsv(raportCsv([wierszCsv({ poziom: 'Szef' })]), { pojedyncza: false });
    assert.deepEqual(wynik.rows[0]!.errors, ['INVALID_LEVEL']);
  });

  it('pole dłuższe niż limit DTO (nazwisko 100, stanowisko 150) → FIELD_TOO_LONG', () => {
    // Limity jak w MatrixImportRowDto: podgląd ma mówić jednym językiem
    // z zapisem — inaczej wiersz „OK" w podglądzie wywraca całość requestu 400.
    const wynikNazwisko = parseMatrixCsv(
      raportCsv([wierszCsv({ osoba: `Jan ${'K'.repeat(101)}` })]),
      { pojedyncza: false },
    );
    assert.ok(wynikNazwisko.rows[0]!.errors.includes('FIELD_TOO_LONG'));

    const wynikStanowisko = parseMatrixCsv(
      raportCsv([wierszCsv({ stanowisko: 'x'.repeat(151) })]),
      { pojedyncza: false },
    );
    assert.ok(wynikStanowisko.rows[0]!.errors.includes('FIELD_TOO_LONG'));
  });

  it('wygasanie nie w formacie daty → INVALID_DATE', () => {
    const wynik = parseMatrixCsv(raportCsv([wierszCsv({ wygasa: 'jutro' })]), { pojedyncza: false });
    assert.deepEqual(wynik.rows[0]!.errors, ['INVALID_DATE']);
  });

  it('notatka ponad 2000 znaków → NOTE_TOO_LONG', () => {
    const wynik = parseMatrixCsv(
      raportCsv([wierszCsv({ notatka: 'x'.repeat(2001) })]),
      { pojedyncza: false },
    );
    assert.deepEqual(wynik.rows[0]!.errors, ['NOTE_TOO_LONG']);
  });

  it('ta sama osoba w tej samej aplikacji drugi raz → DUPLICATE_IN_FILE na drugim wierszu', () => {
    const wynik = parseMatrixCsv(
      raportCsv([wierszCsv(), wierszCsv({ wygasa: '2027-06-01' })]),
      { pojedyncza: false },
    );
    assert.deepEqual(wynik.rows[0]!.errors, []);
    assert.deepEqual(wynik.rows[1]!.errors, ['DUPLICATE_IN_FILE']);
    assert.deepEqual(wynik.summary, { total: 2, valid: 1, invalid: 1 });
  });

  it('ta sama osoba w innej aplikacji to nie duplikat', () => {
    const wynik = parseMatrixCsv(
      raportCsv([wierszCsv(), wierszCsv({ aplikacja: 'Wiki' })]),
      { pojedyncza: false },
    );
    assert.deepEqual(wynik.rows[1]!.errors, []);
  });

  it('wielkość liter w e-mailu nie tworzy z duplikatu dwóch osób', () => {
    const wynik = parseMatrixCsv(
      raportCsv([wierszCsv(), wierszCsv({ email: 'JAN@F.PL' })]),
      { pojedyncza: false },
    );
    assert.deepEqual(wynik.rows[1]!.errors, ['DUPLICATE_IN_FILE']);
  });
});
