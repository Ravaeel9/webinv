/**
 * Blokada 24 h dla weryfikacji dostępów.
 *
 * Weryfikacja aplikacji (i całej macierzy) ma być dowodem przeglądu,
 * a nie przyciskiem do nadpisywania znaczników bez rozmowy z właścicielem.
 * Bez blokady ktoś mógłby „odświeżyć" datę weryfikacji o poranku i o
 * popołudniu — a dwie weryfikacje tego samego dostępu w jednym dniu nie
 * dowodzą dwóch przeglądów.
 *
 * Punkty, na których blokada zależałaby od interpretacji:
 *
 *  - **Punkt odniesienia to `createdAt`** (moment zapisu), nie `verifiedOn`
 *    (deklarowana data przeglądu) — cofnięcie daty w formularzu nie omija
 *    limitu.
 *  - **MATRIX obejmuje aplikacje**, więc wpis całej macierzy blokuje
 *    weryfikację aplikacji; odwrotnie nie — weryfikacja jednej aplikacji
 *    nie zwalnia z przeglądu reszty.
 *  - **GRANT nie bierze udziału**: weryfikacja pojedynczego wiersza jest
 *    drobną korektą, nie przeglądem — ani nie blokuje, ani nie jest
 *    blokowana.
 */
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { AccessService } from '../src/access/access.service';
import { fakeAudit, fakeDb } from './helpers/access-fake';
import type { AccessVerificationRow, VerificationScopeName } from '../src/access/access.port';
import type { AuthUser } from '../src/auth/decorators';

const actor: AuthUser = {
  id: randomUUID(),
  username: 'admin',
  email: 'admin@firma.pl',
  fullName: 'Anna Administrator',
  role: 'ADMIN',
  mustChangePassword: false,
};

function baza() {
  const aplikacja = { id: randomUUID(), name: 'System kadrowy', deletedAt: null };
  const { port, granty, weryfikacje } = fakeDb([aplikacja]);
  const serwis = new AccessService(port, fakeAudit() as never);
  return { port, granty, weryfikacje, serwis, aplikacja };
}

/** Wpis weryfikacji wstawiony wprost do atrapy — z kontrolowanym createdAt. */
function wpis(
  weryfikacje: AccessVerificationRow[],
  scope: VerificationScopeName,
  createdAt: Date,
  applicationId: string | null = null,
): void {
  weryfikacje.push({
    id: randomUUID(),
    scope,
    verifiedOn: new Date('2026-10-25T00:00:00Z'),
    note: null,
    applicationId,
    personId: null,
    personName: null,
    actorId: actor.id,
    actorName: actor.fullName,
    createdAt,
  });
}

/** Czas wpisu „przed chwilą" — wewnątrz okna 24 h. */
function przedChwila(): Date {
  return new Date(Date.now() - 60 * 1000);
}

