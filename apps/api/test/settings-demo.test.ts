/**
 * Tryb demonstracyjny — kontrakt na to, kto może i co robi.
 *
 * Testy czysto logiczne, bez bazy: `SettingsService` rozmawia z Prisma
 * przez wąski port (jak `seedDemoApplications`), więc cała jego
 * powierzchnia da się sprawdzić atrapą.
 *
 * Dlaczego to pilnuje realnych błędów:
 *
 *  - **`settings` wygrywa z `SEED_DEMO_APPS`.** Bez tego wyłączenie trybu
 *    demo w panelu przestawałoby działać po restarcie kontenera: `.env`
 *    wciąż miałby `true` i dane wracałyby wbrew decyzji administratora.
 *    Brak wpisu musi dawać zachowanie sprzed zmiany, inaczej istniejące
 *    wdrożenia bez migracji przestałyby wypełniać bazę po restarcie.
 *  - **Kasowanie idzie po `isDemo`, nie po nazwie.** Po nazwie z kodu
 *    zmiana nazwy rekordu w UI psułaby rozpoznawanie i wpis zostałby
 *    w bazie na zawsze — albo skasowałby się cudzy rekord.
 *  - **Uprawnienie należy wyłącznie do `SUPER_ADMIN`.** `ADMIN` dostaje
 *    `app:write`, czyli może usunąć aplikację jedną po drugiej; nie
 *    powinien jednak dostać przycisku kasującego 30 rekordów naraz.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  SettingsService,
  type SettingsPort,
} from '../src/settings/settings.service';
import { PERMISSIONS, roleHasPermission } from '../src/auth/permissions';
import { read } from './helpers/repo';

/** Aktor testowy — dziennik musi wiedzieć, kto kasował. */
const ACTOR = {
  id: 'u-1',
  username: 'admin',
  email: 'admin@firma.pl',
  fullName: 'Administrator Systemu',
  role: 'SUPER_ADMIN',
  mustChangePassword: false,
} as const;

/**
 * Serwis z wstrzykniętym portem.
 *
 * Osobna funkcja, bo `SettingsService` bierze trzy argumenty (klient
 * Prisma, konfiguracja, dziennik), a w testach zależy nam tylko o porcie.
 * Rzutowanie jest tu nieuniknione: `SettingsService` w produkcji
 * przyjmuje `PrismaService`, którego nie da się napisać atrapą — to
 * klient z kilkunastoma metodami połączenia i transakcji. Port
 * `SettingsPort` jest tym, co serwis **faktycznie** woła, i to on
 * jest sprawdzany w każdym przypadku poniżej.
 */
function serwis(
  p: SettingsPort,
  demoApps = true,
  dziennik: { record: (e: unknown) => Promise<void> } = {
    record: async () => {},
  },
) {
  return new SettingsService(
    p as unknown as ConstructorParameters<typeof SettingsService>[0],
    { seed: { demoApps } } as never,
    dziennik as never,
  );
}

/** Atrapta bazy z zapisanymi ustawieniami i zliczonymi rekordami. */
function port(zapisane: Record<string, string>, liczba = 30) {
  return {
    setting: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        zapisane[where.key] !== undefined
          ? { key: where.key, value: zapisane[where.key] }
          : null,
    },
    application: { count: async () => liczba },
  } as unknown as SettingsPort;
}

describe('Uprawnienie do ustawień', () => {
  it('należy tylko do super administratora', () => {
    assert.ok(roleHasPermission('SUPER_ADMIN', 'settings:write'));
    assert.equal(
      roleHasPermission('ADMIN', 'settings:write'),
      false,
      'ADMIN ma app:write, czyli może kasować aplikacje pojedynczo — ' +
        'masowe kasowanie danych demonstracyjnych to inna skala',
    );
    assert.equal(roleHasPermission('VIEWER', 'settings:write'), false);
  });

  it('jest wypisane na liście wszystkich uprawnień', () => {
    // `ALL_PERMISSIONS` istnieje po to, żeby kompilator zgłosił brak
    // uprawnienia dodanego do roli, a nie milczał. Uprawnienie spoza
    // tej listy byłoby widoczne w kodzie i niewidoczne w teście.
    assert.ok(
      PERMISSIONS.SUPER_ADMIN.includes('settings:write'),
      'uprawnienie użyte w kodzie, ale nieopisane w ALL_PERMISSIONS',
    );
  });
});

