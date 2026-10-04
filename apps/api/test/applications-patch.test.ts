/**
 * Testy logiki PATCH dla aplikacji.
 *
 * Wcześniejszy błąd przeszedł przez 143 testy, bo testowały wyłącznie
 * DTO, a nie serwis: `mapPatchDto` sprawdzał `'name' in dto`, a `PartialType`
 * z `@nestjs/mapped-types` kopiuje tylko metadane walidacji i **nie** tworzy
 * właściwości na prototypie. Sprawdzenie `in` widziało więc wyłącznie to,
 * co przyszło w ładunku — i rzucało wyjątkiem przy każdym częściowym
 * PATCH, czyli HTTP 500 zamiast zapisu.
 *
 * Te testy sięgają po `mapPatchDto` bez bazy: metoda jest czysta wobec
 * `this.mapDto`, więc wystarczy zawołać ją na prototypie z minimalnym
 * kontekstem.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ApplicationsService,
  buildOrderBy,
  isoDate,
} from '../src/applications/applications.service';
import {
  CREATE_FIELDS,
  CreateApplicationDto,
  UpdateApplicationDto,
  declaredFields,
} from '../src/applications/dto/application.dto';

/** Pusty kontekst — `mapPatchDto` nie dotyka bazy ani `this`. */
function service(): ApplicationsService {
  return new ApplicationsService({} as never, {} as never);
}

/** PATCH przez potok, którym przechodzi żądanie w produkcji. */
function patch(payload: Record<string, unknown>) {
  const dto = plainToInstance(UpdateApplicationDto, payload, {
    enableImplicitConversion: false,
  });
  // `mapPatchDto` jest prywatne — sięgamy przez prototyp, bo testujemy
  // dokładnie tę funkcję, a nie jej publiczną otoczkę.
  return (
    service() as unknown as {
      mapPatchDto: (d: UpdateApplicationDto) => Record<string, unknown>;
    }
  ).mapPatchDto(dto);
}

