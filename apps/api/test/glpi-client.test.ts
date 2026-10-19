/**
 * Klient HTTP GLPI — OAuth v2.3 dla użytkowników, oprogramowania
 * i grup; legacy API wyłącznie dla członkostw w grupach.
 *
 * Trzy pułapki odkryte na żywym serwerze (GLPI 11.0.9), których pilnują
 * testy poniżej:
 *
 *  1. **v2.3 paginuje parametrami `start`/`limit`** — `range` z legacy
 *     jest ignorowany (każde żądanie z `range` zwracało pierwszą stronę);
 *  2. **legacy paginuje parametrem `range`** — `start`/`limit` u niego
 *     nie działają; dlatego adres kolejnej strony buduje przekazana
 *     funkcja, nie wspólny szablon;
 *  3. **legacy `Group` nie zna pola `parent`** (ma tylko `groups_id`) —
 *     listę grup pobieramy z v2.3, a członków (`Group_User`) z legacy,
 *     bo tylko legacy wystawia członkostwa.
 *
 * Kontynuację paginacji wyznacza nagłówek `Content-Range`
 * (`start-koniec/total`): serwer może zwrócić mniej, niż proszono.
 *
 * Klient dostaje funkcję HTTP przez konstruktor, więc test prowadzi
 * fałszywą „sieć" i sprawdza prawdziwe żądania. Żaden test nie dotyka
 * prawdziwego GLPI.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { GlpiClient, GlpiBlad } from '../src/glpi/glpi-client';

/** Konfiguracja jak z zakładki ustawień — realne adresy z próby ręcznej. */
const KONFIG = {
  apiUrl: 'http://192.168.0.100/api.php',
  clientId: 'klient-abc',
  clientSecret: 'sekret-abc',
  login: 'techniczny',
  haslo: 'haslo-technicznego',
  legacyUrl: 'http://192.168.0.100/apirest.php',
  userToken: 'user-token-xyz',
  appToken: 'app-token-xyz',
};

type Odpowiedz = {
  status?: number;
  body: unknown;
  /** Nagłówek `Content-Range`, np. `0-99/317` — paginacja po nim idzie. */
  contentRange?: string;
};

/** Fałszywa sieć: mapa URL → odpowiedź; zapisuje żądania do inspekcji. */
function siec(responses: Record<string, Odpowiedz | Error>) {
  const zadania: Array<{ url: string; init?: RequestInit }> = [];
  const http = async (url: string, init?: RequestInit) => {
    zadania.push({ url, init });
    const odp = responses[url] ?? responses['*'];
    if (odp instanceof Error) throw odp;
    if (odp === undefined) {
      return {
        ok: false,
        status: 404,
        headers: { get: () => null },
        json: async () => ({}),
      };
    }
    const status = odp.status ?? 200;
    return {
      ok: status < 400,
      status,
      headers: { get: (n: string) => (n === 'Content-Range' ? odp.contentRange ?? null : null) },
      json: async () => odp.body,
    };
  };
  return { http, zadania };
}

const TOKEN_ODP = { access_token: 'jwt-token', expires_in: 3600, token_type: 'Bearer' };
const SESJA = { accessToken: 'jwt-token', expiresAt: Date.now() + 3600_000 };

