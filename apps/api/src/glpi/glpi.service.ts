/**
 * Serwis integracji z GLPI.
 *
 * Ustawienia trzymamy w tabeli `settings` (wzorzec `SettingsService`):
 * klucz `glpi.*` na pole. Sekrety **nie leżą jawnie** — szyfruje je
 * `glpi-crypto` kluczem z `SESSION_SECRET` — i **nie wracają do
 * przeglądarki**: GET pokazuje flagi `has*`, a zapis przyjmuje
 * `undefined` jako „nie ruszaj" (pominięcie pola nie kasuje sekretu).
 *
 * Import jest dwugłosowy, jak importy CSV/nmap:
 *
 *  - **podgląd** pobiera dane z GLPI i klasyfikuje: NEW / SKIP / ERROR.
 *    Nic nie zapisuje — można klikać w kółko;
 *  - **zapis** nie ufa payloadowi z przeglądarki: każdy wiersz jest
 *    walidowany od nowa, śmieciowy jest pomijany i liczony. Tworzy
 *    **wyłącznie nowe** rekordy — nigdy niczego nie nadpisuje.
 *
 * Kolejność zapisu nie jest przypadkowa: osoby → oprogramowanie →
 * dostępy. Dostęp wskazuje osobę i aplikację, więc obie muszą istnieć
 * wcześniej (albo już w bazie, albo z tego samego importu).
 */
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import {
  GlpiClient,
  GlpiBlad,
  type Sesja,
  type HttpFn,
  type KonfiguracjaGlpi,
} from './glpi-client';
import {
  grupyDostepu,
  mapujOsobe,
  mapujOprogramowanie,
  type GlpiGrupa,
} from './glpi-mapper';
import { odszyfruj, szyfruj } from './glpi-crypto';
import type { AuthUser } from '../auth/decorators';
import { GLPI_PORT, type GlpiPort } from './glpi.port';

/** Sekcje importu — checkboxy w podglądzie. */
export type Sekcja = 'persons' | 'software' | 'access';
export const SEKCJE: Sekcja[] = ['persons', 'software', 'access'];

/** Limit wierszy na sekcję — błędna konfiguracja GLPI nie może zawiesić importu. */
const MAX_WIERSZY = 5000;

/** Klucze w tabeli `settings`. */
const KLUCZE = {
  apiUrl: 'glpi.api_url',
  clientId: 'glpi.client_id',
  clientSecret: 'glpi.client_secret',
  login: 'glpi.login',
  password: 'glpi.password',
  legacyUrl: 'glpi.legacy_url',
  userToken: 'glpi.user_token',
  appToken: 'glpi.app_token',
  parentGroup: 'glpi.parent_group',
  accessLevel: 'glpi.access_level',
} as const;

/** Widok ustawień dla przeglądarki — bez sekretów, z flagami ich obecności. */
export type UstawieniaWidok = {
  apiUrl: string;
  clientId: string;
  login: string;
  legacyUrl: string;
  parentGroup: string;
  accessLevel: 'OWNER' | 'ADMIN' | 'USER' | 'READ_ONLY';
  hasClientSecret: boolean;
  hasPassword: boolean;
  hasUserToken: boolean;
  hasAppToken: boolean;
  skonfigurowano: boolean;
};

/** Dane do zapisu — sekrety opcjonalne: brak pola znaczy „zostaw". */
export type UstawieniaWejscie = {
  apiUrl: string;
  clientId: string;
  clientSecret?: string;
  login: string;
  haslo?: string;
  legacyUrl: string;
  userToken?: string;
  appToken?: string;
  parentGroup: string;
  accessLevel: 'OWNER' | 'ADMIN' | 'USER' | 'READ_ONLY';
};

/** Wiersz osoby z payloadu zapisu (dane z podglądu). */
export type WierszOsoby = {
  firstName: string;
  lastName: string;
  email: string;
  position: string | null;
  department: string | null;
};

/** Wiersz oprogramowania z payloadu zapisu. */
export type WierszOprogramowania = { name: string; version: string };