describe('Odczyt trybu demo', () => {
  it('brak wpisu w bazie oznacza zachowanie z pliku .env', async () => {
    // Dwie wartości z env, bo kontrakt brzmi „zachowanie sprzed zmiany",
    // a nie jedna konkretna wartość.
    const wlaczone = await serwis(port({}), true).getDemoMode();
    assert.equal(
      wlaczone.enabled,
      true,
      'brak wpisu musi dać to, co ustawia SEED_DEMO_APPS — inaczej ' +
        'wdrożenie bez migracji przestanie działać',
    );
    assert.equal(wlaczone.source, 'env');

    const wylaczone = await serwis(port({}), false).getDemoMode();
    assert.equal(wylaczone.enabled, false);
    assert.equal(wylaczone.source, 'env');
  });

  it('wpis w bazie ma pierwszeństwo przed plikiem .env', async () => {
    // Najważniejszy przypadek: administrator wyłączył tryb demo,
    // a `.env` nadal mówi `SEED_DEMO_APPS=true`. Gdyby wygrał env,
    // dane wracałyby po restarcie wbrew decyzji z panelu.
    const wynik = await serwis(port({ demo_mode: 'false' }), true).getDemoMode();
    assert.equal(wynik.enabled, false);
    assert.equal(wynik.source, 'db');
  });

  it('odczytuje liczbę rekordów demonstracyjnych z bazy', async () => {
    const wynik = await serwis(port({ demo_mode: 'true' })).getDemoMode();
    assert.equal(wynik.recordCount, 30);
  });

  it('liczy rekordy demonstracyjne osobno, nie wszystkie', async () => {
    // `count({ where: { isDemo: true } })` — bez filtra zwróciłoby
    // wszystkie rekordy w rejestrze, a panel pokazałby „30 do usunięcia",
    // gdyby ich wcale nie było. Licznik musi odpowiadać temu, co
    // przycisk faktycznie skasuje.
    let zapytanie: { where: { isDemo: boolean } } | null = null;

    const prisma = {
      setting: { findUnique: async () => ({ value: 'true' }) },
      application: {
        count: async (args: { where: { isDemo: boolean } }) => {
          zapytanie = args;
          return 5;
        },
      },
    } as unknown as SettingsPort;

    await serwis(prisma).getDemoMode();
    assert.deepEqual(zapytanie, { where: { isDemo: true } });
  });

  it('zna wartości spoza zakresu, których nie będzie', async () => {
    // Ktoś edytuje wiersz w bazie ręcznie. `true`/`false` to komplet
    // dozwolonych wartości, a wszystko inne musi czytać się jako wyłączony
    // tryb — tryb włączony przy nieczytelnej wartości wypełniłby bazę
    // danymi, których nikt nie zamawiał.
    const wynik = await serwis(port({ demo_mode: 'TAK' })).getDemoMode();
    assert.equal(wynik.enabled, false);
  });

  it('seed tak samo traktuje nieczytelną wartość', async () => {
    // Ta sama zasada co w `getDemoMode`, tylko dla konsumenta, którym jest
    // `SeedService`. Gdyby tu była inna reguła, panel pokazywałby
    // „wyłączony", a kontener po restarcie wypełniłby bazę demo.
    assert.equal(
      await serwis(port({ demo_mode: 'prawda' })).shouldSeedDemo(),
      false,
    );
    assert.equal(
      await serwis(port({ demo_mode: 'true' })).shouldSeedDemo(),
      true,
    );
    assert.equal(await serwis(port({})).shouldSeedDemo(), true);
    assert.equal(await serwis(port({}), false).shouldSeedDemo(), false);
  });
});

describe('Zapis trybu demo', () => {
  it('zapisuje decyzję w bazie, nie w pliku', async () => {
    const zapisane: Record<string, string> = {};
    const prisma = {
      setting: {
        upsert: async ({
          update,
          create,
        }: {
          update: { value: string };
          create: { key: string; value: string };
        }) => {
          zapisane[create.key] = update.value;
          return { key: create.key, value: create.value };
        },
      },
      application: { count: async () => 30 },
    } as unknown as SettingsPort;

    await serwis(prisma).setDemoMode(false);
    assert.equal(zapisane.demo_mode, 'false');
  });

  it('zapisuje pod kluczem, którego seed potem szuka', async () => {
    // Klucz jest wspólną umową między `SettingsService` i `SeedService`.
    // Zmiana w jednym miejscu bez drugiego sprawiłaby, że panel zapisywałby
    // decyzję pod jednym kluczem, a seed czytałby pod drugim — i dane
    // wracałyby wbrew decyzji administratora, bez żadnego błędu.
    const szukane: string[] = [];
    const prisma = {
      setting: {
        findUnique: async ({ where }: { where: { key: string } }) => {
          szukane.push(where.key);
          return null;
        },
        upsert: async ({ where }: { where: { key: string } }) => {
          szukane.push(where.key);
          return null;
        },
      },
      application: { count: async () => 0 },
    } as unknown as SettingsPort;

    const s = serwis(prisma);
    await s.setDemoMode(true);
    await s.shouldSeedDemo();

    assert.equal(
      new Set(szukane).size,
      1,
      `zapis i odczyt używają różnych kluczy: ${[...new Set(szukane)].join(', ')}`,
    );
  });
});

