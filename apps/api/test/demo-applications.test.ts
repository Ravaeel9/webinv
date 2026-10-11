/**
 * Dane demonstracyjne do rejestru — kontrakt na kompletność i poprawność.
 *
 * Seed zapisuje do bady z pominięciem DTO, więc nic go nie waliduje.
 * Jedyny mechanizm, który może tu złapać błąd, to ten test — dlatego
 * sprawdza nie tylko obecność danych, ale przechodzenie przez te same
 * walidatory, co ładunek z formularza (`check()` identyczne jak
 * w `application-dto.test.ts`).
 *
 * Czemu „wszystkie pola": te rekordy mają służyć do obejrzenia interfejsu,
 * a puste pole wygląda w UI jak błąd, którego nikt nie popełnił. Dlatego
 * test wymaga kompletu w każdym miejscu, które strona szczegółów pokazuje.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateApplicationDto } from '../src/applications/dto/application.dto';
import type { Prisma } from '@prisma/client';
import {
  DEMO_APPLICATIONS,
  DEMO_DATA,
  seedDemoApplications,
  type DemoSeeder,
} from '../src/seed/demo-applications';
import { DEMO_SERVICES } from '../src/seed/demo-services';

/** Pola, które strona szczegółów pokazuje dla `GENERAL_USE`. */
const COMPLETE = [
  'name',
  'version',
  'description',
  'purpose',
  'integrations',
  'ownerEmail',
  'introducedOn',
  'securityClass',
  'criticality',
  'status',
  'deliveryType',
  'vendor',
  'license',
  'licenseCount',
  'annualCost',
  'supportOwnerType',
  'supportOwnerName',
  'supportEmail',
  'supportUrl',
  'supportChannel',
  'supportNotes',
  'websiteUrl',
  'docsUrl',
  'repoUrl',
  'runbookUrl',
] as const;

const TRANSFORM_OPTIONS = { enableImplicitConversion: false } as const;

async function errorsFor(record: Record<string, unknown>): Promise<string[]> {
  const instance = plainToInstance(
    CreateApplicationDto,
    record,
    TRANSFORM_OPTIONS,
  );
  const errors = await validate(instance as object, { whitelist: true });
  return errors.map((e) => Object.values(e.constraints ?? {}).join('; '));
}