/** Wiersz dostępu z payloadu zapisu — para e-mail × nazwa aplikacji. */
export type WierszDostepu = { personEmail: string; applicationName: string };

export type PayloadZapisu = {
  sections: Sekcja[];
  persons?: WierszOsoby[];
  software?: WierszOprogramowania[];
  access?: WierszDostepu[];
};

export type Licznik = { created: number; skipped: number };

export type PodgladImportu = {
  osoby: {
    rows: Array<{
      status: 'NEW' | 'SKIP' | 'ERROR';
      glpiId: number;
      osoba: WierszOsoby | null;
      reason: string | null;
    }>;
    summary: { created: number; skipped: number; errors: number };
  };
  oprogramowanie: {
    rows: Array<{
      status: 'NEW' | 'SKIP' | 'ERROR';
      glpiId: number;
      name: string;
      version: string;
      reason: string | null;
    }>;
    summary: { created: number; skipped: number; errors: number };
  };
  dostepy: {
    aplikacje: Array<{
      status: 'NEW' | 'SKIP';
      glpiId: number;
      name: string;
      reason: string | null;
    }>;
    pary: Array<{
      status: 'NEW' | 'SKIP' | 'ERROR';
      personEmail: string;
      applicationName: string;
      reason: string | null;
    }>;
    summary: { created: number; skipped: number; errors: number };
  };
};

const POZIOMY = ['OWNER', 'ADMIN', 'USER', 'READ_ONLY'] as const;
type Poziom = (typeof POZIOMY)[number];

/** Tokeny wstrzykiwania — moduł rejestruje je obok `PrismaService`. */
export const SEKRET_SESJI = 'GLPI_SEKRET_SESJI';
export const HTTP_GLPI = 'GLPI_HTTP';

function urlHttp(adres: string, pole: string): string {
  const przyciete = adres.trim();
  if (!/^https?:\/\//.test(przyciete)) {
    throw new BadRequestException(`${pole} musi zaczynać się od http:// albo https://.`);
  }
  if (przyciete.length > 500) {
    throw new BadRequestException(`${pole} jest zbyt długie (limit 500 znaków).`);
  }
  return przyciete.replace(/\/+$/, '');
}

/**
 * Obcina segment wersji z adresu nowego API (`/v2`, `/v2.3` — jak wypadnie
 * z paska przeglądarki albo panelu GLPI). Klient sam dokleja wersję
 * do każdej ścieżki, więc wersja w adresie bazowym zdublowałaby się
 * w żądaniu (`/v2.3/v2.3/…`) i kończyła 404.
 */
function adresBazowyApi(adres: string): string {
  return adres.trim().replace(/\/+$/, '').replace(/\/v\d+(?:\.\d+)*$/, '');
}

function tekst(adres: string, pole: string, limit: number, wymagane: boolean): string {
  const przyciete = (adres ?? '').trim();
  if (!przyciete) {
    if (wymagane) throw new BadRequestException(`Pole ${pole} jest wymagane.`);
    return '';
  }
  if (przyciete.length > limit) {
    throw new BadRequestException(`Pole ${pole} przekracza ${limit} znaków.`);
  }
  return przyciete;
}

