/**
 * Generator danych demo z eksportu — `scripts/export-demo.ts`.
 *
 * Skrypt czyta zrzut JSON z bazy działającej instancji (potok z `psql`
 * w celu `make export-demo`) i aktualizuje sekcje danych w plikach
 * `demo-access.ts` i `demo-ipam.ts`. Test pilnuje trzech rzeczy:
 *
 *  - **wygenerowany kod jest w kształcie, który kompilator przyjmie** —
 *    enum Prisma (`IpStatus`) musi wyjść jako `IpStatus.IN_USE`, a nie
 *    tekst `'IN_USE'`, bo tsc odrzuca literał w miejscu enuma;
 *  - **puste teksty wychodzą jako `null`** — w bazie opis bywa `''`,
 *    a w danych demo pusty tekst wygląda jak błąd, którego nikt
 *    nie popełnił;
 *  - **podmiana bloku między znacznikami jest szczelna** — drugi eksport
 *    nie dokleja drugiej kopii danych, a komentarze wokół bloku zostają.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  budujAccess,
  budujIpam,
  podmienBlok,
  walidujZrzut,
  type ZrzutDemo,
} from '../scripts/export-demo';

const ZRZUT: ZrzutDemo = {
  persons: [
    {
      firstName: 'Anna',
      lastName: 'Zalewska',
      email: 'anna.zalewska@example.invalid',
      position: 'Kierownik zespołu IT',
      department: 'IT',
      isActive: true,
    },
  ],
  grants: [
    {
      application: 'Grafana',
      email: 'anna.zalewska@example.invalid',
      level: 'OWNER',
      expiresOn: null,
      note: '',
    },
    {
      application: 'Grafana',
      email: 'anna.zalewska@example.invalid',
      level: 'USER',
      expiresOn: '2026-01-31',
      note: 'Dostęp czasowy',
    },
  ],
  subnets: [
    {
      name: 'DOM',
      cidr: '192.168.0.0/24',
      description: '',
      color: 'emerald',
      vlan: 1,
      location: null,
      addresses: [
        { address: '192.168.0.1', status: 'IN_USE', description: 'net.int' },
        { address: '192.168.0.9', status: 'FREE', description: null },
      ],
    },
  ],
  appLinks: [
    { application: 'Grafana', subnet: 'DOM', address: '192.168.0.1' },
  ],
};

describe('Generator danych demo z eksportu', () => {
  it('generuje dane IPAM z enumem Prisma, a nie tekstem', () => {
    const blok = budujIpam(ZRZUT);

    assert.match(blok, /status: IpStatus\.IN_USE/);
    assert.match(blok, /status: IpStatus\.FREE/);
    assert.doesNotMatch(
      blok,
      /status: '(IN_USE|FREE|DEPRECATED)'/,
      'literał tekstowy w miejscu enuma nie przejdzie kompilacji',
    );
    assert.match(blok, /name: 'DOM'/);
    assert.match(blok, /cidr: '192\.168\.0\.0\/24'/);
  });

  it('puste teksty z bazy zapisuje jako null', () => {
    const blok = budujIpam(ZRZUT);

    // `description: ''` z zrzutu ma wyjść jako `null` — pusty tekst
    // w danych demo wygląda jak niedokończony rekord.
    assert.doesNotMatch(blok, /description: ''/);
  });

  it('generuje osoby i przypisania z datą wygasania jako datą', () => {
    const blok = budujAccess(ZRZUT);

    assert.match(blok, /email: 'anna\.zalewska@example\.invalid'/);
    assert.match(blok, /level: 'OWNER'/);
    // Adnotacja typu przy `DANE_PRZYPISAN` musi przetrwać eksport: bez niej
    // `level` wychodzi jako `string`, a seed oczekuje `AccessLevelName` —
    // tsc odrzuci zapis.
    assert.match(blok, /const DANE_PRZYPISAN: Array<\{[^]*level: AccessLevelName/);
    // Data wygasania przez pomocnik `data(...)`, nie surowy tekst —
    // kolumna to `@db.Date` i seed parsuje ją w jednej strefie czasowej.
    assert.match(blok, /expiresOn: data\('2026-01-31'\)/);
    assert.match(blok, /expiresOn: null/);
    // Pusta notatka z bazy wychodzi jako null.
    assert.match(blok, /note: null/);
    assert.match(blok, /note: 'Dostęp czasowy'/);
  });

  it('odrzuca zrzut z nieznanym statusem adresu', () => {
    const zly: ZrzutDemo = {
      ...ZRZUT,
      subnets: [
        {
          ...ZRZUT.subnets[0],
          addresses: [
            { address: '192.168.0.1', status: 'ZAJETY', description: null },
          ],
        },
      ],
    };

    assert.throws(() => walidujZrzut(zly), /status/i);
  });

  it('odrzuca zrzut z nieznanym poziomem dostępu i złą datą', () => {
    assert.throws(
      () =>
        walidujZrzut({
          ...ZRZUT,
          grants: [
            {
              ...ZRZUT.grants[0],
              level: 'WLASCICIEL',
            },
          ],
        }),
      /level/i,
    );

    assert.throws(
      () =>
        walidujZrzut({
          ...ZRZUT,
          grants: [
            {
              ...ZRZUT.grants[0],
              expiresOn: '31.01.2026',
            },
          ],
        }),
      /expiresOn/i,
    );
  });

  it('podmienia blok między znacznikami bez nakładania kopii', () => {
    const plik = [
      'komentarz przed',
      '/** ── Dane wygenerowane z eksportu (`make export-demo`) — początek ── */',
      'stare dane',
      '/** ── Dane wygenerowane z eksportu (`make export-demo`) — koniec ─── */',
      'komentarz po',
    ].join('\n');

    const raz = podmienBlok(plik, 'nowe dane');
    assert.match(raz, /komentarz przed/);
    assert.match(raz, /nowe dane/);
    assert.doesNotMatch(raz, /stare dane/);

    const dwa = podmienBlok(raz, 'jeszcze nowsze dane');
    assert.match(dwa, /jeszcze nowsze dane/);
    assert.doesNotMatch(dwa, /nowe dane/);
    assert.equal(
      (dwa.match(/── Dane wygenerowane/g) ?? []).length,
      2,
      'drugi eksport nie może dokleić drugiej pary znaczników',
    );
    assert.match(dwa, /komentarz po/);
  });

  it('odrzuca plik bez znaczników — bez wymiany losi się duplikat', () => {
    assert.throws(() => podmienBlok('plik bez znaczników', 'x'), /znacznik/i);
  });
});
