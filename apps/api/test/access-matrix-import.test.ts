/**
 * Import macierzy uprawnień z CSV — podgląd i zapis.
 *
 * Import jest okrężny z eksportem: plik raportu po poprawkach wraca do
 * ewidencji. Dwa kroki — podgląd i zapis — pilnują dwóch różnych rzeczy:
 *
 *  - **Podgląd** pokazuje administratorowi, co się stanie: nowe granty,
 *    nowe osoby, aktualizacje z różnicą, wiersze bez zmian i błędy.
 *    Nic nie zapisuje.
 *  - **Zapis nie ufa podglądowi.** Podgląd i zapis rozdziela przerwa w
 *    pracy; payload z przeglądarki jest niezaufany. Każdy wiersz jest
 *    walidowany od nowa, niesprawdzalny jest pomijany i zliczany.
 *
 * Semantyka: **upsert** — wiersz pliku nadaje lub aktualizuje dostęp.
 * Osoba nieobecna w pliku zachowuje dostęp; pusty plik nic nie odbiera.
 */
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AccessService } from '../src/access/access.service';
import {
  type AccessLevelName,
  type ApplicationAccessRow,
  type ApplicationRefRow,
  type PersonRow,
} from '../src/access/access.port';
import { type FakeDb, fakeAudit, fakeDb } from './helpers/access-fake';
function aplikacja(nadpisania: Partial<ApplicationRefRow> = {}): ApplicationRefRow {
  return {
    id: randomUUID(),
    name: 'System kadrowy',
    deletedAt: null,
    deliveryType: 'SAAS',
    ...nadpisania,
  };
}

function zSerwisem(aplikacje: ApplicationRefRow[] = [aplikacja()]) {
  const db = fakeDb(aplikacje);
  const audit = fakeAudit();
  return { ...db, audit, serwis: new AccessService(db.port, audit as never) };
}

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

function wierszCsv(
  opcje: {
    aplikacja?: string;
    osoba?: string;
    email?: string;
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
    'SAAS',
    'Anna Zalewska',
    opcje.osoba ?? 'Jan Kowalski',
    opcje.email ?? 'jan@f.pl',
    'IT',
    'Dev',
    opcje.poziom ?? 'ADMIN',
    '2026-09-01',
    opcje.wygasa ?? '',
    '',
    opcje.notatka ?? '',
  ];
  return w.join(';');
}

function plikCsv(wiersze: string[]): string {
  return ['\ufeffRaport wygenerowano: 2026-10-24', NAGLOWEK.join(';'), ...wiersze].join('\r\n');
}