const WZOR_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class GlpiService {
  private readonly klient: GlpiClient;

  constructor(
    // Port przez token (`GLPI_PORT` → `PrismaService`), nie przez typ:
    // `GlpiPort` to interfejs, którego Nest nie widzi w metadanych
    // konstruktora — bez tokenu wstrzykiwanie padło na żywym starcie.
    @Inject(GLPI_PORT) private readonly prisma: GlpiPort,
    private readonly audit: AuditService,
    @Inject(SEKRET_SESJI) private readonly sekretSesji: string,
    @Inject(HTTP_GLPI) private readonly http: HttpFn = fetch as unknown as HttpFn,
  ) {
    // Klient w ciele konstruktora, nie w inicjalizatorze pola: inicjalizatory
    // pól lecą przed przypisaniem właściwości parametrycznych, więc
    // `this.http` byłby tu jeszcze `undefined`.
    this.klient = new GlpiClient(this.http);
  }

  // ─── Ustawienia ─────────────────────────────────────────────

  private async odczytajKlucz(klucz: string): Promise<string | null> {
    const wpis = await this.prisma.setting.findUnique({ where: { key: klucz } });
    return wpis?.value ?? null;
  }

  private async odczytajSekret(klucz: string): Promise<string | null> {
    const wartosc = await this.odczytajKlucz(klucz);
    if (!wartosc) return null;
    try {
      return odszyfruj(wartosc, this.sekretSesji);
    } catch {
      // Zmieniony SESSION_SECRET po restorze bazy — czytelny błąd zamiast
      // śmieci w polu hasła przy pierwszym imporcie.
      throw new GlpiBlad(
        'Nie można odszyfrować poświadczeń GLPI. Wpisz je ponownie w ustawieniach integracji.',
      );
    }
  }

  async getUstawienia(): Promise<UstawieniaWidok> {
    const [
      apiUrl,
      clientId,
      login,
      legacyUrl,
      parentGroup,
      accessLevel,
      hasClientSecret,
      hasPassword,
      hasUserToken,
      hasAppToken,
    ] = await Promise.all([
      this.odczytajKlucz(KLUCZE.apiUrl),
      this.odczytajKlucz(KLUCZE.clientId),
      this.odczytajKlucz(KLUCZE.login),
      this.odczytajKlucz(KLUCZE.legacyUrl),
      this.odczytajKlucz(KLUCZE.parentGroup),
      this.odczytajKlucz(KLUCZE.accessLevel),
      this.odczytajKlucz(KLUCZE.clientSecret).then((v) => v !== null),
      this.odczytajKlucz(KLUCZE.password).then((v) => v !== null),
      this.odczytajKlucz(KLUCZE.userToken).then((v) => v !== null),
      this.odczytajKlucz(KLUCZE.appToken).then((v) => v !== null),
    ]);

    const pelne = Boolean(apiUrl && clientId && login && hasClientSecret && hasPassword);

    return {
      apiUrl: adresBazowyApi(apiUrl ?? ''),
      clientId: clientId ?? '',
      login: login ?? '',
      legacyUrl: legacyUrl ?? '',
      parentGroup: parentGroup ?? 'Access',
      accessLevel: (POZIOMY as readonly string[]).includes(accessLevel ?? '')
        ? (accessLevel as Poziom)
        : 'USER',
      hasClientSecret,
      hasPassword,
      hasUserToken,
      hasAppToken,
      // Legacy (adres, tokeny) jest opcjonalne — potrzebne wyłącznie
      // do importu dostępów z grup, więc nie blokuje „skonfigurowano".
      skonfigurowano: pelne,
    };
  }

  async zapiszUstawienia(
    dane: UstawieniaWejscie,
    actor?: AuthUser,
    ip?: string,
  ): Promise<UstawieniaWidok> {
    const zapisy: Array<[string, string]> = [
      [KLUCZE.apiUrl, urlHttp(adresBazowyApi(dane.apiUrl), 'Adres API GLPI')],
      [KLUCZE.clientId, tekst(dane.clientId, 'Client ID', 200, true)],
      [KLUCZE.login, tekst(dane.login, 'Login OAuth', 200, true)],
      [KLUCZE.legacyUrl, tekst(dane.legacyUrl, 'Adres legacy API', 500, false)],
      [KLUCZE.parentGroup, tekst(dane.parentGroup, 'Grupa nadrzędna', 100, true)],
      [
        KLUCZE.accessLevel,
        POZIOMY.includes(dane.accessLevel)
          ? dane.accessLevel
          : (() => {
              throw new BadRequestException('Nieznany poziom dostępu.');
            })(),
      ],
    ];

    if (dane.clientSecret) {
      zapisy.push([KLUCZE.clientSecret, szyfruj(dane.clientSecret.trim(), this.sekretSesji)]);
    }
    if (dane.haslo) {
      zapisy.push([KLUCZE.password, szyfruj(dane.haslo, this.sekretSesji)]);
    }
    if (dane.userToken) {
      zapisy.push([KLUCZE.userToken, szyfruj(dane.userToken.trim(), this.sekretSesji)]);
    }
    if (dane.appToken) {
      zapisy.push([KLUCZE.appToken, szyfruj(dane.appToken.trim(), this.sekretSesji)]);
    }

    for (const [key, value] of zapisy) {
      await this.prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
    }

    // Jedna decyzja administratora — jeden wpis w dzienniku.
    await this.audit.record({
      action: 'glpi.settings_updated',
      entity: 'Setting',
      entityId: null,
      actorId: actor?.id ?? null,
      actorName: actor?.username ?? null,
      changes: null,
      ip,
    });

    return this.getUstawienia();
  }

  /** Konfiguracja dla klienta HTTP — sekrety odszyfrowane na potrzeby wywołania. */
  private async konfiguracja() {
    const [
      apiUrl,
      clientId,
      clientSecret,
      login,
      haslo,
      legacyUrl,
      userToken,
      appToken,
      parentGroup,
      accessLevel,
    ] = await Promise.all([
      this.odczytajKlucz(KLUCZE.apiUrl),
      this.odczytajKlucz(KLUCZE.clientId),
      this.odczytajSekret(KLUCZE.clientSecret),
      this.odczytajKlucz(KLUCZE.login),
      this.odczytajSekret(KLUCZE.password),
      this.odczytajKlucz(KLUCZE.legacyUrl),
      this.odczytajSekret(KLUCZE.userToken),
      this.odczytajSekret(KLUCZE.appToken),
      this.odczytajKlucz(KLUCZE.parentGroup),
      this.odczytajKlucz(KLUCZE.accessLevel),
    ]);

    if (!apiUrl || !clientId || !login || !clientSecret || !haslo) {
      throw new GlpiBlad(
        'Integracja GLPI nie jest skonfigurowana. Uzupełnij dane połączenia w ustawieniach.',
      );
    }

    return {
      klient: {
        // Wersja bywa już w zapisanym adresie (wartość sprzed normalizacji
        // albo wpis ręczny w bazie) — obcinamy, zanim klient doklei swoją.
        apiUrl: adresBazowyApi(apiUrl),
        clientId,
        clientSecret,
        login,
        haslo,
        // Legacy jest opcjonalny (tylko import dostępów) — kompletność
        // sprawdzamy dopiero tam, z czytelnym komunikatem.
        legacyUrl: legacyUrl ?? '',
        userToken: userToken ?? '',
        appToken: appToken ?? '',
      },
      parentGroup: parentGroup ?? 'Access',
      accessLevel: (POZIOMY as readonly string[]).includes(accessLevel ?? '')
        ? (accessLevel as Poziom)
        : ('USER' as Poziom),
    };
  }

  /** Czy legacy jest w pełni skonfigurowane (adres + oba tokeny). */
  private skonfigurowanyLegacy(konfig: KonfiguracjaGlpi): boolean {
    return Boolean(konfig.legacyUrl && konfig.userToken && konfig.appToken);
  }

  /**
   * Sprawdza połączenie: zawsze OAuth v2.3, legacy — tylko gdy skonfigurowane.
   * Komunikat mówi wprost, co zostało sprawdzone, żeby administrator wiedział,
   * dlaczego import dostępów może być jeszcze niedostępny.
   */
  async testujPolaczenie(): Promise<{ ok: true; komunikat: string }> {
    const { klient } = await this.konfiguracja();

    if (!this.skonfigurowanyLegacy(klient)) {
      await this.klient.sesja(klient);
      return {
        ok: true,
        komunikat:
          'Połączenie z GLPI działa (OAuth). Legacy API nie jest skonfigurowane — ' +
          'import dostępów z grup będzie niedostępny.',
      };
    }

    // Dwa tokeny naraz — podgląd dostępu bez legacy miałby niespodziewany
    // błąd dopiero przy imporcie, a test ma to wykluczyć z góry.
    await Promise.all([
      this.klient.sesja(klient),
      this.klient.pobierzGrupy(klient),
    ]);

    return { ok: true, komunikat: 'Połączenie z GLPI działa (OAuth i legacy API).' };
  }

  // ─── Import: podgląd ────────────────────────────────────────

  private sesjaCache: Sesja | null = null;

  private async sesja(apiKonfig: KonfiguracjaGlpi): Promise<Sesja> {
    if (this.sesjaCache && this.sesjaCache.expiresAt > Date.now()) {
      return this.sesjaCache;
    }
    this.sesjaCache = await this.klient.sesja(apiKonfig);
    return this.sesjaCache;
  }

  /**
   * Pobiera dane z GLPI i klasyfikuje wiersze. Nic nie zapisuje.
   * Wynik jest migawką — zapis dostanie osobny payload i sam wszystko
   * zrewaliduje (między krokami dane GLPI mogą się zmienić).
   */
  async podglad(sections: Sekcja[]): Promise<PodgladImportu> {
    if (!Array.isArray(sections) || sections.length === 0) {
      throw new BadRequestException('Wybierz co najmniej jedną sekcję importu.');
    }

    const { klient: apiKonfig, parentGroup } = await this.konfiguracja();
    const sesja = await this.sesja(apiKonfig);

    const pusty: PodgladImportu = {
      osoby: { rows: [], summary: { created: 0, skipped: 0, errors: 0 } },
      oprogramowanie: { rows: [], summary: { created: 0, skipped: 0, errors: 0 } },
      dostepy: { aplikacje: [], pary: [], summary: { created: 0, skipped: 0, errors: 0 } },
    };

    if (sections.includes('persons')) {
      pusty.osoby = await this.podgladOsob(apiKonfig, sesja);
    }
    if (sections.includes('software')) {
      pusty.oprogramowanie = await this.podgladOprogramowania(apiKonfig, sesja);
    }
    if (sections.includes('access')) {
      // Import dostępów idzie przez legacy API — bez niego mówimy wprost,
      // zamiast pozwalać żądaniu paść na 401 z GLPI.
      if (!this.skonfigurowanyLegacy(apiKonfig)) {
        throw new GlpiBlad(
          'Import dostępów wymaga skonfigurowanego legacy API (adres, token osobisty i App-Token) w ustawieniach integracji.',
        );
      }
      pusty.dostepy = await this.podgladDostepow(apiKonfig, sesja, parentGroup);
    }

    return pusty;
  }

  private async podgladOsob(
    apiKonfig: KonfiguracjaGlpi,
    sesja: Sesja,
  ): Promise<PodgladImportu['osoby']> {
    const uzytkownicy = await this.klient.pobierzUzytkownikow(apiKonfig, sesja);

    const rows: PodgladImportu['osoby']['rows'] = [];
    for (const user of uzytkownicy) {
      if (user.is_deleted) {
        rows.push({ status: 'SKIP', glpiId: user.id, osoba: null, reason: 'KONTO_USUNIETE' });
        continue;
      }
      const { osoba, blad } = mapujOsobe(user);
      if (blad || !osoba) {
        rows.push({ status: 'ERROR', glpiId: user.id, osoba: null, reason: blad ?? 'MISSING_EMAIL' });
        continue;
      }
      const istniejaca = await this.prisma.person.findFirst({ where: { email: osoba.email } });
      rows.push(
        istniejaca
          ? { status: 'SKIP', glpiId: user.id, osoba, reason: 'ISTNIEJE' }
          : { status: 'NEW', glpiId: user.id, osoba, reason: null },
      );
    }

    return {
      rows,
      summary: {
        created: rows.filter((r) => r.status === 'NEW').length,
        skipped: rows.filter((r) => r.status === 'SKIP').length,
        errors: rows.filter((r) => r.status === 'ERROR').length,
      },
    };
  }

  private async podgladOprogramowania(
    apiKonfig: KonfiguracjaGlpi,
    sesja: Sesja,
  ): Promise<PodgladImportu['oprogramowanie']> {
    const software = await this.klient.pobierzOprogramowanie(apiKonfig, sesja);

    const rows: PodgladImportu['oprogramowanie']['rows'] = [];
    for (const wpis of software) {
      let szkic: { name: string; version: string; description: null };
      try {
        szkic = mapujOprogramowanie(wpis);
      } catch {
        rows.push({ status: 'ERROR', glpiId: wpis.id, name: '', version: '', reason: 'MISSING_NAME' });
        continue;
      }
      const istniejaca = await this.prisma.application.findFirst({
        where: { name: szkic.name, deletedAt: null },
      });
      rows.push(
        istniejaca
          ? { status: 'SKIP', glpiId: wpis.id, name: szkic.name, version: szkic.version, reason: 'ISTNIEJE' }
          : { status: 'NEW', glpiId: wpis.id, name: szkic.name, version: szkic.version, reason: null },
      );
    }

    return {
      rows,
      summary: {
        created: rows.filter((r) => r.status === 'NEW').length,
        skipped: rows.filter((r) => r.status === 'SKIP').length,
        errors: rows.filter((r) => r.status === 'ERROR').length,
      },
    };
  }

  private async podgladDostepow(
    apiKonfig: KonfiguracjaGlpi,
    sesja: Sesja,
    parentGroup: string,
  ): Promise<PodgladImportu['dostepy']> {
    const { grupy, czlonkowie } = await this.klient.pobierzGrupy(apiKonfig);
    const dzieci = grupyDostepu(grupy as GlpiGrupa[], parentGroup);

    // Grupa podrzędna = aplikacja. Nazwy grup są jednocześnie nazwami
    // rekordów `Application` — bez mapowania ręcznego, bo GLPI nie ma
    // tu nic więcej do zaoferowania.
    const aplikacje: PodgladImportu['dostepy']['aplikacje'] = [];
    for (const grupa of dzieci) {
      const istniejaca = await this.prisma.application.findFirst({
        where: { name: grupa.name, deletedAt: null },
      });
      aplikacje.push(
        istniejaca
          ? { status: 'SKIP', glpiId: grupa.id, name: grupa.name, reason: 'ISTNIEJE' }
          : { status: 'NEW', glpiId: grupa.id, name: grupa.name, reason: null },
      );
    }

    // users_id → e-mail: z użytkowników GLPI. Pobieramy ich **zawsze**,
    // nawet gdy sekcja „Osoby" jest odznaczona — bez mapy users_id→e-mail
    // para dostępu nie miałaby z czym wskazać osoby, a przecież osoba
    // może już istnieć w katalogu web-inv.
    const uzytkownicy = await this.klient.pobierzUzytkownikow(apiKonfig, sesja);
    const emailPoGlpiId = new Map<number, string | null>();
    for (const user of uzytkownicy) {
      const email = user.emails
        .map((e) => (typeof e === 'string' ? e : e.email))
        .find((e) => e && e.trim() !== '');
      emailPoGlpiId.set(user.id, email ?? null);
    }

    const grupaNaAplikacje = Object.fromEntries(dzieci.map((g) => [g.id, g.name]));
    const wierszePar: PodgladImportu['dostepy']['pary'] = [];
    for (const czlonek of czlonkowie) {
      const aplikacja = grupaNaAplikacje[czlonek.groups_id];
      if (!aplikacja) continue; // grupa spoza zakresu — nie nasz wiersz

      const email = emailPoGlpiId.get(czlonek.users_id);
      if (!email) {
        wierszePar.push({
          status: 'SKIP',
          personEmail: '',
          applicationName: aplikacja,
          reason: 'PERSON_BRAK_EMAIl',
        });
        continue;
      }

      const osoba = await this.prisma.person.findFirst({ where: { email } });
      const aplikacjaWRejestrze = await this.prisma.application.findFirst({
        where: { name: aplikacja, deletedAt: null },
      });

      if (!osoba || !aplikacjaWRejestrze) {
        wierszePar.push({
          status: 'SKIP',
          personEmail: email,
          applicationName: aplikacja,
          reason: !osoba ? 'PERSON_BRAK_W_KATALOGU' : 'APP_BRAK_W_REJESTRZE',
        });
        continue;
      }

      const istniejacy = await this.prisma.applicationAccess.findFirst({
        where: { applicationId: aplikacjaWRejestrze.id, personId: osoba.id },
      });
      wierszePar.push(
        istniejacy
          ? { status: 'SKIP', personEmail: email, applicationName: aplikacja, reason: 'ISTNIEJE' }
          : { status: 'NEW', personEmail: email, applicationName: aplikacja, reason: null },
      );
    }

    const wszystkie = [...aplikacje, ...wierszePar];
    return {
      aplikacje,
      pary: wierszePar,
      summary: {
        created: wszystkie.filter((r) => r.status === 'NEW').length,
        skipped: wszystkie.filter((r) => r.status === 'SKIP').length,
        errors: wszystkie.filter((r) => r.status === 'ERROR').length,
      },
    };
  }

  // ─── Import: zapis ──────────────────────────────────────────

  /**
   * Zapis importu. Kolejność: osoby → oprogramowanie → dostępy.
   * Każdy wiersz jest walidowany od nowa; śmieciowy jest pomijany.
   * Cały import to jeden wpis `glpi.imported` z licznikami per sekcja.
   */
  async wykonaj(payload: PayloadZapisu, actor: AuthUser, ip?: string) {
    if (!Array.isArray(payload?.sections) || payload.sections.length === 0) {
      throw new BadRequestException('Wybierz co najmniej jedną sekcję importu.');
    }

    const wynik: Record<Sekcja, Licznik> = {
      persons: { created: 0, skipped: 0 },
      software: { created: 0, skipped: 0 },
      access: { created: 0, skipped: 0 },
    };

    // Rejestry „już zrobione" — w payloadzie i w bazie.
    const utworzoneOsoby = new Map<string, string>();
    const utworzoneAplikacje = new Map<string, string>();
    const widzianeOsoby = new Set<string>();
    const widzianeAplikacje = new Set<string>();

    if (payload.sections.includes('persons')) {
      const wiersze = payload.persons ?? [];
      if (wiersze.length > MAX_WIERSZY) {
        throw new BadRequestException(`Import osób przekracza limit ${MAX_WIERSZY} wierszy.`);
      }
      for (const wiersz of wiersze) {
        const dane = this.walidujOsobe(wiersz);
        if (!dane) {
          wynik.persons.skipped++;
          continue;
        }
        const klucz = dane.email.toLowerCase();
        if (widzianeOsoby.has(klucz)) {
          wynik.persons.skipped++;
          continue;
        }
        widzianeOsoby.add(klucz);

        const istniejaca = await this.prisma.person.findFirst({ where: { email: dane.email } });
        if (istniejaca) {
          utworzoneOsoby.set(klucz, istniejaca.id);
          wynik.persons.skipped++;
          continue;
        }
        const utworzona = await this.prisma.person.create({ data: dane });
        utworzoneOsoby.set(klucz, utworzona.id);
        wynik.persons.created++;
      }
    }

    if (payload.sections.includes('software')) {
      const wiersze = payload.software ?? [];
      if (wiersze.length > MAX_WIERSZY) {
        throw new BadRequestException(`Import oprogramowania przekracza limit ${MAX_WIERSZY} wierszy.`);
      }
      for (const wiersz of wiersze) {
        const nazwa = (wiersz.name ?? '').trim();
        if (!nazwa || nazwa.length > 200) {
          wynik.software.skipped++;
          continue;
        }
        const klucz = nazwa.toLowerCase();
        if (widzianeAplikacje.has(klucz)) {
          wynik.software.skipped++;
          continue;
        }
        widzianeAplikacje.add(klucz);

        const istniejaca = await this.prisma.application.findFirst({
          where: { name: nazwa, deletedAt: null },
        });
        if (istniejaca) {
          utworzoneAplikacje.set(klucz, istniejaca.id);
          wynik.software.skipped++;
          continue;
        }
        const utworzona = await this.prisma.application.create({
          data: {
            name: nazwa,
            version: (wiersz.version ?? '').trim().slice(0, 100),
            description: null,
            createdById: actor.id,
          },
        });
        utworzoneAplikacje.set(klucz, utworzona.id);
        wynik.software.created++;
      }
    }

    if (payload.sections.includes('access')) {
      const wiersze = payload.access ?? [];
      if (wiersze.length > MAX_WIERSZY) {
        throw new BadRequestException(`Import dostępów przekracza limit ${MAX_WIERSZY} wierszy.`);
      }

      // Zapis nie chodzi do sieci, więc nie wymaga pełnej konfiguracji —
      // poziom dostępu czytamy bezpośrednio z ustawień.
      const poziom = await this.odczytajKlucz(KLUCZE.accessLevel);
      const accessLevel: Poziom = (POZIOMY as readonly string[]).includes(poziom ?? '')
        ? (poziom as Poziom)
        : 'USER';

      for (const wiersz of wiersze) {
        const email = (wiersz.personEmail ?? '').trim().toLowerCase();
        const nazwa = (wiersz.applicationName ?? '').trim();

        // Osoba: z tego importu albo z katalogu.
        const personId =
          utworzoneOsoby.get(email) ??
          (await this.prisma.person.findFirst({ where: { email } }))?.id;

        // Aplikacja: z tego importu (software), z katalogu, albo — jeśli
        // nic z tego — szkic z nazwy grupy, bo dostęp bez aplikacji nie
        // ma na co wskazać (zasada z projektu integracji).
        let applicationId =
          utworzoneAplikacje.get(nazwa.toLowerCase()) ??
          (await this.prisma.application.findFirst({
            where: { name: nazwa, deletedAt: null },
          }))?.id;

        if (!applicationId) {
          if (!nazwa || nazwa.length > 200) {
            wynik.access.skipped++;
            continue;
          }
          const utworzona = await this.prisma.application.create({
            data: {
              name: nazwa,
              version: '',
              description: null,
              createdById: actor.id,
            },
          });
          utworzoneAplikacje.set(nazwa.toLowerCase(), utworzona.id);
          applicationId = utworzona.id;
        }

        if (!personId || !applicationId) {
          wynik.access.skipped++;
          continue;
        }

        const istniejacy = await this.prisma.applicationAccess.findFirst({
          where: { applicationId, personId },
        });
        if (istniejacy) {
          wynik.access.skipped++;
          continue;
        }

        await this.prisma.applicationAccess.create({
          data: {
            applicationId,
            personId,
            level: accessLevel,
            note: 'Import z GLPI',
          },
        });
        wynik.access.created++;
      }
    }

    const pusty = wynik.persons.created + wynik.persons.skipped +
      wynik.software.created + wynik.software.skipped +
      wynik.access.created + wynik.access.skipped;
    if (pusty === 0) {
      throw new BadRequestException('Import nie zawiera żadnego wiersza.');
    }

    // Jeden wpis z licznikami — import nie może zasypać dziennika.
    await this.audit.record({
      action: 'glpi.imported',
      entity: 'GlpiImport',
      entityId: null,
      actorId: actor.id,
      actorName: actor.username,
      changes: {
        persons: { from: null, to: wynik.persons },
        software: { from: null, to: wynik.software },
        access: { from: null, to: wynik.access },
      },
      ip,
    });

    return wynik;
  }

  /** Revalidacja wiersza osoby — ten sam kształt reguł co w serwisie access. */
  private walidujOsobe(wiersz: WierszOsoby) {
    const email = (wiersz.email ?? '').trim().toLowerCase();
    const firstName = (wiersz.firstName ?? '').trim().slice(0, 100);
    const lastName = (wiersz.lastName ?? '').trim().slice(0, 100);

    if (!email || !WZOR_EMAIL.test(email) || email.length > 200) return null;
    if (!firstName || !lastName) return null;

    return {
      firstName,
      lastName,
      email,
      position: (wiersz.position ?? '')?.trim().slice(0, 150) || null,
      department: (wiersz.department ?? '')?.trim().slice(0, 150) || null,
    };
  }
}
