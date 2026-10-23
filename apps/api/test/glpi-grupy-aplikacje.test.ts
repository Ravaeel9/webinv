/**
 * Import „Dostępy (grupy)” tworzy też oprogramowanie.
 *
 * Dotąd import dostępów działał tylko, gdy aplikacja o nazwie grupy
 * była już w rejestrze: podgląd odsyłał parę jako `SKIP APP_BRAK_W_REJESTRZE`,
 * a modal przesyłał do zapisu wyłącznie wiersze NEW — więc draft
 * aplikacji tworzony przez serwis nigdy nie miał szans wejść do gry.
 * Efekt: najpierw import oprogramowania, potem grupy, i to tylko
 * przy zgodnych nazwach.
 *
 * Po zmianie:
 *  - **para z brakującą aplikacją jest NEW** — zapis utworzy szkic
 *    aplikacji z nazwy grupy i nada dostęp;
 *  - **payload dostaw ma wiersze `applications`** (grupa → szkic),
 *    tworzone nawet dla grup bez członków — katalog jest kompletny;
 *  - typ dostarczenia wybiera administrator w modalu (globalny +
 *    nadpisanie per wiersz), wartość spoza enumu wraca do GENERAL_USE;
 *  - licznik `applications` idzie osobno (obok persons/software/access)
 *    — do wyniku i do jednego wpisu `glpi.imported`.
 */
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { GlpiService } from '../src/glpi/glpi.service';
import { fakeGlpiDb } from './helpers/glpi-fake';
import type { AuthUser } from '../src/auth/decorators';
import type { HttpFn } from '../src/glpi/glpi-client';
import { read } from './helpers/repo';

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

/**
 * Dwie podrzędne grupy nadrzędnej „Access": „VPN" z członkiem
 * i „Kadry" bez nikogo. Oprogramowania w GLPI brak — to sekcja
 * „Dostępy" ma sama utworzyć szkice aplikacji.
 */
function siec(): { http: HttpFn } {
  const odp = (body: unknown, contentRange?: string) => ({
    ok: true as const,
    status: 200,
    headers: { get: (n: string) => (n === 'Content-Range' ? contentRange ?? null : null) },
    json: async () => body,
  });
  const http: HttpFn = async (url) => {
    if (url.endsWith('/token')) return odp({ access_token: 'jwt', expires_in: 3600 });
    if (url.endsWith('/initSession')) return odp({ session_token: 'stara-sesja' });
    if (url.includes('/v2.3/Administration/User')) {
      return odp(
        [
          {
            id: 7,
            username: 'test.user001',
            realname: 'Kowalska',
            firstname: 'Anna',
            emails: ['anna@firma.pl'],
            is_active: true,
            is_deleted: false,
          },
        ],
        '0-0/1',
      );
    }
    if (url.includes('/v2.3/Assets/Software')) return odp([], '*/0');
    if (url.includes('/Group_User')) {
      return odp([{ users_id: 7, groups_id: 2 }], '0-0/1');
    }
    if (url.includes('/Group')) {
      return odp(
        [
          { id: 1, name: 'Access', completename: 'Access', parent: null },
          { id: 2, name: 'VPN', completename: 'Access > VPN', parent: { id: 1, name: 'Access' } },
          { id: 3, name: 'Kadry', completename: 'Access > Kadry', parent: { id: 1, name: 'Access' } },
        ],
        '0-2/3',
      );
    }
    return odp([]);
  };
  return { http };
}

function zSerwisem() {
  const { http } = siec();
  const db = fakeGlpiDb();
  const serwis = new GlpiService(db.port, db.audit as never, SEKRET, http);
  return { db, serwis };
}

/** Osoba z GLPI jest już w katalogu web-inv — granty mają na co wskazać. */
function wKatalogu(db: ReturnType<typeof fakeGlpiDb>) {
  db.osoby.push({ id: randomUUID(), email: 'anna@firma.pl' });
}

