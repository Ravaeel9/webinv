/**
 * Klient HTTP GLPI.
 *
 * Dwie historie autoryzacji, bo GLPI 11 rozdziela je między dwa API:
 *
 *  - **v2.3** (`/api.php`) — OAuth2, grant password. Stąd użytkownicy
 *    i oprogramowanie. Token żyje godzinę; cache siedzi w serwisie,
 *    nie tu — klient jest bezstanowy i bez pamięci.
 *  - **legacy** (`/apirest.php`) — token osobisty + App-Token. Nowe API
 *    nie wystawia członkostw w grupach (sprawdzone na schemacie GraphQL:
 *    nie ma typu `Group_User`), a to jedyne, czego potrzebujemy z legacy.
 *
 * Klient dostaje funkcję HTTP przez konstruktor — test podaje fałszywą
 * sieć zamiast podnosić serwer. W produkcji wstrzykujemy `fetch`.
 */
import { GlpiBlad as Blad } from './glpi-blad';
export { GlpiBlad } from './glpi-blad';

/** Rozmiar strony — GLPI obsłuży `limit=500` jednym żądaniem. */
const ROZMIAR_STRONY = 500;

/** Twardy limity: błąd konfiguracji GLPI nie może zawiesić pętli paginacji. */
const MAX_STRON = { uzytkownicy: 40, oprogramowanie: 20, grupy: 10 } as const;

/** Minimalny interfejs HTTP, którego wymaga klient (wystarcza `fetch`). */
export type HttpFn = (
  url: string,
  init?: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json: () => Promise<unknown>;
}>;

/** Konfiguracja połączenia z zakładki „GLPI". Sekrety wchodzą już odszyfrowane. */
export type KonfiguracjaGlpi = {
  /** Baza nowego API, np. `http://192.168.0.100/api.php` — bez `/v2.3`. */
  apiUrl: string;
  clientId: string;
  clientSecret: string;
  login: string;
  haslo: string;
  /** Baza legacy API, np. `http://192.168.0.100/apirest.php`. */
  legacyUrl: string;
  userToken: string;
  appToken: string;
};

export type Sesja = { accessToken: string; expiresAt: number };

export type UzytkownikGlpi = {
  id: number;
  username: string;
  realname: string | null;
  firstname: string | null;
  emails: Array<string | { email: string }>;
  title: string | null;
  category: string | null;
  is_active: boolean;
  is_deleted: boolean;
};

export type OprogramowanieGlpi = {
  id: number;
  name: string;
  versions: Array<{ id: number; name: string }>;
};

export type GrupaGlpi = {
  id: number;
  name: string;
  completename: string;
  parent: { id: number; name: string } | null;
};

export type CzlonkostwoGlpi = { users_id: number; groups_id: number };

/**
 * Wywodzi kod przyczyny błędu sieci. Realny `fetch` Node'a rzuca
 * `TypeError: fetch failed`, a sens (odrzucone połączenie, nieznany
 * host, niezaufany certyfikat TLS) siedzi w `cause.code` — bez niego
 * panel nie pozwala odróżnić złego adresu od problemu z certyfikatem.
 */
function przyczynaSieciowa(blad: unknown): string {
  const przyczyna = (blad as { cause?: { code?: string; message?: string } } | null)?.cause;
  return przyczyna?.code ?? przyczyna?.message ?? (blad as Error | undefined)?.message ?? '';
}

/** Skleja odpowiedź JSON paginacji — albo rzuca czytelnym błędem GLPI. */
async function odpowiedz<T>(url: string, init: RequestInit, http: HttpFn): Promise<T> {
  let raw: Awaited<ReturnType<HttpFn>>;
  try {
    raw = await http(url, init);
  } catch (blad) {
    const kod = przyczynaSieciowa(blad);
    throw new Blad(
      `Nie można połączyć się z GLPI pod adresem ${url}` +
        (kod ? ` (${kod})` : '') +
        '. Sprawdź adres i sieć.',
    );
  }

  if (!raw.ok) {
    // Treść błędu GLPI bywa pouczająca (np. „scope"), więc trafia do konsoli.
    const tresc = await raw.json().catch(() => ({}));
    throw new Blad(
      `GLPI odrzuciło żądanie (${raw.status}) dla ${url}. ` +
        `Szczegóły: ${JSON.stringify(tresc)}`,
    );
  }

  return (await raw.json()) as T;
}

