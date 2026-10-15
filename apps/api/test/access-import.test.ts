/**
 * Import osób z CSV — dwugłosowość podglądu i zapisu.
 *
 * Podgląd pokazuje administratorowi, co zostanie zapisane, i to jest jego
 * ostatnia szansa na poprawkę pliku. Zapis dlatego **nie ufa** temu, co
 * przyszło z podglądu:
 *
 *  - **Dane mogą być zmienione między krokami.** Podgląd i zapis rozdziela
 *    przerwa w pracy, a payload z przeglądarki mógł w międzyczasie zostać
 *    podmieniony. Dlatego każdy wiersz jest walidowany od nowa i
 *    niesprawdzalny wiersz jest pomijany, a nie zapisywany.
 *  - **Katalog to jedno źródło tożsamości.** Istniejący e-mail jest
 *    aktualizowany, nie duplikowany — inaczej jedna osoba wjechałaby
 *    do katalogu po każdym imporcie.
 *  - **Brak w pliku niczego nie znaczy.** Plik z jednej aplikacji nie może
 *    wyłączać osób, które mają dostęp do innych.
 */
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { AccessService } from '../src/access/access.service';
import { CsvError, MAX_PERSON_ROWS } from '../src/access/csv';
import { fakeAudit, fakeDb } from './helpers/access-fake';
import type { AuthUser } from '../src/auth/decorators';

const actor: AuthUser = {
  id: randomUUID(),
  username: 'admin',
  email: 'admin@firma.pl',
  fullName: 'Anna Administrator',
  role: 'ADMIN',
  mustChangePassword: false,
};

function zSerwisem() {
  const db = fakeDb([{ id: randomUUID(), name: 'System kadrowy', deletedAt: null }]);
  const audit = fakeAudit();
  return { ...db, audit, serwis: new AccessService(db.port, audit as never) };
}

const CSV = [
  'Email,First name,Last name,Department,Job title',
  'anna.zalewska@firma.pl,Anna,Zalewska,IT,Analityk',
  'bolek.nowak@firma.pl,Bolesław,Nowak,Księgowość,Księgowy',
].join('\n');

describe('Import osób — podgląd', () => {
  it('nową osobę oznacza jako NEW, istniejącą jako UPDATE z jej identyfikatorem', async () => {
    const { serwis, audit } = zSerwisem();
    const istniejaca = await serwis.createPerson(
      { firstName: 'Anna', lastName: 'Zalewska', email: 'anna.zalewska@firma.pl' },
      actor,
    );
    audit.wpisypierwszyReset();

    const podglad = await serwis.previewPersonsImport(CSV);

    assert.equal(podglad.summary.total, 2);
    assert.equal(podglad.rows[0]!.status, 'UPDATE');
    assert.equal(podglad.rows[0]!.existingPersonId, istniejaca.id);
    assert.equal(podglad.rows[1]!.status, 'NEW');
    assert.equal(podglad.rows[1]!.existingPersonId, null);
    // Podgląd czyta, nie zapisuje — żaden wpis w dzienniku.
    assert.equal(audit.wpisy.length, 0);
  });

  it('wiersze z błędami nie są zapisywane i mają powód', async () => {
    const { serwis } = zSerwisem();
    const podglad = await serwis.previewPersonsImport(
      'Email,First name,Last name\n,Jan,Kowalski\na@f.pl,,Nowak\n',
    );

    assert.deepEqual(podglad.summary, { total: 2, create: 0, update: 0, invalid: 2 });
    assert.deepEqual(podglad.rows[0]!.status, 'ERROR');
    assert.deepEqual(podglad.rows[0]!.errors, ['MISSING_EMAIL']);
  });

  it('zgłasza nieznane kolumny, żeby administrator mógł je przypisać ręcznie', async () => {
    const { serwis } = zSerwisem();
    const podglad = await serwis.previewPersonsImport(
      'Email,Imię,Nazwisko,Kod kosztu\na@f.pl,Jan,Kowalski,1234\n',
    );

    assert.deepEqual(podglad.unmapped, ['Kod kosztu']);
  });

  it('plik za duży lub za długi jest odrzucany z czytelnym powodem', async () => {
    const { serwis } = zSerwisem();
    const zaDlugi = `Email,First name,Last name\n${Array.from(
      { length: MAX_PERSON_ROWS + 1 },
      (_, i) => `osoba${i}@firma.pl,Jan,Kowalski`,
    ).join('\n')}`;

    await assert.rejects(
      () => serwis.previewPersonsImport(zaDlugi),
      (blad: unknown) =>
        blad instanceof BadRequestException && blad.message.includes(String(MAX_PERSON_ROWS)),
    );
  });

  it('błąd parsera trafia do administratora jako czytelny komunikat', async () => {
    const { serwis } = zSerwisem();
    await assert.rejects(
      () => serwis.previewPersonsImport('Imię,Nazwisko\nJan,Kowalski\n'),
      BadRequestException,
    );
  });
});

