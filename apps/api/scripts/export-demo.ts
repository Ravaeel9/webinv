#!/usr/bin/env node
/**
 * Eksport danych demonstracyjnych z działającej instancji.
 *
 * Czyta zrzut JSON z bazy (potok z `psql`, patrz cel `make export-demo`)
 * i podmienia sekcje danych między znacznikami w plikach:
 *
 *  - `src/seed/demo-access.ts`  — osoby i przypisania macierzy,
 *  - `src/seed/demo-ipam.ts`    — podsieci, adresy i powiązania
 *                                 aplikacja–adres.
 *
 * Struktura plików seeda (typy, funkcje seedujące, komentarze) jest
 * ręczna — generowane są wyłącznie dane między znacznikami. Dzięki temu
 * odświeżenie danych demo nie niszczy dokumentacji w komentarzach.
 *
 * Aplikacje demo (`demo-applications.ts`, `demo-services.ts`) eksport
 * **celowo nie rusza**: seed upsertuje je przy każdym starcie, więc baza
 * i tak trzyma ich kopię, a lista nazw jest związana testem
 * `demo-marker.test.ts` z migracją nadającą `is_demo`. Zmiana zestawu
 * aplikacji to decyzja w kodzie, nie efekt uboczny eksportu.
 *
 * Użycie:
 *     npx tsx scripts/export-demo.ts [zrzut.json]
 *
 * Bez argumentu czyta zrzut ze standardowego wejścia.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Zrzut danych demo z bazy, w kształcie produkowanym przez `psql`. */
export type ZrzutDemo = {
  persons: Array<{
    firstName: string;
    lastName: string;
    email: string;
    position: string | null;
    department: string | null;
    isActive: boolean;
  }>;
  grants: Array<{
    application: string;
    email: string;
    level: string;
    expiresOn: string | null;
    note: string | null;
  }>;
  subnets: Array<{
    name: string;
    cidr: string;
    description: string | null;
    color: string;
    vlan: number | null;
    location: string | null;
    addresses: Array<{
      address: string;
      status: string;
      description: string | null;
    }>;
  }>;
  appLinks: Array<{ application: string; subnet: string; address: string }>;
};

/** Statusy adresu z modelu Prisma — cokolwiek innego jest literówką. */
const STATUSEY = ['FREE', 'IN_USE', 'DEPRECATED'];
/** Poziomy dostępu z `access.port.ts`. */
const POZIOMY = ['OWNER', 'ADMIN', 'USER', 'READ_ONLY'];
/** Format daty w kolumnach `@db.Date` — inaczej seed parsuje bzdurę. */
const WZORZEC_DATY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Sprawdza kształt zrzutu, zanim cokolwiek trafi do plików seeda.
 *
 * Zrzut powstaje zapytaniem SQL w Makefile — jego literówka w nazwie
 * kolumny dałaby `undefined` w danych i plik seeda z pustymi listami,
 * wyglądający poprawnie. Walidacja mówi wprost, co jest nie tak.
 */
export function walidujZrzut(dane: unknown): ZrzutDemo {
  const zrzut = dane as ZrzutDemo;
  for (const klucz of ['persons', 'grants', 'subnets', 'appLinks'] as const) {
    if (!Array.isArray(zrzut?.[klucz])) {
      throw new Error(`Zrzut nie ma tablicy „${klucz}" — sprawdź zapytanie SQL.`);
    }
  }

  for (const osoba of zrzut.persons) {
    if (!osoba?.email) {
      throw new Error('Osoba w zrzucie nie ma adresu e-mail.');
    }
  }

  for (const przypisanie of zrzut.grants) {
    if (!POZIOMY.includes(przypisanie?.level)) {
      throw new Error(
        `Przypisanie ma nieznany level: „${przypisanie?.level}". ` +
          `Oczekiwano jednego z: ${POZIOMY.join(', ')}.`,
      );
    }
    if (
      przypisanie?.expiresOn !== null &&
      !WZORZEC_DATY.test(String(przypisanie?.expiresOn))
    ) {
      throw new Error(
        `Przypisanie ma expiresOn poza formatem RRRR-MM-DD: „${przypisanie?.expiresOn}".`,
      );
    }
  }

  for (const podsiec of zrzut.subnets) {
    if (!podsiec?.name || !podsiec?.cidr) {
      throw new Error('Podsieć w zrzucie nie ma nazwy albo CIDR.');
    }
    if (!Array.isArray(podsiec.addresses)) {
      throw new Error(`Podsieć „${podsiec.name}" nie ma tablicy addresses.`);
    }
    for (const adres of podsiec.addresses) {
      if (!STATUSEY.includes(adres?.status)) {
        throw new Error(
          `Adres „${adres?.address}" ma nieznany status: „${adres?.status}". ` +
            `Oczekiwano jednego z: ${STATUSEY.join(', ')}.`,
        );
      }
    }
  }

  return zrzut;
}

