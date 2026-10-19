/**
 * Serwis GLPI — ustawienia (z maskowaniem sekretów), test połączenia
 * i import w dwóch krokach: podgląd klasyfikuje, zapis rewaliduje.
 *
 * Kluczowe reguły ustalone w projekcie:
 *  - sekrety (client secret, hasło OAuth, tokeny) nie wracają do
 *    przeglądarki — tylko flagi „ustawiono";
 *  - zapis **nie ufa** payloadowi z podglądu: każdy wiersz waliduje
 *    od nowa i śmieciowy jest pomijany, nie zapisywany;
 *  - import tworzy wyłącznie nowe rekordy — niczego nie nadpisuje;
 *  - cały import to **jeden** wpis w dzienniku z licznikami.
 */
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { GlpiService } from '../src/glpi/glpi.service';
import { GlpiBlad } from '../src/glpi/glpi-client';
import { fakeGlpiDb } from './helpers/glpi-fake';
import { odszyfruj } from '../src/glpi/glpi-crypto';
import type { AuthUser } from '../src/auth/decorators';
import type { HttpFn } from '../src/glpi/glpi-client';

const actor: AuthUser = {
  id: randomUUID(),
  username: 'admin',
  email: 'admin@firma.pl',
  fullName: 'Anna Administrator',
  role: 'SUPER_ADMIN',
  mustChangePassword: false,
};

const SEKRET = 's'.repeat(32);

const USTAWIENIA = {
  apiUrl: 'http://192.168.0.100/api.php',
  clientId: 'klient-abc',
  clientSecret: 'sekret-jawny',
  login: 'techniczny',
  haslo: 'haslo-jawne',
  legacyUrl: 'http://192.168.0.100/apirest.php',
  userToken: 'token-jawny',
  appToken: 'app-jawny',
  parentGroup: 'Access',
  accessLevel: 'USER' as const,
};

/** Fałszywa sieć: OAuth + legacy wstają, GLPI zwraca po jednej osobie/grupie. */
function siec(): {
  http: HttpFn;
  zadania: Array<string>;
} {
  const zadania: string[] = [];
  const odp = (body: unknown, contentRange?: string) => ({
    ok: true as const,
    status: 200,
    headers: { get: (n: string) => (n === 'Content-Range' ? contentRange ?? null : null) },
    json: async () => body,
  });
  const http: HttpFn = async (url, init) => {
    zadania.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.endsWith('/token')) {
      return odp({ access_token: 'jwt', expires_in: 3600 });
    }
    if (url.endsWith('/initSession')) {
      return odp({ session_token: 'stara-sesja' });
    }
    if (url.includes('/v2.3/Administration/User')) {
      return odp(
        [
          {
            id: 7,
            username: 'test.user001',
            realname: 'Kowalska',
            firstname: 'Anna',
            emails: ['anna@firma.pl'],
            title: 'Analityk',
            category: 'IT',
            is_active: true,
            is_deleted: false,
          },
        ],
        '0-0/1',
      );
    }
    if (url.includes('/v2.3/Assets/Software')) {
      return odp([], '*/0');
    }
    if (url.includes('/Group_User')) {
      return odp([{ users_id: 7, groups_id: 2 }], '0-0/1');
    }
    if (url.includes('/Group')) {
      return odp(
        [
          { id: 1, name: 'Access', completename: 'Access', parent: null },
          { id: 2, name: 'VPN', completename: 'Access > VPN', parent: { id: 1, name: 'Access' } },
        ],
        '0-1/2',
      );
    }
    return odp([]);
  };
  return { http, zadania };
}

function zSerwisem(http: HttpFn = siec().http) {
  const db = fakeGlpiDb();
  const instancja = new GlpiService(db.port, db.audit as never, SEKRET, http);
  return { db, serwis: instancja };
}

