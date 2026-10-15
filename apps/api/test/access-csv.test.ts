/**
 * Parser CSV osób — wejście z eksportu Google Workspace, nie z ideału.
 *
 * Plik przychodzi z zewnątrz: cudzy separator, cudze nazwy kolumn, cudzy
 * format dat aktywności. Dlatego parser:
 *
 *  - **rozcina poprawnie cudzysłowy** — „Kowalski, Jan" w jednym polu
 *    to częsty błąd eksportu, a naiwne `split(',')` zamienia jedną osobę
 *    w dwie atrapy,
 *  - **rozpoznaje nagłówki po polsku i angielsku** — Workspace eksportuje
 *    angielskie nazwy, a polski administrator myśli po polsku; ręczne
 *    mapowanie każdej kolumny przy każdym eksporcie byłoby nie do użycia,
 *  - **odrzuca duplikat w pliku** — dwa wiersze z tym samym e-mailem przy
 *    zapisie „ostatni wygrywa" po cichu, a administrator nie wie, że
 *    pierwszy wiersz był złym wyborem,
 *  - **pilnuje limitów** — plik z 200 tys. wierszy nie może wyciągnąć
 *    procesu, a limit w kodzie (a nie w UI) chroni też wywołanie API
 *    wprost.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  CsvError,
  MAX_CSV_BYTES,
  MAX_PERSON_ROWS,
  detectMapping,
  parseCsv,
  parsePersonsCsv,
} from '../src/access/csv';

const NAGLOWEK_EN = 'Email,First name,Last name,Department,Job title,Suspended';

describe('parseCsv', () => {
  it('rozcina pola w cudzysłowach z przecinkiem w środku', () => {
    const { rows } = parseCsv('email;firstName\r\njan@f.pl;"Kowalski, Jan"\r\n');
    assert.deepEqual(rows[0], ['jan@f.pl', 'Kowalski, Jan']);
  });

  it('obsługuje oba separatory', () => {
    const przecinek = parseCsv('a,b\n1,2');
    const srednik = parseCsv('a;b\n1;2');
    assert.deepEqual(przecinek.rows[0], ['1', '2']);
    assert.deepEqual(srednik.rows[0], ['1', '2']);
  });

  it('zjada BOM i zostawia cudzysłów wewnątrz pola', () => {
    const { header } = parseCsv('﻿email,fullName\njan@f.pl,"Jan ""Kowalski"""');
    assert.equal(header[0], 'email');
    assert.deepEqual(header[1], 'fullName');
    assert.equal(parseCsv('a\n"x""y"').rows[0]![0], 'x"y');
  });

  it('puste wiersze na końcu pliku nie tworzą wierszy danych', () => {
    const { rows } = parseCsv('a,b\n1,2\n\n\n');
    assert.equal(rows.length, 1);
  });
});

describe('detectMapping', () => {
  it('rozpoznaje nagłówki angielskie Google Workspace', () => {
    const mapa = detectMapping([
      'Email',
      'First name',
      'Last name',
      'Department',
      'Job title',
      'Suspended',
    ]);
    assert.deepEqual(mapa, {
      email: 'Email',
      firstName: 'First name',
      lastName: 'Last name',
      department: 'Department',
      position: 'Job title',
      isActive: 'Suspended',
    });
  });

  it('rozpoznaje nagłówki polskie niezależnie od wielkości liter', () => {
    const mapa = detectMapping(['E-MAIL', 'Imię', 'Nazwisko', 'Dział', 'Stanowisko']);
    assert.equal(mapa.email, 'E-MAIL');
    assert.equal(mapa.firstName, 'Imię');
    assert.equal(mapa.position, 'Stanowisko');
  });

  it('nieznane nagłówki nie są przypisywane do pól', () => {
    const mapa = detectMapping(['Email', 'Imię', 'Nazwisko', 'Kod kosztu']);
    assert.equal(mapa.position, '', 'nieznany nagłówek nie trafia do żadnego pola');
  });
});

describe('parsePersonsCsv', () => {
  it('czytanie wiersza z pliku Workspace', () => {
    const { rows } = parsePersonsCsv(
      `${NAGLOWEK_EN}\njan.kowalski@firma.pl,Jan,Kowalski,IT,Analityk,false\n`,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.email, 'jan.kowalski@firma.pl');
    assert.equal(rows[0]!.firstName, 'Jan');
    assert.equal(rows[0]!.department, 'IT');
    assert.equal(rows[0]!.position, 'Analityk');
    // `Suspended = false` znaczy „nie zawieszona”, czyli osoba aktywna —
    // kolumna o znaczeniu negatywnym, nie zwykły status.
    assert.equal(rows[0]!.isActive, true);
    assert.deepEqual(rows[0]!.errors, []);
  });

  it('zawieszenie w Workspace wyłącza osobę, a brak kolumny statusu zostawia ją aktywną', () => {
    const zawieszona = parsePersonsCsv(
      `${NAGLOWEK_EN}\na@f.pl,Jan,Kowalski,IT,Analityk,true\n`,
    ).rows[0]!;
    assert.equal(zawieszona.isActive, false);

    const bezStatusu = parsePersonsCsv(
      'Email,First name,Last name\na@f.pl,Jan,Kowalski\n',
    ).rows[0]!;
    assert.equal(bezStatusu.isActive, true);
  });

  it('ten sam e-mail dwa razy w pliku jest błędem w drugim wierszu', () => {
    const { rows, summary } = parsePersonsCsv(
      'Email,First name,Last name\na@f.pl,Jan,Kowalski\nA@F.PL,Jan,Kowalski\n',
    );
    assert.deepEqual(rows[0]!.errors, []);
    assert.deepEqual(rows[1]!.errors, ['DUPLICATE_IN_FILE']);
    assert.equal(summary.invalid, 1);
  });

  it('wiersz bez e-maila jest błędem, a nie cichym pominięciem', () => {
    const { rows } = parsePersonsCsv('Email,First name,Last name\n,Jan,Kowalski\n');
    assert.deepEqual(rows[0]!.errors, ['MISSING_EMAIL']);
  });

  it('wiersz bez imienia lub nazwiska jest błędem', () => {
    const { rows } = parsePersonsCsv(
      'Email,First name,Last name\na@f.pl,,Kowalski\nb@f.pl,Jan,\n',
    );
    assert.deepEqual(rows[0]!.errors, ['MISSING_FIRST_NAME']);
    assert.deepEqual(rows[1]!.errors, ['MISSING_LAST_NAME']);
  });

  it('wiersz krótszy niż nagłówek daje błędy, a nie przesunięte kolumny', () => {
    const { rows } = parsePersonsCsv('Email,First name,Last name\na@f.pl,Jan\n');
    assert.deepEqual(rows[0]!.errors, ['MISSING_LAST_NAME']);
  });

  it('plik bez kolumny e-mail odrzuca wszystkie wiersze', () => {
    assert.throws(
      () => parsePersonsCsv('Imię,Nazwisko\nJan,Kowalski\n'),
      (blad: unknown) => blad instanceof CsvError,
    );
  });

  it('limit rozmiaru pliku jest egzekwowany', () => {
    const ogromny = 'a'.repeat(MAX_CSV_BYTES + 1);
    assert.throws(() => parsePersonsCsv(ogromny), CsvError);
  });

  it('powyżej limitu wierszy jest błędem, a nie ucinaniem', () => {
    const wiersze = Array.from(
      { length: MAX_PERSON_ROWS + 1 },
      (_, i) => `osoba${i}@firma.pl,Jan,Kowalski`,
    ).join('\n');
    assert.throws(
      () => parsePersonsCsv(`Email,First name,Last name\n${wiersze}`),
      (blad: unknown) => blad instanceof CsvError && blad.kod === 'TOO_MANY_ROWS',
    );
  });

  it('podane mapowanie ma pierwszeństwo przed automatycznym rozpoznaniem', () => {
    const csv = 'Kod,Mail\n001,jan.kowalski@firma.pl\nJan,Kowalski\n';
    const { rows } = parsePersonsCsv(csv, {
      email: 'Mail',
      firstName: 'Jan',
      lastName: 'Nazwisko',
      position: 'Kod',
      department: '',
      isActive: '',
    });
    assert.equal(rows[0]!.email, 'jan.kowalski@firma.pl');
    assert.equal(rows[0]!.position, '001');
  });

  it('podsumowanie liczy wiersze poprawne i błędne', () => {
    const { summary } = parsePersonsCsv(
      'Email,First name,Last name\na@f.pl,Jan,Kowalski\n,Jan,Kowalski\n',
    );
    assert.deepEqual(summary, { total: 2, valid: 1, invalid: 1 });
  });
});