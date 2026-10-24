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
import { MAX_MATRIX_ROWS } from '../src/access/matrix-csv';
import {
  type AccessLevelName,
  type ApplicationAccessRow,
  type ApplicationRefRow,
  type PersonRow,
} from '../src/access/access.port';
import { type FakeDb, fakeAudit, fakeDb } from './helpers/access-fake';
import type { AuthUser } from '../src/auth/decorators';

/**
 * Aktor zapisu importu macierzy — jedna tożsamość dla testów podglądu
 * i zapisu (zapis wymaga aktora do wpisu audytowego).
 */
const actor: AuthUser = {
  id: randomUUID(),
  username: 'admin',
  email: 'admin@firma.pl',
  fullName: 'Anna Administrator',
  role: 'ADMIN',
  mustChangePassword: false,
};
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

  it('niepoprawny e-mail → INVALID_EMAIL — podgląd nie obiecuje śmieciowego adresu', async () => {
    const stan = zSerwisem();
    const podglad = await podgladImportu(stan.serwis, plikCsv([
      wierszCsv({ email: 'jan#f.pl' }),
    ]));
    assert.equal(podglad.rows[0]!.status, 'ERROR');
    assert.deepEqual(podglad.rows[0]!.errors, ['INVALID_EMAIL']);
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

describe('Import macierzy — zapis', () => {
  it('zapisuje nowe granty i tworzy osoby z prefillem danych z pliku', async () => {
    const stan = zSerwisem();
    osobaWBazie(stan, 'tomasz@f.pl');
    const id = stan.aplikacje[0]!.id;

    const wynik = await stan.serwis.applyMatrixImport(
      [
        // Osoba istnieje — dostaje grant.
        { email: 'tomasz@f.pl', level: 'USER' },
        // Osoba nowa — powstaje z danymi z pliku, potem grant.
        {
          email: 'nowa@f.pl',
          firstName: 'Nowa',
          lastName: 'Osoba',
          department: 'IT',
          position: 'Analityk',
          level: 'ADMIN',
        },
      ],
      actor,
      undefined,
      id,
    );

    assert.deepEqual(wynik, {
      createdGrants: 2,
      updatedGrants: 0,
      createdPersons: 1,
      unchanged: 0,
      skipped: 0,
      skippedRows: [],
    });

    const nowa = stan.osoby.find((o) => o.email === 'nowa@f.pl');
    assert.ok(nowa, 'osoba utworzona');
    assert.equal(nowa!.department, 'IT');
    assert.equal(nowa!.position, 'Analityk');

    const grant = stan.granty.find((g) => g.personId === nowa!.id);
    assert.ok(grant);
    // Datę nadania ustawia baza (default), nie plik — jak przy grantAccess.
    assert.ok(grant!.grantedOn instanceof Date);
    assert.equal(grant!.level, 'ADMIN');
  });

  it('aktualizuje poziom i wygasanie grantu, nie ruszając daty nadania', async () => {
    const stan = zSerwisem();
    const osoba = osobaWBazie(stan, 'jan@f.pl');
    grantWBazie(stan, osoba.id, stan.aplikacje[0]!.id, {
      level: 'USER',
      expiresOn: '2027-01-01',
    });

    const wynik = await stan.serwis.applyMatrixImport(
      [{ email: 'jan@f.pl', level: 'ADMIN', expiresOn: '2028-06-01', note: 'po przeglądzie' }],
      actor,
      undefined,
      stan.aplikacje[0]!.id,
    );

    assert.deepEqual(wynik, {
      createdGrants: 0,
      updatedGrants: 1,
      createdPersons: 0,
      unchanged: 0,
      skipped: 0,
      skippedRows: [],
    });
    const grant = stan.granty.find((g) => g.personId === osoba.id);
    assert.equal(grant!.level, 'ADMIN');
    assert.equal(grant!.note, 'po przeglądzie');
    assert.equal(grant!.expiresOn?.toISOString().slice(0, 10), '2028-06-01');
    assert.equal(grant!.grantedOn.toISOString().slice(0, 10), '2026-01-01', 'data nadania nietknięta');
  });

  it('wiersz bez zmian jest liczony, ale niczego nie zapisuje', async () => {
    const stan = zSerwisem();
    const osoba = osobaWBazie(stan, 'jan@f.pl');
    grantWBazie(stan, osoba.id, stan.aplikacje[0]!.id, { level: 'USER', note: 'nota' });
    const przed = JSON.stringify(stan.granty);

    const wynik = await stan.serwis.applyMatrixImport(
      [{ email: 'jan@f.pl', level: 'USER', note: 'nota' }],
      actor,
      undefined,
      stan.aplikacje[0]!.id,
    );

    assert.equal(wynik.unchanged, 1);
    assert.equal(wynik.updatedGrants, 0);
    assert.equal(JSON.stringify(stan.granty), przed, 'grant bez różnic nie jest zapisywany');
  });

  it('wiersz z błędnym poziomem (obejście DTO) pomijany z powodem, reszta zapisana', async () => {
    const stan = zSerwisem();
    const id = stan.aplikacje[0]!.id;

    const wynik = await stan.serwis.applyMatrixImport(
      [
        { email: 'zly@f.pl', firstName: 'Zły', lastName: 'Wiersz', level: 'Szef' },
        { email: 'dobry@f.pl', firstName: 'Dobry', lastName: 'Wiersz', level: 'USER' },
      ],
      actor,
      undefined,
      id,
    );

    assert.equal(wynik.skipped, 1);
    assert.deepEqual(wynik.skippedRows, [
      { email: 'zly@f.pl', aplikacja: 'System kadrowy', errors: ['INVALID_LEVEL'] },
    ]);
    assert.equal(wynik.createdGrants, 1, 'śmieciowy wiersz nie wywraca importu');
  });

  it('duplikat osoba+aplikacja w payloadzie pominięty — pierwszy wiersz wygrywa', async () => {
    const stan = zSerwisem();
    const id = stan.aplikacje[0]!.id;

    const wynik = await stan.serwis.applyMatrixImport(
      [
        { email: 'jan@f.pl', firstName: 'Jan', lastName: 'Kowalski', level: 'USER' },
        { email: 'JAN@F.PL', firstName: 'Jan', lastName: 'Kowalski', level: 'OWNER' },
      ],
      actor,
      undefined,
      id,
    );

    assert.equal(wynik.createdGrants, 1);
    assert.equal(wynik.skipped, 1);
    assert.equal(stan.granty[0]!.level, 'USER', 'drugi wiersz nie nadpisuje pierwszego po cichu');
    assert.deepEqual(wynik.skippedRows[0]!.errors, ['DUPLICATE_IN_FILE']);
  });

  it('bulk: granty lądują we właściwych aplikacjach', async () => {
    const stan = zSerwisem([aplikacja(), aplikacja({ name: 'Wiki' })]);
    const [kadry, wiki] = stan.aplikacje;

    await stan.serwis.applyMatrixImport(
      [
        { email: 'jan@f.pl', firstName: 'Jan', lastName: 'Kowalski', level: 'USER', applicationName: 'System kadrowy' },
        { email: 'jan@f.pl', firstName: 'Jan', lastName: 'Kowalski', level: 'ADMIN', applicationName: 'Wiki' },
      ],
      actor,
    );

    const osoba = stan.osoby.find((o) => o.email === 'jan@f.pl')!;
    const grantKadry = stan.granty.find((g) => g.applicationId === kadry!.id);
    const grantWiki = stan.granty.find((g) => g.applicationId === wiki!.id);
    assert.ok(grantKadry && grantWiki);
    assert.equal(grantKadry!.personId, osoba.id);
    assert.equal(grantWiki!.personId, osoba.id);
  });

  it('aplikacja usunięta między podglądem a zapisem → skipped, nie 500', async () => {
    const stan = zSerwisem();

    // Podgląd by przeszedł; przed zapisem aplikację usunięto (soft delete).
    stan.aplikacje[0]!.deletedAt = new Date('2026-10-24');

    const wynik = await stan.serwis.applyMatrixImport(
      [{ email: 'jan@f.pl', firstName: 'Jan', lastName: 'Kowalski', level: 'USER', applicationName: 'System kadrowy' }],
      actor,
    );

    assert.equal(wynik.skipped, 1);
    assert.deepEqual(wynik.skippedRows[0]!.errors, ['UNKNOWN_APP']);
    assert.equal(stan.granty.length, 0);
  });

  it('grant w bazie, nieobecny w payloadzie → nietknięty', async () => {
    const stan = zSerwisem();
    const jan = osobaWBazie(stan, 'jan@f.pl');
    const anna = osobaWBazie(stan, 'anna@f.pl');
    grantWBazie(stan, jan.id, stan.aplikacje[0]!.id, { level: 'USER' });
    grantWBazie(stan, anna.id, stan.aplikacje[0]!.id, { level: 'OWNER', note: 'nietknięte' });
    const przedAnna = JSON.stringify(stan.granty.find((g) => g.personId === anna.id));

    await stan.serwis.applyMatrixImport(
      [{ email: 'jan@f.pl', level: 'ADMIN' }],
      actor,
    );

    assert.equal(
      JSON.stringify(stan.granty.find((g) => g.personId === anna.id)),
      przedAnna,
      'upsert: osoba nieobecna w pliku zachowuje dostęp',
    );
  });

  it('osoba istniejąca: departament i stanowisko z pliku nie nadpisują katalogu', async () => {
    const stan = zSerwisem();
    const osoba = osobaWBazie(stan, 'jan@f.pl');
    osoba.department = 'Kadry';
    osoba.position = 'Księgowy';

    await stan.serwis.applyMatrixImport(
      [{ email: 'jan@f.pl', level: 'USER', department: 'IT', position: 'Dev' }],
      actor,
    );

    const po = stan.osoby.find((o) => o.id === osoba.id)!;
    assert.equal(po.department, 'Kadry', 'katalog osób ma własny import — macierz go nie rusza');
    assert.equal(po.position, 'Księgowy');
  });

  it('wygasanie w przeszłości przy nowym grancie → skipped z EXPIRY_IN_PAST', async () => {
    const stan = zSerwisem();
    osobaWBazie(stan, 'jan@f.pl');

    const wynik = await stan.serwis.applyMatrixImport(
      [{ email: 'jan@f.pl', level: 'USER', expiresOn: '2020-01-01' }],
      actor,
      undefined,
      stan.aplikacje[0]!.id,
    );

    assert.equal(wynik.skipped, 1);
    assert.deepEqual(wynik.skippedRows[0]!.errors, ['EXPIRY_IN_PAST']);
    assert.equal(stan.granty.length, 0);
  });

  it('osoba nieaktywna → PERSON_INACTIVE, grant nie powstaje', async () => {
    const stan = zSerwisem();
    const osoba = osobaWBazie(stan, 'byly@f.pl');
    osoba.isActive = false;

    const wynik = await stan.serwis.applyMatrixImport(
      [{ email: 'byly@f.pl', level: 'USER' }],
      actor,
      undefined,
      stan.aplikacje[0]!.id,
    );

    assert.equal(wynik.skipped, 1);
    assert.deepEqual(wynik.skippedRows[0]!.errors, ['PERSON_INACTIVE']);
    assert.equal(stan.granty.length, 0);
  });

  it('nowa osoba bez imienia lub nazwiska → MISSING_NAME', async () => {
    const stan = zSerwisem();

    const wynik = await stan.serwis.applyMatrixImport(
      [{ email: 'nowa@f.pl', level: 'USER' }],
      actor,
      undefined,
      stan.aplikacje[0]!.id,
    );

    assert.equal(wynik.skipped, 1);
    assert.deepEqual(wynik.skippedRows[0]!.errors, ['MISSING_NAME']);
    assert.equal(stan.osoby.length, 0, 'odrzucony wiersz nie zostawia osoby po drodze');
  });

  it('tryb pojedynczy: wiersze bez applicationName trafiają do aplikacji z requestu', async () => {
    const stan = zSerwisem([aplikacja(), aplikacja({ name: 'Wiki' })]);
    const id = stan.aplikacje[0]!.id;
    osobaWBazie(stan, 'jan@f.pl');

    await stan.serwis.applyMatrixImport(
      [{ email: 'jan@f.pl', level: 'USER' }],
      actor,
      undefined,
      id,
    );

    assert.equal(stan.granty.length, 1);
    assert.equal(stan.granty[0]!.applicationId, id);
  });

  it('tryb pojedynczy: wiersz wskazujący inną aplikację → APP_MISMATCH', async () => {
    const stan = zSerwisem([aplikacja(), aplikacja({ name: 'Wiki' })]);
    const id = stan.aplikacje[0]!.id;

    const wynik = await stan.serwis.applyMatrixImport(
      [{ email: 'jan@f.pl', firstName: 'Jan', lastName: 'Kowalski', level: 'USER', applicationName: 'Wiki' }],
      actor,
      undefined,
      id,
    );

    assert.equal(wynik.skipped, 1);
    assert.deepEqual(wynik.skippedRows[0]!.errors, ['APP_MISMATCH']);
    assert.equal(stan.granty.length, 0);
  });

  it('pusty payload → 400, a nie „import 0 wierszy"', async () => {
    const stan = zSerwisem();
    await assert.rejects(() => stan.serwis.applyMatrixImport([], actor), BadRequestException);
  });

  it('payload ponad limit wierszy → 400', async () => {
    const stan = zSerwisem();
    const wiersze = Array.from({ length: MAX_MATRIX_ROWS + 1 }, (_, i) => ({
      email: `osoba${i}@f.pl`,
      firstName: 'Jan',
      lastName: 'Kowalski',
      level: 'USER',
    }));
    await assert.rejects(
      () => stan.serwis.applyMatrixImport(wiersze, actor),
      (blad: unknown) => blad instanceof BadRequestException && blad.message.includes(String(MAX_MATRIX_ROWS)),
    );
  });

  it('zapis zapisuje dokładnie jeden wpis audytowy access.imported z liczbami', async () => {
    const stan = zSerwisem();
    osobaWBazie(stan, 'tomasz@f.pl');

    await stan.serwis.applyMatrixImport(
      [
        { email: 'tomasz@f.pl', level: 'USER' },
        { email: 'zly@f.pl', firstName: 'Zły', lastName: 'Wiersz', level: 'Szef' },
      ],
      actor,
      '10.0.0.1',
      stan.aplikacje[0]!.id,
    );

    const wpisy = stan.audit.wpisy.filter((w) => w.action === 'access.imported');
    assert.equal(wpisy.length, 1, 'tysiąc wierszy nie może zasypać dziennika');
    assert.equal(wpisy[0]!.entity, 'ApplicationAccess');
    assert.equal(wpisy[0]!.changes?.createdGrants?.to, 1);
    assert.equal(wpisy[0]!.changes?.skipped?.to, 1);
  });
});