describe('mapPatchDto — pola obecne w ładunku', () => {
  it('nawet pusty PATCH nie wywala — to był błąd produkcyjny', () => {
    // Ten test odtwarza dokładnie sytuację z kontenera: brak `name`
    // w ładunku nie może kończyć się wyjątkiem.
    assert.doesNotThrow(() => patch({}));
    assert.deepEqual(patch({}), {});
  });

  it('częściowy PATCH zawiera tylko nadane pola', () => {
    assert.deepEqual(patch({ vendor: 'Dostawca' }), { vendor: 'Dostawca' });
  });

  it('nie zeruje pól pominiętych w ładunku', () => {
    // Sedno semantyki scalania: `securityClass` nieobecne nie może
    // zostać nadpisane wartością domyślną z `mapDto`.
    const data = patch({ vendor: 'Dostawca' });
    assert.equal('securityClass' in data, false);
    assert.equal('criticality' in data, false);
    assert.equal('status' in data, false);
    assert.equal('description' in data, false);
    assert.equal('ownerId' in data, false);
  });

  it('null czyści pole, a nie pomija go', () => {
    // Formularz wysyła `null` dla pustego pola — musi wyczyścić.
    const data = patch({ description: null, vendor: null });
    assert.equal('description' in data, true);
    assert.strictEqual(data.description, null);
    assert.strictEqual(data.vendor, null);
  });

  it('null na polu wymaganym daje wartość domyślną, nie błąd', () => {
    // `securityClass`, `criticality` i `status` są w schemacie bez `null`
    // (`@default(...)`), więc `null` nie może oznaczać „wyczyść" —
    // `mapDto` zamienia go na wartość domyślną. Pusty formularz
    // nie może więc wyzerować klasyfikacji bezpieczeństwa aplikacji.
    assert.strictEqual(patch({ securityClass: null }).securityClass, 'INTERNAL');
    assert.strictEqual(patch({ status: null }).status, 'PROD');
    assert.strictEqual(patch({ criticality: null }).criticality, 2);
    assert.strictEqual(patch({ deliveryType: null }).deliveryType, 'GENERAL_USE');
  });

  it('nie ma już pola category', () => {
    // Zmienna natury: po przebudowie kategorii `category` nie istnieje.
    // Gdyby ktoś zostawił je w DTO, wracałby stary sposób opisywania
    // aplikacji i rozjechałyby się z dashboardem.
    assert.equal(CREATE_FIELDS.has('category'), false);
  });

  it('blok wsparcia da się wyczyścić zerami', () => {
    // Wyjątek od reguły „null czyści": `GENERAL_USE` nie znaczy
    // „nie wiem", tylko „nie hostujemy usługi" — więc zmiana typu
    // musi działać, choćby przy okazji zostawiła dane wsparcia w bazie.
    const data = patch({
      deliveryType: 'GENERAL_USE',
      supportEmail: null,
      supportNotes: null,
    });
    assert.strictEqual(data.deliveryType, 'GENERAL_USE');
    assert.strictEqual(data.supportEmail, null);
  });

  it('pusty string nie jest wysyłany (transform zamienia go na undefined)', () => {
    const data = patch({ vendor: '' });
    assert.equal('vendor' in data, false, 'puste pole nie powinno być zapisywane');
  });

  it('konwertuje tekst na liczbę', () => {
    const data = patch({ criticality: '4', licenseCount: '150' });
    assert.strictEqual(data.criticality, 4);
    assert.strictEqual(data.licenseCount, 150);
  });

  it('daty zamienia na obiekty Date', () => {
    const data = patch({ introducedOn: '2023-03-15' }) as {
      introducedOn: Date;
    };
    assert.ok(data.introducedOn instanceof Date);
    assert.equal(data.introducedOn.toISOString().slice(0, 10), '2023-03-15');
  });

  it('obsługuje wiele pól naraz', () => {
    const data = patch({
      vendor: 'Nowy',
      criticality: 3,
      description: null,
      websiteUrl: 'https://crm.example.pl',
    });
    assert.deepEqual(Object.keys(data).sort(), [
      'criticality',
      'description',
      'vendor',
      'websiteUrl',
    ].sort());
  });
});

describe('CREATE_FIELDS — deklaracja DTO', () => {
  it('zawiera pola wymagane i wszystkie opcjonalne', () => {
    // Pełna lista zgodna z `CreateApplicationDto`. Gdyby tu czegoś
    // brakowało, `mapPatchDto` odrzuciłby to pole jako niezadeklarowane.
    for (const field of [
      'name',
      'version',
      'deliveryType',
      'baseUrl',
      'hostingLocation',
      'adminTeam',
      'supportOwnerType',
      'supportOwnerName',
      'supportEmail',
      'supportUrl',
      'supportChannel',
      'supportNotes',
      'description',
      'purpose',
      'ownerEmail',
      'adminIds',
      'introducedOn',
      'sunsetOn',
      'securityClass',
      'criticality',
      'status',
      'vendor',
      'license',
      'licenseCount',
      'annualCost',
      'environmentIds',
      'websiteUrl',
      'docsUrl',
      'repoUrl',
      'runbookUrl',
      'integrations',
    ]) {
      assert.equal(CREATE_FIELDS.has(field), true, `brakuje pola ${field}`);
    }
  });

  it('nie zawiera pól spoza DTO', () => {
    assert.equal(CREATE_FIELDS.has('id'), false);
    assert.equal(CREATE_FIELDS.has('createdById'), false);
  });

  it('jest niezależny od zawartości ładunku', () => {
    // Ten sam zestaw niezależnie od tego, co przyszło — to właśnie
    // odróżnia go od `key in dto`.
    const before = new Set(CREATE_FIELDS);
    plainToInstance(UpdateApplicationDto, { vendor: 'x' });
    assert.deepEqual([...CREATE_FIELDS].sort(), [...before].sort());
    assert.equal(CREATE_FIELDS.has('name'), true);
  });

  it('declaredFields działa też dla innych klas', () => {
    const fields = declaredFields(CreateApplicationDto);
    assert.equal(fields.has('name'), true);
    assert.equal(fields.has('criticality'), true);
  });
});