/**
 * Tekst z bazy jako pole danych demo: pusty tekst wychodzi jako `null`,
 * bo pusty opis w danych demo wygląda jak niedokończony rekord.
 */
function tekst(wartosc: string | null | undefined): string | null {
  return wartosc === null || wartosc === undefined || wartosc === ''
    ? null
    : wartosc;
}

/** Literał tekstowy TS w pojedynczych cudzysłowach — konwencja repo. */
function cytat(wartosc: string | null): string {
  if (wartosc === null) return 'null';
  return `'${wartosc.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

/**
 * Wcięcie obiektu o jeden poziom — elementy listy wyrównane jednakowo.
 * Pierwszy wiersz dostaje wcięcie razem z resztą, bo otwierający nawias
 * wypada wewnątrz listy, a nie na jej marginesie.
 */
function przesun(blok: string): string {
  return blok
    .split('\n')
    .map((linia) => (linia === '' ? linia : `  ${linia}`))
    .join('\n');
}

/** Znaczniki granic bloku generowanego — te same w obu plikach seeda. */
export const POCZATEK_BLOKU =
  '/** ── Dane wygenerowane z eksportu (`make export-demo`) — początek ── */';
export const KONIEC_BLOKU =
  '/** ── Dane wygenerowane z eksportu (`make export-demo`) — koniec ─── */';

/**
 * Podmienia treść między znacznikami.
 *
 * Rzuca, gdy plik nie ma znaczników: eksport "udany" przy braku wymiany
 * zostawiłby stare dane i nikt by się nie dowiedział. Po podmianie
 * znaczniki są dokładnie jedna para — kolejny eksport nie dokleja kopii.
 */
export function podmienBlok(tresc: string, nowyBlok: string): string {
  const start = tresc.indexOf(POCZATEK_BLOKU);
  const koniec = tresc.indexOf(KONIEC_BLOKU);
  if (start === -1 || koniec === -1 || koniec < start) {
    throw new Error(
      'Plik nie ma pary znaczników bloku generowanego — ' +
        'dodaj znaczniki początek/koniec zamiast dopisywać dane obok.',
    );
  }

  return (
    tresc.slice(0, start) +
    `${POCZATEK_BLOKU}\n${nowyBlok.trim()}\n${KONIEC_BLOKU}` +
    tresc.slice(koniec + KONIEC_BLOKU.length)
  );
}

/** Generuje sekcję danych IPAM — zawartość `DEMO_IPAM_DATA`. */
export function budujIpam(zrzut: ZrzutDemo): string {
  const podsieci = zrzut.subnets.map((podsiec) => {
    const adresy = podsiec.addresses
      .map(
        (adres) =>
          `      { address: ${cytat(adres.address)}, status: IpStatus.${adres.status}, description: ${cytat(tekst(adres.description))} },`,
      )
      .join('\n');
    return przesun(
      [
        '{',
        `  name: ${cytat(podsiec.name)},`,
        `  cidr: ${cytat(podsiec.cidr)},`,
        `  description: ${cytat(tekst(podsiec.description))},`,
        `  color: ${cytat(podsiec.color || 'slate')},`,
        `  vlan: ${podsiec.vlan ?? 'null'},`,
        `  location: ${cytat(tekst(podsiec.location))},`,
        '  addresses: [',
        adresy,
        '  ],',
        '},',
      ].join('\n'),
    );
  });

  const powiazania = zrzut.appLinks.map(
    (powiazanie) =>
      `  { application: ${cytat(powiazanie.application)}, subnet: ${cytat(powiazanie.subnet)}, address: ${cytat(powiazanie.address)} },`,
  );

  return [
    'export const DEMO_IPAM_DATA: DemoIpamData = {',
    '  subnets: [',
    podsieci.join('\n'),
    '  ],',
    '  appLinks: [',
    powiazania.join('\n'),
    '  ],',
    '};',
  ].join('\n');
}

/** Generuje sekcję danych macierzy — `DANE_OSOB` i `DANE_PRZYPISAN`. */
export function budujAccess(zrzut: ZrzutDemo): string {
  const osoby = zrzut.persons.map((osoba) =>
    przesun(
      [
        '{',
        `  firstName: ${cytat(osoba.firstName)},`,
        `  lastName: ${cytat(osoba.lastName)},`,
        `  email: ${cytat(osoba.email)},`,
        `  position: ${cytat(tekst(osoba.position))},`,
        `  department: ${cytat(tekst(osoba.department))},`,
        `  isActive: ${osoba.isActive},`,
        '},',
      ].join('\n'),
    ),
  );

  const przypisania = zrzut.grants.map((przypisanie) =>
    przesun(
      [
        '{',
        `  application: ${cytat(przypisanie.application)},`,
        `  email: ${cytat(przypisanie.email)},`,
        `  level: ${cytat(przypisanie.level)},`,
        `  expiresOn: ${przypisanie.expiresOn === null ? 'null' : `data('${przypisanie.expiresOn}')`},`,
        `  note: ${cytat(tekst(przypisanie.note))},`,
        '},',
      ].join('\n'),
    ),
  );

  return [
    'const DANE_OSOB = [',
    osoby.join('\n'),
    '];',
    '',
    '/** Przypisania: nazwa aplikacji demo → osoby i poziomy. */',
    'const DANE_PRZYPISAN: Array<{',
    '  application: string;',
    '  email: string;',
    '  level: AccessLevelName;',
    '  expiresOn: Date | null;',
    '  note: string | null;',
    '}> = [',
    przypisania.join('\n'),
    '];',
  ].join('\n');
}

/** Odczyt zrzutu: plik z argumentu albo standardowe wejście. */
function wczytajZrzut(sciezka?: string): ZrzutDemo {
  const tresc = sciezka
    ? readFileSync(sciezka, 'utf8')
    : readFileSync(0, 'utf8');
  return walidujZrzut(JSON.parse(tresc));
}

async function main(): Promise<void> {
  const zrzut = wczytajZrzut(process.argv[2]);
  const katalog = join(__dirname, '..', 'src', 'seed');

  for (const [plik, blok] of [
    ['demo-access.ts', budujAccess(zrzut)],
    ['demo-ipam.ts', budujIpam(zrzut)],
  ] as const) {
    const sciezka = join(katalog, plik);
    const tresc = readFileSync(sciezka, 'utf8');
    writeFileSync(sciezka, podmienBlok(tresc, blok));
    console.log(`[export-demo] ${plik}: dane podmienione.`);
  }

  console.log(
    `[export-demo] Osoby: ${zrzut.persons.length}, przypisania: ${zrzut.grants.length}, ` +
      `podsieci: ${zrzut.subnets.length}, ` +
      `adresy: ${zrzut.subnets.reduce((suma, s) => suma + s.addresses.length, 0)}.`,
  );
}

// Uruchomienie bezpośrednie (`npx tsx scripts/export-demo.ts`) — import
// z testu ma tylko używać wyeksportowanych funkcji.
if (require.main === module) {
  main().catch((blad: unknown) => {
    console.error('[export-demo] FAILED —', blad instanceof Error ? blad.message : blad);
    process.exit(1);
  });
}