describe('GlpiClient — OAuth (v2.3)', () => {
  it('pobiera token żądaniem POST z danymi grantu password', async () => {
    const { http, zadania } = siec({
      'http://192.168.0.100/api.php/token': { body: TOKEN_ODP },
    });
    const klient = new GlpiClient(http);

    const sesja = await klient.sesja(KONFIG);

    assert.equal(sesja.accessToken, 'jwt-token');
    assert.ok(sesja.expiresAt > Date.now(), 'wygaśnięcie liczone od teraz');
    const zadanie = zadania[0]!;
    assert.equal(zadanie.url, 'http://192.168.0.100/api.php/token');
    assert.equal(zadanie.init?.method, 'POST');
    const body = String(zadanie.init?.body);
    for (const fraza of [
      'grant_type=password',
      `client_id=${encodeURIComponent(KONFIG.clientId)}`,
      `username=${encodeURIComponent(KONFIG.login)}`,
      `scope=${encodeURIComponent('api')}`,
    ]) {
      assert.ok(body.includes(fraza), `body powinno zawierać ${fraza}`);
    }
  });

  it('odrzucone poświadczenia (400) dostają czytelny polski komunikat', async () => {
    const { http } = siec({
      'http://192.168.0.100/api.php/token': { status: 400, body: {} },
    });
    const klient = new GlpiClient(http);

    await assert.rejects(() => klient.sesja(KONFIG), (blad: unknown) => {
      assert.ok(blad instanceof GlpiBlad);
      assert.match((blad as Error).message, /GLPI odrzuc/);
      return true;
    });
  });

  it('brak sieci dostaje komunikat o braku połączenia, nie o błędzie programu', async () => {
    const { http } = siec({
      'http://192.168.0.100/api.php/token': new Error('ECONNREFUSED'),
    });
    const klient = new GlpiClient(http);

    await assert.rejects(() => klient.sesja(KONFIG), (blad: unknown) => {
      assert.ok(blad instanceof GlpiBlad);
      assert.match((blad as Error).message, /Nie można połączyć się z GLPI/);
      return true;
    });
  });

  it('legacy initSession na adresie nowego API: komunikat wskazuje literówkę, nie JSON', async () => {
    // Typowy błąd konfiguracji: w polu „Adres legacy API" siedzi `/api.php`
    // zamiast `/apirest.php` — nowe API widzi token osobisty, traktuje go
    // jak OAuth i odrzuca z dziwnym komunikatem o JWT.
    const { http } = siec({
      'http://192.168.0.100/api.php/token': { body: TOKEN_ODP },
      'http://192.168.0.100/api.php/v2.3/Administration/Group?start=0&limit=500': {
        body: [],
        contentRange: '*/0',
      },
      'http://192.168.0.100/apirest.php/initSession': {
        status: 400,
        body: {
          status: 'ERROR_INVALID_PARAMETER',
          title: 'Invalid OAuth token',
          detail: 'The JWT string must have two dots',
        },
      },
    });
    const klient = new GlpiClient(http);

    await assert.rejects(() => klient.pobierzGrupy(KONFIG), (blad: unknown) => {
      assert.ok(blad instanceof GlpiBlad);
      assert.match((blad as Error).message, /Adres legacy API/);
      // Komunikat pokazuje obie poprawne formy adresu legacy — na żywym
      // serwerze panel GLPI reklamuje /api.php/v1, dokumentacja /apirest.php.
      assert.match((blad as Error).message, /api\.php\/v1/);
      assert.match((blad as Error).message, /apirest\.php/);
      return true;
    });
  });
});

describe('GlpiClient — paginacja v2.3 (start/limit + Content-Range)', () => {
  function użytkownicy(n: number, od = 0) {
    return Array.from({ length: n }, (_, i) => ({
      id: od + i,
      username: `u${od + i}`,
      emails: [],
    }));
  }

  it('żądanie do 500 rekordów wchodzi w jedną stronę', async () => {
    const { http, zadania } = siec({
      'http://192.168.0.100/api.php/v2.3/Administration/User?start=0&limit=500': {
        body: użytkownicy(250),
        contentRange: '0-249/250',
      },
    });
    const klient = new GlpiClient(http);

    const uzytkownicy = await klient.pobierzUzytkownikow(KONFIG, SESJA);

    assert.equal(uzytkownicy.length, 250);
    assert.equal(zadania.length, 1);
    const naglowki = zadania[0]!.init?.headers as Record<string, string>;
    assert.equal(naglowki['Authorization'], 'Bearer jwt-token');
  });

  it('przy >500 idzie o tyle, ile faktycznie przyszło (Content-Range)', async () => {
    const { http, zadania } = siec({
      'http://192.168.0.100/api.php/v2.3/Administration/User?start=0&limit=500': {
        body: użytkownicy(500),
        contentRange: '0-499/600',
      },
      'http://192.168.0.100/api.php/v2.3/Administration/User?start=500&limit=500': {
        body: użytkownicy(100, 500),
        contentRange: '500-599/600',
      },
    });
    const klient = new GlpiClient(http);

    const uzytkownicy = await klient.pobierzUzytkownikow(KONFIG, SESJA);

    assert.equal(uzytkownicy.length, 600, 'dokładnie 600 — bez duplikatów i bez braków');
    assert.deepEqual(
      zadania.map((z) => z.url.split('?')[1]),
      ['start=0&limit=500', 'start=500&limit=500'],
      'następna strona startuje od liczby już pobranych',
    );
  });

  it('brak Content-Range: kończy na niedpełnej stronie', async () => {
    const { http, zadania } = siec({
      'http://192.168.0.100/api.php/v2.3/Administration/User?start=0&limit=500': {
        body: użytkownicy(30),
      },
    });
    const klient = new GlpiClient(http);

    const uzytkownicy = await klient.pobierzUzytkownikow(KONFIG, SESJA);

    assert.equal(uzytkownicy.length, 30);
    assert.equal(zadania.length, 1);
  });
});