describe('seedDemoApplications', () => {
  /** Atrapta zbierająca wywołania upsertu. */
  function atrapata() {
    const wywolania: Prisma.ApplicationUpsertArgs[] = [];

    const prisma: DemoSeeder = {
      application: {
        upsert: async (args) => {
          wywolania.push(args);
          return null as unknown as Prisma.ApplicationGetPayload<
            Record<string, never>
          >;
        },
      },
    };

    return { prisma, wywolania };
  }

  it('zapisuje programy i usługi razem', async () => {
    // Usługi żyją w osobnym pliku i osobnym typie. Gdyby seed zapisywał
    // tylko `DEMO_APPLICATIONS`, dane usług byłyby zielone w teście
    // na dane, a nigdy nie doszłyby do bazy — i nikt by tego nie zauważył,
    // bo to najwyżej pusta sekcja „Dostęp i wsparcie" na stronie szczegółów.
    const { prisma, wywolania } = atrapata();
    await seedDemoApplications(prisma);

    assert.equal(wywolania.length, DEMO_DATA.length);

    const zapisane = wywolania.map((w) => w.where.name);
    for (const usluga of DEMO_SERVICES) {
      assert.ok(
        zapisane.includes(usluga.name),
        `${usluga.name} nie trafiło do bazy — seed pomija plik z usługami`,
      );
    }
  });

  it('zapisuje każdy rekord osobno, szukając go po nazwie', async () => {
    const { prisma, wywolania } = atrapata();
    await seedDemoApplications(prisma);

    assert.equal(wywolania.length, DEMO_DATA.length);
    assert.deepEqual(
      wywolania.map((w) => w.where.name).sort(),
      [...DEMO_DATA.map((r) => r.name)].sort(),
    );
  });

  it('przy ponownym starcie aktualizuje, zamiast tworzyć drugi raz', async () => {
    // `SeedService` startuje przy każdym uruchomieniu kontenera. Gdyby to
    // było `create`, każdy restart mnożyłby dwadzieśta rekordów, a po
    // trzech startach lista pokazywałaby sześćdziesiąt pozycji — i żaden
    // test tego nie zauważyłby, bo odpowiada tylko za dane wejściowe.
    const { prisma, wywolania } = atrapata();
    await seedDemoApplications(prisma);
    await seedDemoApplications(prisma);

    const unikalne = new Set(wywolania.map((w) => w.where.name));
    assert.equal(
      unikalne.size,
      DEMO_DATA.length,
      'wolania muszą być kluczowane nazwą, inaczej powtórny start ' +
        'utworzyłoby duplikaty',
    );
    // Ta sama gałąź musi nosić te same pola co tworzenie — inaczej poprawka
    // opisu działa tylko przy pierwszym starcie, a przy każdym kolejnym
    // rekord wraca do wartości sprzed zmiany.
    for (const w of wywolania) {
      const polaTworzenia = Object.keys(w.create).filter((p) => p !== 'environments');
      assert.deepEqual(
        Object.keys(w.update).filter((p) => p !== 'environments').sort(),
        polaTworzenia.sort(),
        `${w.where.name}: gałąź update ma inne pola niż create`,
      );
    }
  });

  it('zamienia daty na znaczniki czasu przed zapisem', async () => {
    // `introducedOn` i `sunsetOn` to kolumny `@db.Date`. Prisma przyjmuje
    // dla nich pełny znacznik czasu i odrzuci samo `RRRR-MM-DD` wyjątkiem
    // przy starcie kontenera — czyli healthcheck nigdy nie wstanie, a błąd
    // w logach wygląda jak problem z konfiguracją, nie z danymi.
    const { prisma, wywolania } = atrapata();
    await seedDemoApplications(prisma);

    const zDatami = wywolania.filter(
      (w) => (w.create as { introducedOn?: unknown }).introducedOn !== undefined,
    );
    assert.ok(zDatami.length > 0, 'test nie widzi dat — nic by nie sprawdzał');

    for (const w of zDatami) {
      for (const pole of ['introducedOn', 'sunsetOn']) {
        const wartosc = (w.update as Record<string, unknown>)[pole];
        if (wartosc === undefined) continue;

        assert.ok(
          wartosc instanceof Date,
          `${w.where.name}: ${pole} to ${typeof wartosc}, a Prisma wymaga ` +
            'znacznika czasu',
        );
        assert.equal(
          Number.isNaN((wartosc as Date).getTime()),
          false,
          `${w.where.name}: ${pole} nie jest poprawną datą`,
        );
      }
    }
  });

  it('zapisuje daty jako północ UTC, bez przesunięcia strefy', async () => {
    // Kolumna to `@db.Date` — czas w środku nocy jest tu niepotrzebny, a
    // przy strefie UTC+2 lokalna północ wypadałaby w poprzednim dniu
    // i data wprowadzenia przesuwałaby się o jeden dzień wstecz.
    const { prisma, wywolania } = atrapata();
    await seedDemoApplications(prisma);

    const wprowadzona = (wywolania[0].update as { introducedOn: Date })
      .introducedOn;

    assert.equal(
      wprowadzona.toISOString(),
      new Date(DEMO_APPLICATIONS[0].introducedOn).toISOString(),
    );
    assert.equal(wprowadzona.getUTCHours(), 0);
  });

  it('zapisuje nazwy środowisk, rozwiązując je po nazwie', async () => {
    // Identyfikator środowiska powstaje dopiero w `seedEnvironments`,
    // więc seed musi go odzyskać po nazwie — zapisane UUID z kodu
    // wypełniłoby relację cudzym identyfikatorem albo wywalłłoby się.
    const { prisma, wywolania } = atrapata();
    await seedDemoApplications(prisma);

    const create = wywolania[0].create.environments as {
      create: { environment: { connect: { name: string } } }[];
    };

    assert.equal(
      typeof create.create[0].environment.connect.name,
      'string',
      'relacja musi wskazywać środowisko nazwą, nie identyfikatorem',
    );
    assert.ok(
      create.create.length > 0,
      'rekord bez środowisk nie pojawi się w filtrze po środowisku',
    );
  });

  it('przy aktualizacji czyści stare przypisania do środowisk', async () => {
    // Bez `deleteMany` zmiana środowisk w pliku nigdy by nie doszła do
    // bazy: rekord wyglądałby na zaktualizowany, a filtrowałby się
    // według starych środowisk.
    const { prisma, wywolania } = atrapata();
    await seedDemoApplications(prisma);

    for (const w of wywolania) {
      const env = w.update.environments as Record<string, unknown>;
      assert.ok(
        'deleteMany' in env,
        `${w.where.name}: brak czyszczenia starych środowisk`,
      );
    }
  });
});