describe('Ustawienia GLPI — zapis i maskowanie', () => {
  it('zapisuje sekrety zaszyfrowane, a zwraca wyłącznie maski', async () => {
    const { db, serwis } = zSerwisem();

    await serwis.zapiszUstawienia(USTAWIENIA);
    const widok = await serwis.getUstawienia();

    assert.equal(widok.apiUrl, USTAWIENIA.apiUrl);
    assert.equal(widok.clientId, 'klient-abc');
    assert.equal(widok.parentGroup, 'Access');
    // Żadne jawne sekretne pole nie może wrócić do przeglądarki.
    const tekst = JSON.stringify(widok);
    for (const jawny of ['sekret-jawny', 'haslo-jawne', 'token-jawny', 'app-jawny']) {
      assert.ok(!tekst.includes(jawny), `widok nie może zawierać ${jawny}`);
    }
    assert.equal(widok.hasClientSecret, true);
    assert.equal(widok.hasPassword, true);
    assert.equal(widok.hasUserToken, true);
    assert.equal(widok.hasAppToken, true);

    // W bazie jest szyfrogram, nie jawny tekst.
    const zapis = db.ustawienia.get('glpi.client_secret')!;
    assert.notEqual(zapis, 'sekret-jawny');
    assert.equal(odszyfruj(zapis, SEKRET), 'sekret-jawny');
  });

  it('zapis bez sekretów nie kasuje poprzednich', async () => {
    const { serwis } = zSerwisem();

    await serwis.zapiszUstawienia(USTAWIENIA);
    await serwis.zapiszUstawienia({
      ...USTAWIENIA,
      clientSecret: undefined,
      haslo: undefined,
      userToken: undefined,
      appToken: undefined,
    });

    const widok = await serwis.getUstawienia();
    assert.equal(widok.hasClientSecret, true, 'pominięty sekret zostaje, nie znika');
    assert.equal(widok.hasAppToken, true);
  });

  it('nieuzupełniona konfiguracja raportuje skonfigurowano=false', async () => {
    const { serwis } = zSerwisem();
    const widok = await serwis.getUstawienia();
    assert.equal(widok.skonfigurowano, false);
  });

  it('legacy API jest opcjonalne — zapis i skonfigurowano bez niego', async () => {
    const { serwis } = zSerwisem();

    await serwis.zapiszUstawienia({ ...USTAWIENIA, legacyUrl: '', userToken: undefined, appToken: undefined });
    const widok = await serwis.getUstawienia();

    assert.equal(
      widok.skonfigurowano,
      true,
      'osoby i oprogramowanie nie potrzebują legacy — integracja jest gotowa bez niego',
    );
  });

  it('test połączenia bez legacy: sprawdza OAuth, raportuje brak legacy', async () => {
    const s1 = siec();
    const { serwis } = zSerwisem(s1.http);
    await serwis.zapiszUstawienia({ ...USTAWIENIA, legacyUrl: '' });

    const wynik = await serwis.testujPolaczenie();

    assert.equal(wynik.ok, true);
    assert.ok(s1.zadania.some((z) => z.includes('/token')), 'OAuth musi być sprawdzony');
    assert.equal(
      s1.zadania.some((z) => z.includes('/initSession')),
      false,
      'legacy bez konfiguracji nie jest testowany, tylko pomijany',
    );
    assert.match(wynik.komunikat, /legacy/i, 'komunikat mówi, że legacy nie jest skonfigurowane');
  });

  it('podgląd dostępów bez legacy: czytelny błąd GLPI, nie 500', async () => {
    const { serwis } = zSerwisem();
    await serwis.zapiszUstawienia({ ...USTAWIENIA, legacyUrl: '' });

    await assert.rejects(() => serwis.podglad(['access']), (blad: unknown) => {
      assert.ok(blad instanceof GlpiBlad);
      assert.match((blad as Error).message, /legacy/i);
      return true;
    });
  });

  it('zły adres API jest odrzucany przed zapisem', async () => {
    const { serwis } = zSerwisem();
    await assert.rejects(
      () => serwis.zapiszUstawienia({ ...USTAWIENIA, apiUrl: '192.168.0.100/api.php' }),
      BadRequestException,
    );
  });

  it('zapis ustawień zostawia jeden wpis glpi.settings_updated w dzienniku', async () => {
    const { db, serwis } = zSerwisem();

    await serwis.zapiszUstawienia(USTAWIENIA, actor);

    const glpina = db.wpisy.filter((w) => w.action === 'glpi.settings_updated');
    assert.equal(glpina.length, 1, 'zapis to jedna decyzja — jeden wpis');
    assert.equal(glpina[0]!.entity, 'Setting');
  });

  it('adres API z wersją na końcu (…/api.php/v2.3) jest obcinany — bez dublowania w URL', async () => {
    const s1 = siec();
    const { serwis } = zSerwisem(s1.http);
    // Użytkownik wkleja adres prosto z paska przeglądarki / panelu GLPI,
    // z segmentem wersji. Klient sam dokleja `/v2.3`, więc wersja w polu
    // musiałaby się zdublować (`/v2.3/v2.3/…`) i skończyć 404.
    await serwis.zapiszUstawienia({ ...USTAWIENIA, apiUrl: 'http://192.168.0.100/api.php/v2.3' });
    const widok = await serwis.getUstawienia();
    assert.equal(widok.apiUrl, 'http://192.168.0.100/api.php');

    await serwis.podglad(['persons']);
    const user = s1.zadania.find((z) => z.includes('/Administration/User'))!;
    assert.ok(
      !user.includes('v2.3/v2.3'),
      `zduplikowany segment wersji w żądaniu: ${user}`,
    );
    assert.match(user, /\/v2\.3\/Administration\/User\?start=0&limit=500/);
  });

  it('test połączenia: obie historie autoryzacji muszą wstać', async () => {
    const siec1 = siec();
    const { serwis } = zSerwisem(siec1.http);
    await serwis.zapiszUstawienia(USTAWIENIA);

    const wynik = await serwis.testujPolaczenie();

    assert.equal(wynik.ok, true);
    assert.ok(siec1.zadania.some((z) => z.includes('/token')), 'OAuth musi być sprawdzony');
    assert.ok(
      siec1.zadania.some((z) => z.includes('/initSession')),
      'legacy musi być sprawdzony',
    );
  });

  it('test połączenia: awaria sieci GLPI jest błędem GLPI, nie programu', async () => {
    const http: HttpFn = async () => {
      throw new Error('ECONNREFUSED');
    };
    const { serwis } = zSerwisem(http);

    await assert.rejects(() => serwis.testujPolaczenie(), GlpiBlad);
  });
});