describe('GlpiClient — oprogramowanie z wersjami', () => {
  it('dociąga wersje każdego oprogramowania osobnym żądaniem', async () => {
    const { http, zadania } = siec({
      'http://192.168.0.100/api.php/v2.3/Assets/Software?start=0&limit=500': {
        body: [
          { id: 1, name: 'LibreOffice' },
          { id: 2, name: 'Bastion' },
        ],
        contentRange: '0-1/2',
      },
      'http://192.168.0.100/api.php/v2.3/Assets/Software/1/Version?start=0&limit=500': {
        body: [{ id: 1, name: '7.6' }, { id: 2, name: '24.2' }],
        contentRange: '0-1/2',
      },
      'http://192.168.0.100/api.php/v2.3/Assets/Software/2/Version?start=0&limit=500': {
        body: [],
        contentRange: '*/0',
      },
    });
    const klient = new GlpiClient(http);

    const software = await klient.pobierzOprogramowanie(KONFIG, SESJA);

    assert.equal(software.length, 2);
    assert.deepEqual(software[0]!.versions.map((v) => v.name), ['7.6', '24.2']);
    assert.deepEqual(software[1]!.versions, []);
    assert.equal(zadania.length, 3, 'lista + po jednym żądaniu wersji na program');
  });
});

describe('GlpiClient — grupy (v2.3) i członkowie (legacy, range)', () => {
  it('grupy idą z v2.3 (z polem parent), członkowie z legacy przez range', async () => {
    const { http, zadania } = siec({
      'http://192.168.0.100/api.php/token': { body: TOKEN_ODP },
      'http://192.168.0.100/api.php/v2.3/Administration/Group?start=0&limit=500': {
        body: [
          { id: 1, name: 'Access', completename: 'Access', parent: null },
          {
            id: 2,
            name: 'VPN',
            completename: 'Access > VPN',
            parent: { id: 1, name: 'Access' },
          },
        ],
        contentRange: '0-1/2',
      },
      'http://192.168.0.100/apirest.php/initSession': { body: { session_token: 'sesja-123' } },
      'http://192.168.0.100/apirest.php/Group_User?range=0-499': {
        body: [{ users_id: 129, groups_id: 2 }],
        contentRange: '0-0/1',
      },
    });
    const klient = new GlpiClient(http);

    const dane = await klient.pobierzGrupy(KONFIG);

    // Grupy z v2.3 mają `parent` — mapper rozpoznaje dzieci grupy Access.
    assert.deepEqual(dane.grupy[1]!.parent, { id: 1, name: 'Access' });
    assert.equal(dane.czlonkowie.length, 1);

    const init = zadania.find((z) => z.url.includes('/initSession'))!;
    const naglowkiInit = init.init?.headers as Record<string, string>;
    assert.equal(naglowkiInit['Authorization'], `user_token ${KONFIG.userToken}`);
    assert.equal(naglowkiInit['App-Token'], KONFIG.appToken);
    const czlonkowie = zadania.find((z) => z.url.includes('/Group_User'))!;
    assert.match(czlonkowie.url, /range=0-499/, 'legacy paginuje parametrem range, nie start/limit');
    const naglowkiCzlonkow = czlonkowie.init?.headers as Record<string, string>;
    assert.equal(naglowkiCzlonkow['Session-Token'], 'sesja-123', 'dalsze żądania idą na sesję');
    assert.equal(naglowkiCzlonkow['App-Token'], KONFIG.appToken, 'app-token jest w każdym żądaniu');
  });
});