/** OAuth2 grant password — zwraca token dostępowy z terminem wygaśnięcia. */
async function pobierzToken(konfig: KonfiguracjaGlpi, http: HttpFn): Promise<Sesja> {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: konfig.clientId,
    client_secret: konfig.clientSecret,
    username: konfig.login,
    password: konfig.haslo,
    scope: 'api',
  });

  const odp = await odpowiedz<{ access_token?: string; expires_in?: number }>(
    `${konfig.apiUrl}/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
    http,
  );

  if (!odp.access_token) {
    throw new Blad('GLPI odrzuciło logowanie OAuth — sprawdź client_id, client_secret, login i hasło.');
  }

  return {
    accessToken: odp.access_token,
    // 90% rzeczywistego czasu — token nie może wygasnąć w trakcie importu.
    expiresAt: Date.now() + (odp.expires_in ?? 3600) * 900,
  };
}

/**
 * Pobiera kolekcję paginowaną, aż Content-Range pokaże koniec zbioru.
 *
 * Adres strony buduje `budujAdres(start, limit)` — bo **dwie historie
 * paginacji**: v2.3 przyjmuje `start`/`limit`, a legacy `range`
 * (potwierdzone na żywym serwerze; każde API ignoruje konwencję drugiego).
 * Kontynuację wyznacza nagłówek `Content-Range` (`start-koniec/total`):
 * serwer może zwrócić mniej, niż proszono, więc do następnej strony
 * idziemy o tyle, ile faktycznie przyszło. Bez nagłówka — zasada
 * niedpełnej strony.
 */
async function pobierzWszystko<T>(
  budujAdres: (start: number, limit: number) => string,
  naglowki: Record<string, string>,
  http: HttpFn,
  maxStron: number,
): Promise<T[]> {
  const wynik: T[] = [];
  for (let strona = 0; strona < maxStron; strona++) {
    const start = wynik.length;
    const adres = budujAdres(start, ROZMIAR_STRONY);
    const init = { headers: naglowki };
    const raw = await http(adres, init).catch((blad) => {
      const kod = przyczynaSieciowa(blad);
      throw new Blad(
        `Nie można połączyć się z GLPI pod adresem ${adres}` +
          (kod ? ` (${kod})` : '') +
          '. Sprawdź adres i sieć.',
      );
    });

    if (!raw.ok) {
      const tresc = await raw.json().catch(() => ({}));
      throw new Blad(
        `GLPI odrzuciło żądanie (${raw.status}) dla ${adres}. Szczegóły: ${JSON.stringify(tresc)}`,
      );
    }

    const czesc = (await raw.json()) as T[];
    if (!Array.isArray(czesc)) return wynik;
    wynik.push(...czesc);

    const contentRange = raw.headers.get('Content-Range');
    const total = contentRange?.match(/\/(\d+|\*)$/)?.[1];
    if (total && total !== '*') {
      if (wynik.length >= Number(total)) return wynik;
      continue;
    }
    if (czesc.length < ROZMIAR_STRONY) return wynik;
  }
  return wynik;
}

export class GlpiClient {
  constructor(private readonly http: HttpFn) {}

  /** Sesja OAuth — serwis cache'uje wynik do `expiresAt`. */
  async sesja(konfig: KonfiguracjaGlpi): Promise<Sesja> {
    return pobierzToken(konfig, this.http);
  }

  /** Użytkownicy GLPI — v2.3, strona po stronie. */
  async pobierzUzytkownikow(konfig: KonfiguracjaGlpi, sesja: Sesja): Promise<UzytkownikGlpi[]> {
    return pobierzWszystko<UzytkownikGlpi>(
      (start, limit) =>
        `${konfig.apiUrl}/v2.3/Administration/User?start=${start}&limit=${limit}`,
      { Authorization: `Bearer ${sesja.accessToken}` },
      this.http,
      MAX_STRON.uzytkownicy,
    );
  }

  /** Oprogramowanie z wersjami — każde program dociąga swoją listę wersji. */
  async pobierzOprogramowanie(
    konfig: KonfiguracjaGlpi,
    sesja: Sesja,
  ): Promise<OprogramowanieGlpi[]> {
    const naglowki = { Authorization: `Bearer ${sesja.accessToken}` };
    const lista = await pobierzWszystko<{ id: number; name: string }>(
      (start, limit) =>
        `${konfig.apiUrl}/v2.3/Assets/Software?start=${start}&limit=${limit}`,
      naglowki,
      this.http,
      MAX_STRON.oprogramowanie,
    );

    const zWersjami: OprogramowanieGlpi[] = [];
    for (const wpis of lista) {
      const wersje = await pobierzWszystko<{ id: number; name: string }>(
        (start, limit) =>
          `${konfig.apiUrl}/v2.3/Assets/Software/${wpis.id}/Version?start=${start}&limit=${limit}`,
        naglowki,
        this.http,
        MAX_STRON.grupy,
      );
      zWersjami.push({ id: wpis.id, name: wpis.name, versions: wersje });
    }
    return zWersjami;
  }

  /**
   * Grupy z **v2.3** (ma `parent` i `completename` — mapper rozpoznaje
   * po nim dzieci grupy nadrzędnej), członkostwa z **legacy** (tylko
   * tam istnieje `Group_User`). Dwa tokeny, bo dwa API.
   */
  async pobierzGrupy(konfig: KonfiguracjaGlpi): Promise<{ grupy: GrupaGlpi[]; czlonkowie: CzlonkostwoGlpi[] }> {
    // Grupy — v2.3 na tokenie OAuth.
    const sesja = await this.sesja(konfig);
    const grupy = await pobierzWszystko<GrupaGlpi>(
      (start, limit) =>
        `${konfig.apiUrl}/v2.3/Administration/Group?start=${start}&limit=${limit}`,
      { Authorization: `Bearer ${sesja.accessToken}` },
      this.http,
      MAX_STRON.grupy,
    );

    // Członkostwa — legacy na tokenie osobistym. `App-Token` musi być
    // w **każdym** żądaniu, nie tylko w inicjalizacji.
    let sesjaLegacy: { session_token?: string };
    try {
      sesjaLegacy = await odpowiedz<{ session_token?: string }>(
        `${konfig.legacyUrl}/initSession`,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `user_token ${konfig.userToken}`,
            'App-Token': konfig.appToken,
          },
        },
        this.http,
      );
    } catch (blad) {
      // Typowa literówka: legacy adres wskazuje na nowe API (`/api.php`),
      // które widzi token osobisty, traktuje go jak OAuth i odpowiada
      // zagadkowym błędem o JWT. Tłumaczymy to na wprost.
      if (blad instanceof Blad && blad.message.includes('JWT string must have two dots')) {
        throw new Blad(
          'Adres legacy API wskazuje na nowe API GLPI (/api.php) zamiast na legacy. ' +
            'Popraw pole „Adres legacy API" — powinno kończyć się na /api.php/v1 albo /apirest.php.',
        );
      }
      throw blad;
    }

    if (!sesjaLegacy.session_token) {
      throw new Blad(
        'GLPI odrzuciło token osobisty dla legacy API — sprawdź token i App-Token.',
      );
    }

    const czlonkowie = await pobierzWszystko<CzlonkostwoGlpi>(
      (start, limit) =>
        `${konfig.legacyUrl}/Group_User?range=${start}-${start + limit - 1}`,
      {
        'Session-Token': sesjaLegacy.session_token,
        'App-Token': konfig.appToken,
      },
      this.http,
      MAX_STRON.uzytkownicy,
    );

    return { grupy, czlonkowie };
  }
}