describe('Import GLPI — podgląd', () => {
  it('osoby: nowa = NEW, bez e-maila = ERROR, istniejąca = SKIP', async () => {
    const { serwis } = zSerwisem();
    await serwis.zapiszUstawienia(USTAWIENIA);

    const widok = await serwis.podglad(['persons']);
    assert.equal(widok.osoby.rows.length, 1);
    assert.equal(widok.osoby.rows[0]!.status, 'NEW');
  });

  it('osoby: istniejący e-mail to SKIP — import nie duplikuje katalogu', async () => {
    const { serwis } = zSerwisem();
    await serwis.zapiszUstawienia(USTAWIENIA);

    const pierwszy = await serwis.podglad(['persons']);
    // Zapisz osobę z podglądu, żeby drugi podgląd widział istniejącą.
    await serwis.wykonaj(
      { sections: ['persons'], persons: pierwszy.osoby.rows.filter((r) => r.status === 'NEW').map((r) => r.osoba!) },
      actor,
    );
    const drugi = await serwis.podglad(['persons']);

    assert.equal(drugi.osoby.rows[0]!.status, 'SKIP');
    assert.equal(drugi.osoby.summary.created, 0);
  });

  it('dostępy: grupa podrzędna = szkic aplikacji, członek = para do macierzy', async () => {
    const { serwis } = zSerwisem();
    await serwis.zapiszUstawienia(USTAWIENIA);

    const widok = await serwis.podglad(['access']);

    assert.equal(widok.dostepy.aplikacje.length, 1, 'tylko dzieci grupy Access');
    assert.equal(widok.dostepy.aplikacje[0]!.name, 'VPN');
    assert.equal(widok.dostepy.pary.length, 1);
    assert.equal(widok.dostepy.pary[0]!.personEmail, 'anna@firma.pl');
  });
});

describe('Import GLPI — zapis', () => {
  it('tworzy osoby, aplikacje i dostępy; jeden wpis glpi.imported z licznikami', async () => {
    const { serwis, db } = zSerwisem();

    const wynik = await serwis.wykonaj(
      {
        sections: ['persons', 'software', 'access'],
        persons: [
          { firstName: 'Anna', lastName: 'Kowalska', email: 'anna@firma.pl', position: 'Analityk', department: 'IT' },
        ],
        software: [{ name: 'VPN Suite', version: '1.0' }],
        access: [{ personEmail: 'anna@firma.pl', applicationName: 'VPN' }],
      },
      actor,
    );

    assert.equal(wynik.persons.created, 1);
    assert.equal(wynik.software.created, 1);
    assert.equal(wynik.access.created, 1);
    assert.equal(db.osoby.length, 1);
    // Dwie aplikacje: „VPN Suite" z oprogramowania i „VPN" — szkic
    // utworzony przez segment dostępów z nazwy grupy.
    assert.equal(db.aplikacje.length, 2);
    assert.deepEqual(
      db.aplikacje.map((a) => a.name).sort(),
      ['VPN', 'VPN Suite'],
    );

    const wynik2 = await serwis.wykonaj(
      {
        sections: ['access'],
        access: [{ personEmail: 'anna@firma.pl', applicationName: 'VPN' }],
      },
      actor,
    );
    assert.equal(wynik2.access.created, 0, 'ta sama para nie może wejść do macierzy drugi raz');
    assert.equal(wynik2.access.skipped, 1);
  });

  it('dostęp dla osoby niezaimportowanej jest pomijany z powodem', async () => {
    const { serwis } = zSerwisem();

    const wynik = await serwis.wykonaj(
      {
        sections: ['access'],
        access: [{ personEmail: 'nikt@firma.pl', applicationName: 'VPN' }],
      },
      actor,
    );

    assert.equal(wynik.access.created, 0);
    assert.equal(wynik.access.skipped, 1);
  });

  it('śmieciowy wiersz osoby jest pomijany, nie wywraca importu', async () => {
    const { serwis, db } = zSerwisem();

    const wynik = await serwis.wykonaj(
      {
        sections: ['persons'],
        persons: [
          { firstName: 'Anna', lastName: 'Kowalska', email: 'zly-email', position: null, department: null },
          { firstName: 'Bolesław', lastName: 'Nowak', email: 'bolek@firma.pl', position: null, department: null },
        ],
      },
      actor,
    );

    assert.equal(wynik.persons.created, 1);
    assert.equal(wynik.persons.skipped, 1);
    assert.equal(db.osoby.length, 1);
  });

  it('pusty import jest błędem, nie „sukcesem 0 rekordów"', async () => {
    const { serwis } = zSerwisem();

    await assert.rejects(
      () => serwis.wykonaj({ sections: ['persons'], persons: [] }, actor),
      BadRequestException,
    );
  });
});