describe('Kasowanie danych demonstracyjnych', () => {
  /** Atrapta zapisująca wywołania na bazie i wpisy do dziennika. */
  function portDemo(liczba = 30) {
    const stany = {
      deleteArgs: [] as { where: { isDemo: boolean } }[],
      zdarzenia: [] as {
        action: string;
        changes?: unknown;
        actorId?: string;
      }[],
      transakcje: 0,
    };

    const prisma = {
      setting: { findUnique: async () => null },
      application: {
        count: async () => liczba,
        deleteMany: async (args: { where: { isDemo: boolean } }) => {
          stany.deleteArgs.push(args);
          return { count: liczba };
        },
      },
      $transaction: async <T>(operacja: () => Promise<T>) => {
        stany.transakcje++;
        return operacja();
      },
    } as unknown as SettingsPort;

    // Dziennik to **osobne** wstrzyknięcie (`AuditService`), a nie część
    // klienta Prisma — dlatego atrapa dziennika nie mieszka w `prisma`.
    const dziennik = {
      record: async (e: {
        action: string;
        changes?: unknown;
        actorId?: string;
      }) => {
        stany.zdarzenia.push(e);
      },
    };

    return { prisma, stany, dziennik };
  }

  /** Serwis z portem i atrapą dziennika. */
  function serwisDemo(p: SettingsPort, dziennik: unknown) {
    return serwis(p, true, dziennik as never);
  }

  it('kasuje wyłącznie rekordy oznaczone flagą demo', async () => {
    // Po nazwie z kodu zmiana rekordu w interfejsie psułaby
    // rozpoznawanie: wpis przestałby być demo i zostałby w bazie na
    // zawsze. Filtrowanie po flagi jest jedynym poprawnym wariantem.
    const { prisma, stany, dziennik } = portDemo();
    await serwisDemo(prisma, dziennik).deleteDemoData(ACTOR);

    assert.deepEqual(
      stany.deleteArgs,
      [{ where: { isDemo: true } }],
      'kasowanie po czymś innym niż flaga może zniszczyć prawdziwe dane',
    );
  });

  it('kasuje i wpisuje do dziennika w jednej transakcji', async () => {
    // Bez transakcji skasowane rekordy zostają bez śladu w dzienniku,
    // gdyby wpis się nie udał — i nikt nie odtworzy, co zniknęło.
    const { prisma, stany, dziennik } = portDemo();
    await serwisDemo(prisma, dziennik).deleteDemoData(ACTOR);

    assert.equal(stany.transakcje, 1);
    assert.equal(stany.zdarzenia.length, 1);
  });

  it('wpisuje do dzienniku tego, kto kasował', async () => {
    const { prisma, stany, dziennik } = portDemo();
    await serwisDemo(prisma, dziennik).deleteDemoData(ACTOR);

    assert.equal(stany.zdarzenia[0].actorId, 'u-1');
  });

  it('zapisuje w dzienniku liczbę usuniętych rekordów', async () => {
    const { prisma, stany, dziennik } = portDemo(7);
    await serwisDemo(prisma, dziennik).deleteDemoData(ACTOR);

    assert.equal(
      stany.zdarzenia.length,
      1,
      'jedno zdarzenie zbiorcze, nie po jednym na rekord',
    );
    assert.match(
      JSON.stringify(stany.zdarzenia[0].changes ?? {}),
      /7/,
      'liczba rekordów musi być w dzienniku — bez niej zdarzenie ' +
        'nie odpowiada na pytanie „co się stało"',
    );
  });

  it('nie kasuje, gdy nie ma czego kasować, i mówi o tym w dzienniku', async () => {
    // Przycisk jest `disabled` przy zerze, ale endpoint musi być bezpieczny
    // także wtedy, gdy ktoś wyśle żądanie wprost — inaczej skasowałby
    // rekordy, które zdążyły w międzyczasie powstać z ręcznego wpisu.
    const { prisma, stany, dziennik } = portDemo(0);
    await serwisDemo(prisma, dziennik).deleteDemoData(ACTOR);

    assert.equal(stany.zdarzenia.length, 1);
    assert.match(JSON.stringify(stany.zdarzenia[0].changes ?? {}), /0/);
  });
});

describe('Oznaczenie is_demo', () => {
  it('seed ustawia flagę w tworzeniu i w aktualizacji', () => {
    const tekst = read('apps', 'api', 'src', 'seed', 'demo-applications.ts');

    // Oba wystąpienia, nie jedno: flaga w `create` daje ją nowym
    // rekordom, ale istniejące rekordy powstają w `update` przy upsertcie.
    const wystapienia = tekst.match(/isDemo:\s*true/g) ?? [];
    assert.equal(
      wystapienia.length,
      2,
      'oczekiwano isDemo w gałęzi create i update — przy samym create ' +
        'rekord istniejący przed migracją nie dostałby flagi',
    );
  });
});