describe('Podgląd — para przy braku aplikacji', () => {
  it('para jest NEW, nie SKIP APP_BRAK_W_REJESTRZE', async () => {
    const { serwis, db } = zSerwisem();
    await serwis.zapiszUstawienia(USTAWIENIA);
    wKatalogu(db);

    const widok = await serwis.podglad(['access']);

    assert.equal(widok.dostepy.pary[0]!.status, 'NEW');
    assert.equal(
      widok.dostepy.pary[0]!.reason,
      null,
      'brak aplikacji przestaje być powodem pominięcia — zapis ją utworzy',
    );
  });

  it('grupy podrzędne to szkice aplikacji — także grupa bez członków', async () => {
    const { serwis } = zSerwisem();
    await serwis.zapiszUstawienia(USTAWIENIA);

    const widok = await serwis.podglad(['access']);

    assert.deepEqual(
      widok.dostepy.aplikacje.map((a) => a.name),
      ['VPN', 'Kadry'],
      'obie grupy podrzędne, także ta bez członków',
    );
    assert.equal(widok.dostepy.aplikacje.every((a) => a.status === 'NEW'), true);
  });
});

describe('Zapis — aplikacje z grup', () => {
  it('tworzy szkice aplikacji (deliveryType z wiersza) i granty dla członków', async () => {
    const { serwis, db } = zSerwisem();
    await serwis.zapiszUstawienia(USTAWIENIA);
    wKatalogu(db);

    const wynik = await serwis.wykonaj(
      {
        sections: ['access'],
        applications: [{ name: 'VPN', deliveryType: 'SAAS' }, { name: 'Kadry' }],
        access: [{ personEmail: 'anna@firma.pl', applicationName: 'VPN', deliveryType: 'SAAS' }],
      },
      actor,
    );

    assert.equal(wynik.applications.created, 2, 'VPN i Kadry');
    assert.equal(wynik.access.created, 1);
    assert.deepEqual(db.aplikacje.map((a) => a.name).sort(), ['Kadry', 'VPN']);
    const vpn = db.aplikacje.find((a) => a.name === 'VPN')!;
    assert.equal(vpn.deliveryType, 'SAAS', 'typ dostarczenia z wiersza payloadu');
    const kadry = db.aplikacje.find((a) => a.name === 'Kadry')!;
    assert.equal(kadry.deliveryType, 'GENERAL_USE', 'brak typu = domyślne');
    assert.equal(db.granty.length, 1);
    assert.equal(db.granty[0]!.level, 'USER');
  });

  it('aplikacja z grupy powstaje nawet bez żadnej pary do zapisania', async () => {
    const { serwis, db } = zSerwisem();
    await serwis.zapiszUstawienia(USTAWIENIA);

    const wynik = await serwis.wykonaj(
      { sections: ['access'], applications: [{ name: 'Kadry' }] },
      actor,
    );

    assert.equal(wynik.applications.created, 1);
    assert.equal(wynik.access.created, 0);
    assert.equal(db.aplikacje.length, 1);
  });

  it('import, w którym powstaną tylko aplikacje z grup, nie jest „pusty"', async () => {
    const { serwis } = zSerwisem();
    await serwis.zapiszUstawienia(USTAWIENIA);

    const wynik = await serwis.wykonaj(
      { sections: ['access'], applications: [{ name: 'Kadry' }] },
      actor,
    );
    void wynik;
    // Brak rzutu BadRequestException to sukces testu.
  });

  it('grupa już istniejąca w rejestrze jest pomijana — import nie nadpisuje', async () => {
    const { serwis, db } = zSerwisem();
    await serwis.zapiszUstawienia(USTAWIENIA);

    const wynik = await serwis.wykonaj(
      {
        sections: ['access'],
        applications: [{ name: 'VPN', deliveryType: 'SAAS' }, { name: 'VPN', deliveryType: 'SAAS' }],
      },
      actor,
    );

    assert.equal(wynik.applications.created, 1);
    assert.equal(wynik.applications.skipped, 1, 'drugi wiersz z tą samą nazwą — duplikat w payloadzie');
    assert.equal(db.aplikacje.length, 1);
  });

  it('aplikacja z sekcji oprogramowania nie powstaje drugi raz w sekcji dostępów', async () => {
    const { serwis, db } = zSerwisem();
    await serwis.zapiszUstawienia(USTAWIENIA);
    wKatalogu(db);

    const wynik = await serwis.wykonaj(
      {
        sections: ['software', 'access'],
        software: [{ name: 'VPN', version: '1.0' }],
        applications: [{ name: 'VPN', deliveryType: 'SAAS' }],
        access: [{ personEmail: 'anna@firma.pl', applicationName: 'VPN', deliveryType: 'SAAS' }],
      },
      actor,
    );

    assert.equal(db.aplikacje.length, 1, 'jedna nazwa — jeden wiersz aplikacji');
    assert.equal(wynik.software.created, 1);
    assert.equal(wynik.applications.created, 0, 'istniejąca aplikacja jest pomijana');
    assert.equal(wynik.applications.skipped, 1);
    assert.equal(wynik.access.created, 1, 'para wskazuje na istniejącą aplikację');
  });

  it('niezaufany typ dostarczenia wraca do GENERAL_USE, śmieciowa nazwa jest pomijana', async () => {
    const { serwis, db } = zSerwisem();
    await serwis.zapiszUstawienia(USTAWIENIA);

    const wynik = await serwis.wykonaj(
      {
        sections: ['access'],
        applications: [
          { name: '', deliveryType: 'SAAS' },
          { name: 'VPN', deliveryType: 'CHMURA_OBCA' },
        ],
      } as never,
      actor,
    );

    assert.equal(wynik.applications.created, 1);
    assert.equal(wynik.applications.skipped, 1, 'pusta nazwa nie tworzy aplikacji');
    assert.equal(db.aplikacje[0]!.deliveryType, 'GENERAL_USE');
  });

  it('para z brakującą aplikacją tworzy szkic z typem z wiersza pary', async () => {
    const { serwis, db } = zSerwisem();
    await serwis.zapiszUstawienia(USTAWIENIA);
    wKatalogu(db);

    await serwis.wykonaj(
      {
        sections: ['access'],
        access: [{ personEmail: 'anna@firma.pl', applicationName: 'VPN', deliveryType: 'SELF_HOSTED' }],
      },
      actor,
    );

    assert.equal(db.aplikacje.length, 1);
    assert.equal(db.aplikacje[0]!.deliveryType, 'SELF_HOSTED');
  });

  it('audyt glpi.imported raportuje licznik applications', async () => {
    const { serwis, db } = zSerwisem();
    await serwis.zapiszUstawienia(USTAWIENIA);

    await serwis.wykonaj(
      { sections: ['access'], applications: [{ name: 'Kadry' }], access: [] },
      actor,
    );

    const wpis = db.wpisy.find((w) => w.action === 'glpi.imported')!;
    assert.ok(wpis, 'import zostawia jeden wpis glpi.imported');
    assert.deepEqual(wpis.changes?.applications, {
      from: null,
      to: { created: 1, skipped: 0 },
    });
  });
});

