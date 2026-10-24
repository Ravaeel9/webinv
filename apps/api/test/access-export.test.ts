/**
 * Raport macierzy uprawnień — builder CSV.
 *
 * Raport jest dowodem półrocznego przeglądu, więc trzy rzeczy decydują
 * o jego wartości: data wygenerowania w pierwszej linii (kiedy oglądano
 * stan), pełny wiersz metadanych aplikacji (status, klasyfikacja,
 * krytyczność — kontekst decyzji) oraz `(brak pozycji)` dla aplikacji
 * bez grantów (widać, że rejestr niczego nie ewidencjonuje).
 *
 * Separator `;` i BOM — jak dotychczasowy eksport macierzy w panelu:
 * bez BOM Excel otwiera plik w Windows-1250 i polskie znaki giną.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  budujRaportCsv,
  type RaportAplikacja,
  type RaportGrantu,
} from '../src/access/access.service';

const DZISIAJ = '2026-10-24';

const aplikacja: RaportAplikacja = {
  id: 'app-1',
  nazwa: 'System E-mail',
  status: 'PROD',
  klasyfikacja: 'CONFIDENTIAL',
  krytycznosc: 3,
  typDostarczania: 'SAAS',
  wlasciciel: 'Anna Administrator',
};

const grant: RaportGrantu = {
  aplikacjaId: 'app-1',
  osoba: 'Jan Kowalski',
  email: 'jan.kowalski@firma.pl',
  departament: 'IT',
  stanowisko: 'Administrator',
  poziom: 'ADMIN',
  nadane: '2026-01-05',
  wygasa: null,
  notatka: null,
};

/**
 * Podział wiersza CSV na pola — świadomy cudzysłowów: komórka w cudzysłowach
 * może zawierać `;` i `""`, których nie wolno traktować jako separatora.
 */
function pola(linia: string): string[] {
  const wynik: string[] = [];
  let pole = '';
  let wCudzyslowie = false;
  for (let i = 0; i < linia.length; i++) {
    const znak = linia[i]!;
    if (wCudzyslowie) {
      if (znak === '"') {
        if (linia[i + 1] === '"') {
          pole += '"';
          i++;
        } else {
          wCudzyslowie = false;
        }
      } else {
        pole += znak;
      }
    } else if (znak === '"') {
      wCudzyslowie = true;
    } else if (znak === ';') {
      wynik.push(pole);
      pole = '';
    } else {
      pole += znak;
    }
  }
  wynik.push(pole);
  return wynik;
}

/** Linie po pierwszej (nagłówek wygenerowania) — danych do sprawdzania pól. */
function linie(csv: string): string[] {
  return csv.replace(/^\ufeff/, '').split('\r\n');
}

describe('budujRaportCsv — raport macierzy uprawnień', () => {
  it('nagłówek z datą wygenerowania jako pierwsza linia', () => {
    const csv = budujRaportCsv([aplikacja], [], DZISIAJ);
    assert.equal(linie(csv)[0], `Raport wygenerowano: ${DZISIAJ}`);
  });

  it('kolumny zgodne ze specyfikacją — 15 pól po średniku', () => {
    const csv = budujRaportCsv([aplikacja], [], DZISIAJ);
    assert.deepEqual(pola(linie(csv)[1]!), [
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
    ]);
  });

  it('wiersz grantu przenosi dane aplikacji i osoby', () => {
    const csv = budujRaportCsv([aplikacja], [grant], DZISIAJ);
    const wiersz = pola(linie(csv)[2]!);
    assert.deepEqual(wiersz, [
      'System E-mail',
      'PROD',
      'CONFIDENTIAL',
      '3',
      'SAAS',
      'Anna Administrator',
      'Jan Kowalski',
      'jan.kowalski@firma.pl',
      'IT',
      'Administrator',
      'ADMIN',
      '2026-01-05',
      '',
      'aktywny',
      '',
    ]);
  });

  it('grant wygasający dzisiaj jest aktywny, wygasający wcześniej — Wygasł', () => {
    const wczoraj: RaportGrantu = { ...grant, wygasa: '2026-10-23' };
    const dzis: RaportGrantu = { ...grant, wygasa: DZISIAJ };
    const csv = budujRaportCsv([aplikacja], [wczoraj, dzis], DZISIAJ);
    const [wierszWczoraj, wierszDzis] = linie(csv).slice(2);
    assert.equal(pola(wierszWczoraj!)![13], 'Wygasł');
    assert.equal(pola(wierszDzis!)![13], 'aktywny');
  });

  it('notatka ze średnikiem i cudzysłowem zostaje w jednej komórce', () => {
    const zNotatka: RaportGrantu = { ...grant, notatka: 'a;b "x"' };
    const csv = budujRaportCsv([aplikacja], [zNotatka], DZISIAJ);
    const wiersz = pola(linie(csv)[2]!);
    assert.equal(wiersz.length, 15, 'podział na ; nie może rozbić komórki w cudzysłowach');
    assert.equal(wiersz[14], 'a;b "x"');
  });

  it('aplikacja bez grantów dostaje wiersz (brak pozycji)', () => {
    const csv = budujRaportCsv([aplikacja], [], DZISIAJ);
    const wiersz = pola(linie(csv)[2]!);
    assert.equal(wiersz[0], 'System E-mail', 'kolumny aplikacyjne wypełnione');
    assert.equal(wiersz[5], 'Anna Administrator');
    assert.equal(wiersz[6], '(brak pozycji)');
    assert.equal(wiersz[10], '', 'poziom pusty — nikogo tu nie ma');
    assert.equal(wiersz[11], '');
    assert.equal(wiersz[13], '');
  });

  it('polskie znaki i BOM', () => {
    const osoba: RaportGrantu = { ...grant, osoba: 'Łucja Kowalski-Łącki' };
    const csv = budujRaportCsv([aplikacja], [osoba], DZISIAJ);
    assert.ok(csv.startsWith('\ufeff'), 'bez BOM Excel otworzy plik w Windows-1250');
    assert.ok(csv.includes('Kowalski-Łącki'), 'polskie znaki muszą przetrwać');
  });

  it('kolejność wierszy = kolejność listy aplikacji — builder nie sortuje', () => {
    const b: RaportAplikacja = { ...aplikacja, id: 'app-b', nazwa: 'Biletomat' };
    const a: RaportAplikacja = { ...aplikacja, id: 'app-a', nazwa: 'Archiwum' };
    const grantB: RaportGrantu = { ...grant, aplikacjaId: 'app-b' };
    const csv = budujRaportCsv([b, a], [grantB], DZISIAJ);
    const cialo = linie(csv).slice(2);
    assert.equal(pola(cialo[0]!)![0], 'Biletomat', 'kolejność przekazana, nie alfabetyczna');
    assert.equal(pola(cialo[1]!)![0], 'Archiwum');
  });
});