/** Granica okna: wpis dokładnie z momentu przekroczenia 24 h do przodu. */
function czasNastepnej(created: Date): string {
  return new Date(created.getTime() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ');
}

describe('AccessService — blokada 24 h na weryfikacje', () => {
  it('weryfikacja aplikacji drugi raz w ciągu 24 h jest odrzucana', async () => {
    const { serwis, weryfikacje, aplikacja } = baza();

    await serwis.createVerification(
      { scope: 'APPLICATION', applicationId: aplikacja.id },
      actor,
    );
    assert.equal(weryfikacje.length, 1, 'pierwszy wpis przeszedł');

    await assert.rejects(
      () => serwis.createVerification({ scope: 'APPLICATION', applicationId: aplikacja.id }, actor),
      ConflictException,
    );
    assert.equal(weryfikacje.length, 1, 'odrzucony wpis nie zostaje w rejestrze');
  });

  it('weryfikacja całej macierzy zamyka aplikacje na 24 h', async () => {
    const { serwis, weryfikacje, aplikacja } = baza();
    wpis(weryfikacje, 'MATRIX', przedChwila());

    await assert.rejects(
      () => serwis.createVerification({ scope: 'APPLICATION', applicationId: aplikacja.id }, actor),
      ConflictException,
      'macierz obejmuje tę aplikację',
    );
  });

  it('wpis GRANT ani nie blokuje weryfikacji aplikacji, ani nie jest blokowany', async () => {
    const { serwis, weryfikacje, aplikacja } = baza();
    wpis(weryfikacje, 'GRANT', przedChwila(), aplikacja.id);

    // Weryfikacja aplikacji po drobnym wpisie — dopuszczalna.
    await serwis.createVerification({ scope: 'APPLICATION', applicationId: aplikacja.id }, actor);

    // Weryfikacja grantu po wpisach APPLICATION i MATRIX — bez blokady.
    wpis(weryfikacje, 'APPLICATION', przedChwila(), aplikacja.id);
    wpis(weryfikacje, 'MATRIX', przedChwila());
    await serwis.grantAccess(aplikacja.id, { email: 'a@firma.pl', firstName: 'A', lastName: 'X' }, actor);
    const grant = weryfikacje.length; // licznik tylko do porównania po zapisie
    await serwis.createVerification(
      { scope: 'GRANT', applicationId: aplikacja.id, personId: (await serwis.listApplicationAccess(aplikacja.id))[0]!.personId },
      actor,
    );
    assert.equal(weryfikacje.length, grant + 1, 'wpis GRANT przeszedł mimo wpisów APPLICATION i MATRIX');
  });

  it('weryfikacja macierzy po weryfikacji jednej aplikacji jest dopuszczalna', async () => {
    const { serwis, weryfikacje, aplikacja } = baza();
    wpis(weryfikacje, 'APPLICATION', przedChwila(), aplikacja.id);

    await serwis.createVerification({ scope: 'MATRIX' }, actor);
    assert.equal(weryfikacje.length, 2, 'przegląd jednej aplikacji nie zwalnia z przeglądu reszty');
  });

  it('weryfikacja macierzy drugi raz w ciągu 24 h jest odrzucana', async () => {
    const { serwis, weryfikacje } = baza();
    wpis(weryfikacje, 'MATRIX', przedChwila());

    await assert.rejects(
      () => serwis.createVerification({ scope: 'MATRIX' }, actor),
      ConflictException,
    );
  });

  it('wpis starszy niż 24 h nie blokuje', async () => {
    const { serwis, weryfikacje, aplikacja } = baza();
    // createdAt 25 h temu — poza oknem blokady.
    wpis(weryfikacje, 'APPLICATION', new Date(Date.now() - 25 * 60 * 60 * 1000), aplikacja.id);
    wpis(weryfikacje, 'MATRIX', new Date(Date.now() - 30 * 60 * 60 * 1000));

    await serwis.createVerification({ scope: 'APPLICATION', applicationId: aplikacja.id }, actor);
    await serwis.createVerification({ scope: 'MATRIX' }, actor);
    assert.equal(weryfikacje.length, 4);
  });

  it('komunikat blokady podaje godzinę następnej możliwej weryfikacji', async () => {
    const { serwis, weryfikacje, aplikacja } = baza();
    const created = przedChwila();
    wpis(weryfikacje, 'APPLICATION', created, aplikacja.id);

    await assert.rejects(
      () => serwis.createVerification({ scope: 'APPLICATION', applicationId: aplikacja.id }, actor),
      (blad: unknown) => {
        assert.ok(blad instanceof ConflictException);
        const komunikat = (blad as Error).message;
        assert.ok(
          komunikat.includes(czasNastepnej(created)),
          `komunikat ma wskazywać czas odblokowania (${czasNastepnej(created)}): ${komunikat}`,
        );
        return true;
      },
    );
  });

  it('odrzucony zapis nie stampuje grantów', async () => {
    const { serwis, weryfikacje, aplikacja, granty } = baza();
    await serwis.grantAccess(aplikacja.id, { email: 'a@firma.pl', firstName: 'A', lastName: 'X' }, actor);
    await serwis.createVerification({ scope: 'APPLICATION', applicationId: aplikacja.id }, actor);

    await assert.rejects(
      () => serwis.createVerification({ scope: 'APPLICATION', applicationId: aplikacja.id }, actor),
      ConflictException,
    );
    assert.ok(
      granty.every((g) => g.verifiedOn !== null && g.verifiedOn.getTime() === weryfikacje[0]!.verifiedOn.getTime()),
      'stamp z pierwszego wpisu zostaje nietknięty przez odrzucone powtórzenie',
    );
  });
});