describe('PATCH przechodzi walidację tak samo jak produkcja', () => {
  it('pusty PATCH jest poprawny', async () => {
    const dto = plainToInstance(UpdateApplicationDto, {});
    const errors = await validate(dto as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    assert.deepEqual(
      errors.map((e) => Object.values(e.constraints ?? {})),
      [],
    );
  });

  it('odrzuca nieznane pole', async () => {
    const dto = plainToInstance(UpdateApplicationDto, { hack: 1 });
    const errors = await validate(dto as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    assert.equal(errors.length > 0, true);
  });

  it('odrzuca złą wartość pola obecnego', async () => {
    const dto = plainToInstance(UpdateApplicationDto, { criticality: 99 });
    const errors = await validate(dto as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    assert.equal(errors.length > 0, true);
  });
});

describe('isoDate — helper scalania dat', () => {
  it('zamienia Date na RRRR-MM-DD', () => {
    assert.equal(isoDate(new Date('2023-03-15T00:00:00Z')), '2023-03-15');
  });

  it('null daje undefined, nie "null"', () => {
    // `undefined` znaczy „brak daty w rekordzie”; string „null" przeszedłby
    // do `new Date()` i dał Invalid Date.
    assert.equal(isoDate(null), undefined);
  });
});

describe('buildOrderBy — biała lista sortowania', () => {
  // Wynik to tablica obiektów, bo Prisma przyjmuje `orderBy` jako listę
  // (dla stabilnego sortowania przy remisach).
  it('przepuszcza znaną kolumnę', () => {
    assert.deepEqual(buildOrderBy('name'), [{ name: 'asc' }]);
  });

  it('minus odwraca kierunek', () => {
    assert.deepEqual(buildOrderBy('-name'), [{ name: 'desc' }]);
  });

  it('odwraca również kierunek domyślny z białej listy', () => {
    // `criticality` ma w SORTABLE `desc` (najwyższa krytyczność pierwsza),
    // więc `-criticality` musi dać `asc` — inaczej kliknięcie w nagłówek
    // niczego by nie zmieniało.
    assert.deepEqual(buildOrderBy('criticality'), [{ criticality: 'desc' }]);
    assert.deepEqual(buildOrderBy('-criticality'), [{ criticality: 'asc' }]);
  });

  it('odrzuca nieznaną kolumnę zamiast przekazywać ją do ORDER BY', () => {
    // Nazwa kolumny trafia do zapytania — biała lista chroni przed
    // wstrzyknięciem dowolnego wyrażenia.
    assert.deepEqual(buildOrderBy('; DROP TABLE "Application"; --'), [
      { name: 'asc' },
    ]);
  });

  it('nieznana kolumna z minusem też wypada na default', () => {
    assert.deepEqual(buildOrderBy('-hack'), [{ name: 'asc' }]);
  });

  it('sama nazwa kolumny spoza listy to default', () => {
    // `passwordHash` jest prawdziwą kolumną, ale nie wolno po niej sortować.
    assert.deepEqual(buildOrderBy('passwordHash'), [{ name: 'asc' }]);
  });

  it('pusta wartość daje sortowanie domyślne', () => {
    assert.deepEqual(buildOrderBy(undefined), [{ name: 'asc' }]);
    assert.deepEqual(buildOrderBy(''), [{ name: 'asc' }]);
  });

  it('sam minus to default, nie wszystkie kolumny malejąco', () => {
    assert.deepEqual(buildOrderBy('-'), [{ name: 'asc' }]);
  });
});