describe('Nazwa zajęta przez usuniętą aplikację', () => {
  /**
   * `Application.name` jest unikalne globalnie (Citext) — także po
   * miękko usuniętych wierszach. Import, który szuka tylko żywych
   * (`deletedAt: null`) i tworzy nowy wiersz, kończy 500 (P2002):
   * tak właśnie zwariował import grup, gdy w rejestrze została
   * usunięta aplikacja o nazwie grupy.
   *
   * Reguła: usunięta aplikacja z tą nazwą to **pominięty wiersz
   * z czytelnym powodem** — import niczego nie przywraca i nie
   * nadpisuje (taka sama rada, jaką daje ręczne tworzenie: „przywróć
   * albo zmień nazwę"), a podgląd pokazuje to zanim się kliknie zapis.
   */
  function zUsunietym() {
    const { db, serwis } = zSerwisem();
    db.aplikacje.push({
      id: randomUUID(),
      name: 'VPN',
      deletedAt: new Date('2026-10-01'),
      deliveryType: 'GENERAL_USE',
    });
    wKatalogu(db);
    return { db, serwis };
  }

  it('podgląd: grupa z usuniętą aplikacją to SKIP z powodem APP_USUNIETA', async () => {
    const { serwis } = zUsunietym();
    await serwis.zapiszUstawienia(USTAWIENIA);

    const widok = await serwis.podglad(['access']);

    const vpn = widok.dostepy.aplikacje.find((a) => a.name === 'VPN')!;
    assert.equal(vpn.status, 'SKIP');
    assert.equal(vpn.reason, 'APP_USUNIETA');
  });

  it('podgląd: para z usuniętą aplikacją to SKIP, nie NEW', async () => {
    const { serwis } = zUsunietym();
    await serwis.zapiszUstawienia(USTAWIENIA);

    const widok = await serwis.podglad(['access']);

    const para = widok.dostepy.pary[0]!;
    assert.equal(para.status, 'SKIP');
    assert.equal(para.reason, 'APP_USUNIETA');
  });

  it('zapis: applications z usuniętą nazwą jest pomijany — bez 500 i bez duplikatu', async () => {
    const { serwis, db } = zUsunietym();
    await serwis.zapiszUstawienia(USTAWIENIA);

    const wynik = await serwis.wykonaj(
      { sections: ['access'], applications: [{ name: 'VPN', deliveryType: 'SAAS' }] },
      actor,
    );

    assert.equal(wynik.applications.created, 0);
    assert.equal(wynik.applications.skipped, 1);
    assert.equal(db.aplikacje.length, 1, 'usunięta aplikacja zostaje — bez duplikatu');
  });

  it('zapis: para z usuniętą aplikacją jest pomijana, grant nie powstaje', async () => {
    const { serwis, db } = zUsunietym();
    await serwis.zapiszUstawienia(USTAWIENIA);

    const wynik = await serwis.wykonaj(
      {
        sections: ['access'],
        applications: [{ name: 'VPN' }],
        access: [{ personEmail: 'anna@firma.pl', applicationName: 'VPN', deliveryType: 'SAAS' }],
      },
      actor,
    );

    assert.equal(wynik.access.created, 0);
    assert.equal(wynik.access.skipped, 1);
    assert.equal(db.granty.length, 0, 'usunięta aplikacja nie może dostać grantu');
    assert.equal(db.aplikacje.length, 1);
  });

  it('zapis: oprogramowanie o nazwie usuniętej aplikacji jest pomijane — sekcja software', async () => {
    const { serwis, db } = zUsunietym();
    await serwis.zapiszUstawienia(USTAWIENIA);

    const wynik = await serwis.wykonaj(
      { sections: ['software'], software: [{ name: 'VPN', version: '2.0' }] },
      actor,
    );

    assert.equal(wynik.software.created, 0);
    assert.equal(wynik.software.skipped, 1);
    assert.equal(db.aplikacje.length, 1);
  });
});