describe('Dane demonstracyjne', () => {
  it('jest dokładnie 20 programów na stanowisko', () => {
    assert.equal(
      DEMO_APPLICATIONS.length,
      20,
      'liczba zmienia się wtedy i tylko wtedy, gdy świadomie dodajemy ' +
        'albo usuwamy program — nie „dokładamy do dwudziestu"',
    );
  });

  it('każdy rekord przechodzi walidację jak ładunek z formularza', async () => {
    for (const record of DEMO_APPLICATIONS) {
      const errors = await errorsFor(record as Record<string, unknown>);
      assert.deepEqual(
        errors,
        [],
        `${record.name}: ${errors.join('; ')} — seed omija DTO, więc jedyne ` +
          'co pilnuje poprawności, to ten test',
      );
    }
  });

  it('żaden rekord nie ma pustego pola, które pokazuje strona szczegółów', () => {
    for (const record of DEMO_APPLICATIONS) {
      for (const field of COMPLETE) {
        const value = (record as Record<string, unknown>)[field];
        assert.notEqual(
          value,
          undefined,
          `${record.name}: brak pola ${field} — w UI wygląda to jak pusty wpis`,
        );
        assert.notEqual(
          value,
          null,
          `${record.name}: pole ${field} jest null — to ta sama pustka`,
        );
        assert.notEqual(
          String(value).trim(),
          '',
          `${record.name}: pole ${field} jest puste`,
        );
      }
    }
  });

  it('nazwy są unikalne — inaczej upsert nadpisuje rekordy między sobą', () => {
    const names = DEMO_APPLICATIONS.map((r) => r.name.toLowerCase());
    assert.equal(
      new Set(names).size,
      names.length,
      `powtórzone nazwy: ${names.filter((n, i) => names.indexOf(n) !== i).join(', ')}`,
    );
  });

  it('wszystkie rekordy są typu GENERAL_USE', () => {
    const inne = DEMO_APPLICATIONS.filter((r) => r.deliveryType !== 'GENERAL_USE');
    assert.deepEqual(
      inne.map((r) => r.name),
      [],
      'ten zestaw to programy na stanowisku; usługi hostowane opisuje ' +
        'osobny zbiór danych',
    );
  });

  it('pokrywa wszystkie statusy, klasyfikacje i poziomy krytyczności', () => {
    // Cel: filtry na liście i kafelki na pulpicie mają co pokazać.
    // Brak którejkolwiek z tych wartości znaczy, że wariant w UI nigdy
    // nie zostanie zobaczony — a nie da się go potem sprawdzić.
    const stany = {
      status: ['PROD', 'TEST', 'DEV', 'PLANNED', 'DEPRECATED'],
      securityClass: ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'],
      criticality: [1, 2, 3, 4],
    } as const;

    for (const [pole, oczekiwane] of Object.entries(stany)) {
      const obecne = new Set(
        DEMO_APPLICATIONS.map((r) => (r as Record<string, unknown>)[pole]),
      );
      const brak = oczekiwane.filter((v) => !obecne.has(v));
      assert.deepEqual(
        brak,
        [],
        `brak wartości ${pole}: ${brak.join(', ')} — wariant nie pojawi się w UI`,
      );
    }
  });

  it('wycofywane programy mają datę zakończenia, reszta nie', () => {
    // Data przy aktywnym programie to w UI niespójność: komunikat
    // ostrzega przed terminem, którego nie ma.
    for (const record of DEMO_APPLICATIONS) {
      if (record.status === 'DEPRECATED') {
        assert.ok(
          record.sunsetOn,
          `${record.name}: status DEPRECATED bez sunsetOn`,
        );
      } else {
        assert.equal(
          record.sunsetOn,
          undefined,
          `${record.name}: aktywny program (${record.status}) ma sunsetOn`,
        );
      }
    }
  });

  it('wszyscy właściciele należą do jednej organizacji', () => {
    // Właściciele z różnych domen wyglądają jak dane z trzech różnych
    // firm. Adresy **wsparcia dostawcy** są z definicji obce — tego
    // pilnuje następny przypadek.
    const domeny = new Set(
      DEMO_APPLICATIONS.map((r) => (r.ownerEmail as string).split('@')[1]),
    );

    assert.equal(
      domeny.size,
      1,
      `domeny właścicieli: ${[...domeny].join(', ')}`,
    );
  });

  it('kontakt do wsparcia zgadza się z tym, kto ma obowiązek wsparcia', () => {
    // `supportOwnerType: VENDOR` z adresem wewnętrznym to rekord, który
    // w UI pokazuje „napisz do nas" i kieruje człowieka do działu, który
    // problemu nie obsługuje — i nic w interfejsie tego nie sygnalizuje.
    for (const record of DEMO_APPLICATIONS) {
      const domenaWlasciciela = (record.ownerEmail as string).split('@')[1];
      const domenaWsparcia = (record.supportEmail as string).split('@')[1];

      if (record.supportOwnerType === 'VENDOR') {
        assert.notEqual(
          domenaWsparcia,
          domenaWlasciciela,
          `${record.name}: wsparcie po stronie dostawcy, a adres prowadzi ` +
            'do organizacji',
        );
      } else {
        assert.equal(
          domenaWsparcia,
          domenaWlasciciela,
          `${record.name}: wsparcie wewnętrzne, a adres jest obcy`,
        );
      }
    }
  });

  it('każdy program ma przypisane przynajmniej jedno środowisko', () => {
    // Filtr „środowisko" bez przypisań zwraca pustą listę, a nie błąd —
    // i nie da się odróżnić zepsutego danych od pustego wyniku.
    const bez = DEMO_APPLICATIONS.filter((r) => !r.environments?.length);
    assert.deepEqual(
      bez.map((r) => r.name),
      [],
    );
  });

  it('pola tylko dla usług hostowanych są puste', () => {
    // `baseUrl`, `hostingLocation` i `adminTeam` nie są pokazywane dla
    // `GENERAL_USE`. Wypełnienie ich wprowadzałoby dane, których nie da
    // się zobaczyć w UI i które wyglądałyby na zaniedbane.
    for (const record of DEMO_APPLICATIONS) {
      for (const pole of ['baseUrl', 'hostingLocation', 'adminTeam']) {
        assert.equal(
          (record as Record<string, unknown>)[pole],
          undefined,
          `${record.name}: ${pole} nie jest pokazywane dla GENERAL_USE`,
        );
      }
    }
  });
});