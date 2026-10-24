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
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { NotFoundException } from '@nestjs/common';
import {
  AccessService,
  budujRaportCsv,
  type RaportAplikacja,
  type RaportGrantu,
} from '../src/access/access.service';
import { fakeAudit, fakeDb } from './helpers/access-fake';
import type { ApplicationRefRow } from '../src/access/access.port';
import type { AuthUser } from '../src/auth/decorators';

const aktor: AuthUser = {
  id: randomUUID(),
  username: 'admin',
  email: 'admin@firma.pl',
  fullName: 'Anna Administrator',
  role: 'ADMIN',
  mustChangePassword: false,
};

/** Aplikacja z pełnymi metadanymi raportu — domyślnie zwykła, nie usunięta. */
function aplikacjaW(opcje: Partial<ApplicationRefRow> & { name: string }): ApplicationRefRow {
  return {
    id: randomUUID(),
    deletedAt: null,
    status: 'PROD',
    securityClass: 'INTERNAL',
    criticality: 2,
    deliveryType: 'SELF_HOSTED',
    ownerId: null,
    ...opcje,
  };
}

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

describe('AccessService — eksport raportu macierzy', () => {
  it('pełny eksport grupuje po aplikacji i sortuje po nazwie, osoby po nazwisku', async () => {
    // Kolejność przekazana do atrapy odwrotna alfabetycznie — eksport musi posortować.
    const biletomat = aplikacjaW({ name: 'Biletomat' });
    const archiwum = aplikacjaW({ name: 'Archiwum' });
    const db = fakeDb([biletomat, archiwum]);
    const serwis = new AccessService(db.port, fakeAudit() as never);

    // Kolejność nadawania odwrotna do nazwisk — sort po nazwisku musi ją odwrócić.
    await serwis.grantAccess(archiwum.id, { email: 'z.y@firma.pl', firstName: 'Zofia', lastName: 'Y' }, aktor);
    await serwis.grantAccess(archiwum.id, { email: 'a.x@firma.pl', firstName: 'Adam', lastName: 'X' }, aktor);
    await serwis.grantAccess(biletomat.id, { email: 'm.z@firma.pl', firstName: 'Marek', lastName: 'Z' }, aktor);

    const { csv } = await serwis.exportMatrixCsv();
    const cialo = linie(csv).slice(2);
    assert.deepEqual(
      cialo.map((w) => `${pola(w)![0]} / ${pola(w)![6]}`),
      [
        'Archiwum / Adam X',
        'Archiwum / Zofia Y',
        'Biletomat / Marek Z',
      ],
    );
  });

  it('aplikacja bez grantów ma wiersz (brak pozycji)', async () => {
    const pusta = aplikacjaW({ name: 'Pusta Aplikacja' });
    const db = fakeDb([pusta]);
    const serwis = new AccessService(db.port, fakeAudit() as never);

    const { csv } = await serwis.exportMatrixCsv();
    const wiersz = pola(linie(csv)[2]!);
    assert.equal(wiersz[0], 'Pusta Aplikacja');
    assert.equal(wiersz[6], '(brak pozycji)');
  });

  it('granty aplikacji usuniętej nie wypadają w raporcie', async () => {
    const usunieta = aplikacjaW({ name: 'Stary System', deletedAt: new Date('2026-05-01T00:00:00Z') });
    const zywa = aplikacjaW({ name: 'Żywa Aplikacja' });
    const db = fakeDb([usunieta, zywa]);
    const serwis = new AccessService(db.port, fakeAudit() as never);
    // Grant wprost do atrapy: `grantAccess` (słusznie) odrzuca nadanie
    // dla usuniętej aplikacji, a raport ma pokazać los historycznego grantu.
    const osoba = {
      id: randomUUID(),
      firstName: 'Adam',
      lastName: 'X',
      email: 'a.x@firma.pl',
      position: null,
      department: null,
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    db.osoby.push(osoba);
    db.granty.push({
      applicationId: usunieta.id,
      personId: osoba.id,
      level: 'USER',
      grantedOn: new Date('2026-01-01T00:00:00Z'),
      expiresOn: null,
      note: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    const { csv } = await serwis.exportMatrixCsv();

    assert.ok(!csv.includes('Stary System'), 'aplikacja usunięta nie ma wiersza');
    assert.ok(!csv.includes('Adam X'), 'jej grant nie wypada bez nagłówka aplikacji');
    assert.equal((csv.match(/Żywa Aplikacja/g) ?? []).length, 1, 'pozostałe aplikacje nie dotknięte');
  });

  it('aplikacje GENERAL_USE nie wchodzą do raportu, nawet z historycznym grantem', async () => {
    const generalna = aplikacjaW({ name: '7-Zip', deliveryType: 'GENERAL_USE' });
    const zwykla = aplikacjaW({ name: 'Zwykła Aplikacja' });
    const db = fakeDb([generalna, zwykla]);
    const serwis = new AccessService(db.port, fakeAudit() as never);
    const osoba = {
      id: randomUUID(),
      firstName: 'Anna',
      lastName: 'X',
      email: 'a.x@firma.pl',
      position: null,
      department: null,
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    db.osoby.push(osoba);
    db.granty.push({
      applicationId: generalna.id,
      personId: osoba.id,
      level: 'USER',
      grantedOn: new Date('2026-01-01T00:00:00Z'),
      expiresOn: null,
      note: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    const { csv } = await serwis.exportMatrixCsv();

    assert.ok(!csv.includes('7-Zip'), 'GENERAL_USE nie ma macierzy');
    assert.ok(csv.includes('Zwykła Aplikacja'));
  });

  it('właściciel aplikacji jako Imię Nazwisko, bez właściciela — pusta', async () => {
    const wlasciciel = {
      id: randomUUID(),
      firstName: 'Anna',
      lastName: 'Administrator',
      email: 'anna@firma.pl',
      position: null,
      department: null,
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    const zWlascicielem = aplikacjaW({ name: 'Z Właścicielem', ownerId: wlasciciel.id });
    const bezWlasciciela = aplikacjaW({ name: 'Bez Właściciela' });
    const db = fakeDb([zWlascicielem, bezWlasciciela]);
    db.osoby.push(wlasciciel);
    const serwis = new AccessService(db.port, fakeAudit() as never);

    const { csv } = await serwis.exportMatrixCsv();
    const wiersze = linie(csv).slice(2).map(pola);
    // Sortowanie po nazwie: 'Bez…' przed 'Z …'.
    assert.equal(wiersze[0]![0], 'Bez Właściciela');
    assert.equal(wiersze[0]![5], '');
    assert.equal(wiersze[1]![0], 'Z Właścicielem');
    assert.equal(wiersze[1]![5], 'Anna Administrator');
  });

  it('eksport jednej aplikacji zawiera tylko jej wiersze z pełnymi metadanymi', async () => {
    const biletomat = aplikacjaW({ name: 'Biletomat', status: 'TEST', securityClass: 'PUBLIC', criticality: 1, deliveryType: 'SAAS' });
    const archiwum = aplikacjaW({ name: 'Archiwum' });
    const db = fakeDb([biletomat, archiwum]);
    const serwis = new AccessService(db.port, fakeAudit() as never);
    await serwis.grantAccess(biletomat.id, { email: 'a.x@firma.pl', firstName: 'Adam', lastName: 'X' }, aktor);
    await serwis.grantAccess(archiwum.id, { email: 'z.y@firma.pl', firstName: 'Zofia', lastName: 'Y' }, aktor);

    const { csv } = await serwis.exportMatrixCsv(biletomat.id);
    const cialo = linie(csv).slice(2);

    assert.equal(cialo.length, 1, 'tylko jeden wiersz — granty drugiej aplikacji poza raportem');
    const wiersz = pola(cialo[0]!);
    assert.deepEqual(wiersz.slice(0, 6), ['Biletomat', 'TEST', 'PUBLIC', '1', 'SAAS', '']);
    assert.equal(wiersz[6], 'Adam X');
  });

  it('eksport jednej aplikacji: 404 dla nieistniejącej, usuniętej i GENERAL_USE', async () => {
    const usunieta = aplikacjaW({ name: 'Stary System', deletedAt: new Date('2026-05-01T00:00:00Z') });
    const generalna = aplikacjaW({ name: '7-Zip', deliveryType: 'GENERAL_USE' });
    const db = fakeDb([usunieta, generalna]);
    const serwis = new AccessService(db.port, fakeAudit() as never);

    await assert.rejects(() => serwis.exportMatrixCsv(randomUUID()), (e: NotFoundException) => {
      assert.equal(e.message, 'Aplikacja nie istnieje.');
      return true;
    });
    await assert.rejects(() => serwis.exportMatrixCsv(usunieta.id), (e: NotFoundException) => {
      assert.equal(e.message, 'Aplikacja nie istnieje.');
      return true;
    });
    await assert.rejects(() => serwis.exportMatrixCsv(generalna.id), (e: NotFoundException) => {
      assert.equal(e.message, 'Aplikacja ogólnego użytku nie ma macierzy uprawnień.');
      return true;
    });
  });

  it('eksport jednej aplikacji bez grantów daje wiersz (brak pozycji)', async () => {
    const pusta = aplikacjaW({ name: 'Pusta Aplikacja' });
    const db = fakeDb([pusta]);
    const serwis = new AccessService(db.port, fakeAudit() as never);

    const { csv } = await serwis.exportMatrixCsv(pusta.id);
    assert.equal(pola(linie(csv)[2]!)![6], '(brak pozycji)');
  });

  it('nazwy plików z datą i slugiem nazwy aplikacji', async () => {
    const email = aplikacjaW({ name: 'System E-mail' });
    const zolw = aplikacjaW({ name: 'Żółw 3D' });
    const db = fakeDb([email, zolw]);
    const serwis = new AccessService(db.port, fakeAudit() as never);

    assert.equal((await serwis.exportMatrixCsv()).nazwaPliku, `macierz-uprawnien-${DZISIAJ}.csv`);
    // Hyfen jest częścią sluga (standard: spacje i symbole → '-', gotowe
    // litery zostają) — 'System E-mail' → 'system-e-mail'.
    assert.equal(
      (await serwis.exportMatrixCsv(email.id)).nazwaPliku,
      `raport-uprawnien-system-e-mail-${DZISIAJ}.csv`,
    );
    assert.equal(
      (await serwis.exportMatrixCsv(zolw.id)).nazwaPliku,
      `raport-uprawnien-zolw-3d-${DZISIAJ}.csv`,
    );
  });
});