describe('Warstwa interfejsu — aplikacje z grup', () => {
  const modal = read('apps', 'web', 'src', 'components', 'glpi', 'GlpiImportModal.tsx');
  const typy = read('apps', 'web', 'src', 'types-glpi.ts');

  it('modal przesyła wiersze applications z typem per wiersz', () => {
    assert.ok(
      /applications:\s*podglad\.dostepy\.aplikacje/.test(modal),
      'payload zapisu musi zawierać applications z podglądu dostępów',
    );
    assert.ok(
      /applications:\s*podglad\.dostepy\.aplikacje[\s\S]*?deliveryType:\s*typWiersza/.test(modal),
      'wiersze applications mają typ dostarczenia z wyboru w modalu',
    );
  });

  it('pary dostępów przesyłają typ dostarczenia aplikacji', () => {
    assert.ok(
      /access:\s*podglad\.dostepy\.pary[\s\S]*?deliveryType/.test(modal),
      'pary NEW idą do zapisu z typem aplikacji z grupy',
    );
  });

  it('typy payloadu i wyniku znają applications i typ w parze', () => {
    assert.ok(
      /applications\?:\s*Array</.test(typy),
      'GlpiImportPayload musi mieć pole applications',
    );
    assert.ok(
      /applications:\s*\{ created: number; skipped: number \}/.test(typy),
      'wynik importu raportuje licznik applications',
    );
    assert.ok(
      /access\?:\s*Array<\{\s*personEmail: string;\s*applicationName: string;\s*deliveryType\?: DeliveryType\s*\}>/.test(typy),
      'wiersz dostępu w payloadzie może nieść typ dostarczenia aplikacji',
    );
  });

  it('podgląd tłumaczy powód APP_USUNIETA po polsku', () => {
    assert.ok(
      /APP_USUNIETA:\s*'/u.test(typy),
      'GLPI_POWODY musi znać APP_USUNIETA — inaczej podgląd pokazuje surowy klucz',
    );
  });
});