/** Osoba istniejąca w katalogu — wstawiana wprost do atrapy. */
function osobaWBazie(db: FakeDb, email: string): PersonRow {
  const osoba: PersonRow = {
    id: randomUUID(),
    firstName: 'Jan',
    lastName: 'Kowalski',
    email,
    position: null,
    department: null,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
  db.osoby.push(osoba);
  return osoba;
}

/** Grant istniejący w macierzy — wstawiany wprost do atrapy. */
function grantWBazie(
  db: FakeDb,
  osobaId: string,
  aplikacjaId: string,
  dane: { level?: AccessLevelName; expiresOn?: string; note?: string } = {},
): void {
  const grant: ApplicationAccessRow = {
    applicationId: aplikacjaId,
    personId: osobaId,
    level: dane.level ?? 'USER',
    grantedOn: new Date('2026-01-01T00:00:00Z'),
    expiresOn: dane.expiresOn ? new Date(dane.expiresOn) : null,
    note: dane.note ?? null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
  db.granty.push(grant);
}

describe('Import macierzy — podgląd', () => {
  it('klasyfikuje: nowy grant, nowa osoba, aktualizacja z diffem, wiersz bez zmian', async () => {
    const stan = zSerwisem();
    const istniejacaOsoba = osobaWBazie(stan, 'jan@f.pl');
    const drugaOsoba = osobaWBazie(stan, 'anna@f.pl');
    osobaWBazie(stan, 'tomasz@f.pl');
    grantWBazie(stan, istniejacaOsoba.id, stan.aplikacje[0]!.id, {
      level: 'USER',
      expiresOn: '2027-01-01',
    });
    grantWBazie(stan, drugaOsoba.id, stan.aplikacje[0]!.id, { level: 'READ_ONLY' });

    const podglad = await podgladImportu(stan.serwis, plikCsv([
      // jan: grant istnieje, plik podnosi poziom — UPDATE z diffem.
      wierszCsv({ email: 'jan@f.pl', poziom: 'ADMIN', wygasa: '2027-01-01' }),
      // anna: grant istnieje, dane identyczne — UNCHANGED.
      wierszCsv({ email: 'anna@f.pl', poziom: 'READ_ONLY' }),
      // nowa osoba, nowy grant.
      wierszCsv({ email: 'nowa@f.pl', osoba: 'Nowa Osoba', poziom: 'USER' }),
      // osoba istnieje, grant nowy.
      wierszCsv({ email: 'tomasz@f.pl', osoba: 'Tomasz Nowy' }),
    ]));

    const [jan, anna, nowa, tomasz] = podglad.rows;
    assert.equal(jan!.status, 'UPDATE');
    assert.deepEqual(jan!.diff, [{ pole: 'poziom', od: 'USER', do: 'ADMIN' }]);
    assert.equal(anna!.status, 'UNCHANGED');
    assert.deepEqual(anna!.diff, []);
    assert.equal(nowa!.status, 'NEW_PERSON');
    assert.equal(tomasz!.status, 'NEW');

    assert.deepEqual(podglad.summary, {
      total: 4,
      new: 1,
      newPerson: 1,
      update: 1,
      unchanged: 1,
      invalid: 0,
    });
  });

  it('diff pokazuje też wygasanie i notatkę, nie tylko poziom', async () => {
    const stan = zSerwisem();
    const osoba = osobaWBazie(stan, 'jan@f.pl');
    grantWBazie(stan, osoba.id, stan.aplikacje[0]!.id, {
      level: 'USER',
      expiresOn: '2027-01-01',
      note: 'stara nota',
    });

    const podglad = await podgladImportu(stan.serwis, plikCsv([
      wierszCsv({ email: 'jan@f.pl', poziom: 'USER', wygasa: '2028-06-01', notatka: 'nowa nota' }),
    ]));

    assert.deepEqual(podglad.rows[0]!.diff, [
      { pole: 'wygasa', od: '2027-01-01', do: '2028-06-01' },
      { pole: 'notatka', od: 'stara nota', do: 'nowa nota' },
    ]);
  });

  it('puste „Wygasa" w pliku czyści datę — właściciel może zdjąć wygasanie', async () => {
    const stan = zSerwisem();
    const osoba = osobaWBazie(stan, 'jan@f.pl');
    grantWBazie(stan, osoba.id, stan.aplikacje[0]!.id, {
      level: 'USER',
      expiresOn: '2027-01-01',
      note: 'stara nota',
    });

    const podglad = await podgladImportu(stan.serwis, plikCsv([
      wierszCsv({ email: 'jan@f.pl', poziom: 'USER', wygasa: '', notatka: '' }),
    ]));

    assert.equal(podglad.rows[0]!.status, 'UPDATE');
    assert.deepEqual(podglad.rows[0]!.diff, [
      { pole: 'wygasa', od: '2027-01-01', do: '' },
      { pole: 'notatka', od: 'stara nota', do: '' },
    ]);
  });

  it('nowa osoba bez nazwiska to błąd MISSING_NAME, nie ciche zapisanie', async () => {
    const stan = zSerwisem();
    // Osoba jednoliterowa — split zostawia lastName null.
    const podglad = await podgladImportu(stan.serwis, plikCsv([
      wierszCsv({ email: 'nowa@f.pl', osoba: 'Zaratustra' }),
    ]));

    assert.equal(podglad.rows[0]!.status, 'ERROR');
    assert.deepEqual(podglad.rows[0]!.errors, ['MISSING_NAME']);
    assert.equal(podglad.summary.invalid, 1);
  });

  it('bulk: nieznana nazwa aplikacji → UNKNOWN_APP, GENERAL_USE → GENERAL_USE_APP', async () => {
    const stan = zSerwisem([
      aplikacja(),
      aplikacja({ name: 'Aplikacja ogólna', deliveryType: 'GENERAL_USE' }),
    ]);

    const podglad = await podgladImportu(stan.serwis, plikCsv([
      wierszCsv({ aplikacja: 'Nie ma takiej' }),
      wierszCsv({ aplikacja: 'Aplikacja ogólna' }),
      wierszCsv(),
    ]));

    assert.deepEqual(podglad.rows[0]!.errors, ['UNKNOWN_APP']);
    assert.deepEqual(podglad.rows[1]!.errors, ['GENERAL_USE_APP']);
    assert.deepEqual(podglad.rows[2]!.errors, []);
    // Lista rozpoznanych aplikacji liczy tylko te, które istnieją.
    assert.deepEqual(
      podglad.aplikacje.map((a) => a.nazwa),
      ['System kadrowy'],
    );
  });

  it('aplikacja usunięta (soft delete) → UNKNOWN_APP', async () => {
    const stan = zSerwisem([aplikacja(), aplikacja({ name: 'Archiwum', deletedAt: new Date('2026-01-01') })]);
    const podglad = await podgladImportu(stan.serwis, plikCsv([
      wierszCsv({ aplikacja: 'Archiwum' }),
    ]));
    assert.deepEqual(podglad.rows[0]!.errors, ['UNKNOWN_APP']);
  });

  it('tryb pojedynczy: wiersz innej aplikacji → APP_MISMATCH, pusta kolumna jest OK', async () => {
    const stan = zSerwisem([aplikacja(), aplikacja({ name: 'Wiki' })]);
    const id = stan.aplikacje[0]!.id;

    const podglad = await stan.serwis.previewMatrixImport(
      plikCsv([wierszCsv({ aplikacja: 'Wiki' }), wierszCsv({ aplikacja: '' })]),
      id,
    );

    assert.deepEqual(podglad.rows[0]!.errors, ['APP_MISMATCH']);
    assert.deepEqual(podglad.rows[1]!.errors, []);
  });

  it('tryb pojedynczy: nieistniejąca aplikacja → 404', async () => {
    const stan = zSerwisem();
    await assert.rejects(
      () => stan.serwis.previewMatrixImport(plikCsv([wierszCsv()]), randomUUID()),
      NotFoundException,
    );
  });

  it('tryb pojedynczy: aplikacja GENERAL_USE → 400', async () => {
    const stan = zSerwisem([aplikacja({ deliveryType: 'GENERAL_USE' })]);
    await assert.rejects(
      () => stan.serwis.previewMatrixImport(plikCsv([wierszCsv()]), stan.aplikacje[0]!.id),
      BadRequestException,
    );
  });

  it('wygasanie w przeszłości odrzuca nowy grant, ale nie aktualizację', async () => {
    const stan = zSerwisem();
    const osoba = osobaWBazie(stan, 'jan@f.pl');
    grantWBazie(stan, osoba.id, stan.aplikacje[0]!.id, { level: 'USER' });
    const innaOsoba = osobaWBazie(stan, 'tomasz@f.pl');

    const podglad = await podgladImportu(stan.serwis, plikCsv([
      // Nowy grant z datą w przeszłości — odrzucony jak przy ręcznym nadawaniu.
      wierszCsv({ email: innaOsoba.email, poziom: 'USER', wygasa: '2020-01-01' }),
      // Aktualizacja z datą w przeszłości — porządkowanie zapisu, dozwolone.
      wierszCsv({ email: 'jan@f.pl', poziom: 'USER', wygasa: '2020-01-01' }),
    ]));

    assert.deepEqual(podglad.rows[0]!.errors, ['EXPIRY_IN_PAST']);
    assert.equal(podglad.rows[0]!.status, 'ERROR');
    assert.deepEqual(podglad.rows[1]!.errors, []);
    assert.equal(podglad.rows[1]!.status, 'UPDATE');
  });

  it('osoba nieaktywna → PERSON_INACTIVE — jak przy ręcznym nadawaniu', async () => {
    const stan = zSerwisem();
    const osoba = osobaWBazie(stan, 'byly@f.pl');
    osoba.isActive = false;

    const podglad = await podgladImportu(stan.serwis, plikCsv([
      wierszCsv({ email: 'byly@f.pl', poziom: 'USER' }),
    ]));

    assert.equal(podglad.rows[0]!.status, 'ERROR');
    assert.deepEqual(podglad.rows[0]!.errors, ['PERSON_INACTIVE']);
  });

  it('podgląd niczego nie zapisuje — ani bazy, ani dziennika', async () => {
    const stan = zSerwisem();
    const przedOsoby = stan.osoby.length;
    const przedGranty = stan.granty.length;

    await podgladImportu(stan.serwis, plikCsv([
      wierszCsv({ email: 'nowa@f.pl', osoba: 'Nowa Osoba' }),
      wierszCsv({ email: 'anna@f.pl', poziom: 'USER' }),
    ]));

    assert.equal(stan.osoby.length, przedOsoby, 'podgląd nie tworzy osób');
    assert.equal(stan.granty.length, przedGranty, 'podgląd nie nadaje grantów');
    assert.equal(stan.audit.wpisy.length, 0, 'podgląd nie pisze do dziennika');
  });

  it('błędy parsera (np. INVALID_LEVEL) trafiają do wiersza jako 400-wy zapis, nie wyjątek', async () => {
    const stan = zSerwisem();
    const podglad = await podgladImportu(stan.serwis, plikCsv([
      wierszCsv({ poziom: 'Szef' }),
    ]));
    assert.equal(podglad.rows[0]!.status, 'ERROR');
    assert.ok(podglad.rows[0]!.errors.includes('INVALID_LEVEL'));
  });

  it('plik bez kolumn raportu → 400 z komunikatem CsvError', async () => {
    const stan = zSerwisem();
    const zlyPlik = 'Imię;Nazwisko\nJan;Kowalski';
    await assert.rejects(
      () => stan.serwis.previewMatrixImport(zlyPlik),
      (blad: unknown) => blad instanceof BadRequestException && /kolumn/i.test(blad.message),
    );
  });
});

async function podgladImportu(
  serwis: AccessService,
  csv: string,
): Promise<Awaited<ReturnType<AccessService['previewMatrixImport']>>> {
  return serwis.previewMatrixImport(csv);
}