describe('Import osób — zapis', () => {
  it('tworzy nowe osoby i aktualizuje istniejące', async () => {
    const { serwis, osoby } = zSerwisem();
    await serwis.createPerson(
      { firstName: 'Anna', lastName: 'Zalewska', email: 'anna.zalewska@firma.pl', position: 'Stażystka' },
      actor,
    );

    const wynik = await serwis.applyPersonsImport(
      [
        { email: 'anna.zalewska@firma.pl', firstName: 'Anna', lastName: 'Zalewska', department: 'IT' },
        { email: 'bolek.nowak@firma.pl', firstName: 'Bolesław', lastName: 'Nowak' },
      ],
      actor,
    );

    assert.deepEqual(wynik, { created: 1, updated: 1, skipped: 0 });
    assert.equal(osoby.length, 2, 'ta sama osoba nie może wejść do katalogu drugi raz');
    assert.equal(osoby[0]!.department, 'IT');
    assert.equal(osoby[0]!.position, 'Stażystka', 'puste pole w pliku nie kasuje danych z katalogu');
  });

  it('nie dezaktywuje osób, których nie ma w pliku', async () => {
    const { serwis, osoby } = zSerwisem();
    await serwis.createPerson(
      { firstName: 'Ewa', lastName: 'Nowak', email: 'e.nowak@firma.pl' },
      actor,
    );

    await serwis.applyPersonsImport(
      [{ email: 'anna.zalewska@firma.pl', firstName: 'Anna', lastName: 'Zalewska' }],
      actor,
    );

    assert.equal(osoby.find((o) => o.email === 'e.nowak@firma.pl')!.isActive, true);
  });

  it('zawieszenie w pliku wyłącza osobę w katalogu', async () => {
    const { serwis, osoby } = zSerwisem();
    await serwis.createPerson(
      { firstName: 'Anna', lastName: 'Zalewska', email: 'anna.zalewska@firma.pl' },
      actor,
    );

    await serwis.applyPersonsImport(
      [{ email: 'anna.zalewska@firma.pl', firstName: 'Anna', lastName: 'Zalewska', isActive: false }],
      actor,
    );

    assert.equal(osoby[0]!.isActive, false);
  });

  it('wiersz z błędem jest pomijany, a nie wywraca całego importu', async () => {
    const { serwis, osoby } = zSerwisem();

    const wynik = await serwis.applyPersonsImport(
      [
        { email: 'nie-e-mail', firstName: 'Anna', lastName: 'Zalewska' },
        { email: 'anna.zalewska@firma.pl', firstName: 'Anna', lastName: 'Zalewska' },
      ],
      actor,
    );

    assert.deepEqual(wynik, { created: 1, updated: 0, skipped: 1 });
    assert.equal(osoby.length, 1);
  });

  it('pusty payload jest błędem, a nie „importem 0 osób"', async () => {
    const { serwis } = zSerwisem();
    await assert.rejects(() => serwis.applyPersonsImport([], actor), BadRequestException);
  });

  it('import zapisuje dokładnie jeden wpis person.imported', async () => {
    const { serwis, audit } = zSerwisem();
    audit.wpisypierwszyReset();

    await serwis.applyPersonsImport(
      [
        { email: 'anna.zalewska@firma.pl', firstName: 'Anna', lastName: 'Zalewska' },
        { email: 'nie-e-mail', firstName: 'X', lastName: 'Y' },
      ],
      actor,
    );

    const wpisy = audit.wpisy.filter((w) => w.action === 'person.imported');
    assert.equal(wpisy.length, 1, 'tysiąc pojedynczych wpisów na import nie służy nikomu');
    assert.equal(wpisy[0]!.changes?.created?.to, 1);
    assert.equal(wpisy[0]!.changes?.skipped?.to, 1);
  });
});

/** Błąd parsera jest błędem wejścia — nie musi być eksportowany poza moduł. */
void CsvError;