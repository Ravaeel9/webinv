/**
 * Testy walidacji ładunków aplikacji.
 *
 * Testy używają dokładnie tych opcji `class-transformer`/`class-validator`,
 * co `ValidationPipe` w `main.ts` — inaczej testy sprawdzałyby inną
 * konfigurację niż produkcja i nie łapałyby regresji.
 *
 * Bez bazy: `validate()` na ztransformowanym obiekcie to dokładnie to,
 * co robi pipe przed wejściem do serwisu.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  APP_STATUSES,
  CreateApplicationDto,
  ListApplicationsQuery,
  SECURITY_CLASSES,
  UpdateApplicationDto,
} from '../src/applications/dto/application.dto';

/**
 * Opcje muszą pokrywać się z `ValidationPipe` w src/main.ts.
 *
 * `enableImplicitConversion: false` — konwersję robią wyłącznie
 * własne `@Transform`. Z włączoną konwersją domyślną wyniki tych
 * testów nie odpowiadałyby produkcji (patrz komentarz w main.ts).
 */
const TRANSFORM_OPTIONS = { enableImplicitConversion: false } as const;

async function check<T extends object>(
  cls: new () => T,
  payload: Record<string, unknown>,
): Promise<{ instance: T; errors: string[] }> {
  const instance = plainToInstance(cls, payload, TRANSFORM_OPTIONS);
  const errors = await validate(instance as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return {
    instance,
    errors: errors.map((e) => Object.values(e.constraints ?? {}).join('; ')),
  };
}

const UUID_A = '11111111-1111-4111-8111-111111111111';

describe('CreateApplicationDto', () => {
  it('przyjmuje minimalny poprawny rekord', async () => {
    const { errors } = await check(
      CreateApplicationDto,
      { name: 'CRM', version: '3.1.0' },
    );
    assert.deepEqual(errors, []);
  });

  it('wymaga nazwy', async () => {
    const { errors } = await check(CreateApplicationDto, { version: '1.0' });
    assert.equal(errors.length > 0, true, 'brak nazwy powinien być błędem');
  });

  it('wymaga wersji', async () => {
    const { errors } = await check(CreateApplicationDto, { name: 'CRM' });
    assert.equal(errors.length > 0, true, 'brak wersji powinien być błędem');
  });

  it('odrzuca pustą nazwę ze spacjami', async () => {
    const { errors } = await check(CreateApplicationDto, {
      name: '   ',
      version: '1.0',
    });
    assert.equal(errors.length > 0, true);
  });

  it('odrzuca wersję ze samych spacji', async () => {
    const { errors } = await check(CreateApplicationDto, {
      name: 'CRM',
      version: '   ',
    });
    assert.equal(errors.length > 0, true);
  });

  it('nie odrzuca nazwy ze spacjami wewnątrz', async () => {
    const { errors } = await check(CreateApplicationDto, {
      name: 'System CRM sprzedaży',
      version: '3.1.0',
    });
    assert.deepEqual(errors, []);
  });

  it('puste liczby nie zamieniają się w zero', async () => {
    // `Number('') === 0` — bez własnej konwersji puste pole kosztu
    // zapisałoby się jako 0 zł zamiast „nie ustawiono".
    const { instance, errors } = await check(CreateApplicationDto, {
      name: 'CRM',
      version: '1.0',
      licenseCount: '',
      annualCost: '',
    });
    assert.deepEqual(errors, []);
    assert.equal(instance.licenseCount, undefined);
    assert.equal(instance.annualCost, undefined);
  });

  it('null przy liczbach oznacza „wyczyść", a nie „brak"', async () => {
    // Formularz wysyła null dla pustego pola. Gdyby transform zamienił
    // null na undefined, PATCH nie umiałby wyczyścić pojedynczego pola.
    const { instance, errors } = await check(UpdateApplicationDto, {
      licenseCount: null,
      annualCost: null,
    });
    assert.deepEqual(errors, []);
    assert.strictEqual(instance.licenseCount, null);
    assert.strictEqual(instance.annualCost, null);
  });

  it('zamienia tekst na liczbę dla pól liczbowych w ciele żądania', async () => {
    const { instance } = await check(CreateApplicationDto, {
      name: 'CRM',
      version: '1.0',
      criticality: '4',
      licenseCount: '150',
      annualCost: '48000.55',
    });
    assert.strictEqual(instance.criticality, 4);
    assert.strictEqual(instance.licenseCount, 150);
    assert.strictEqual(instance.annualCost, 48000.55);
  });

  it('odrzuca tekst, który nie jest liczbą', async () => {
    const { errors } = await check(CreateApplicationDto, {
      name: 'CRM',
      version: '1.0',
      criticality: 'dużo',
    });
    assert.equal(errors.length > 0, true);
  });

  it('odrzuca nazwę dłuższą niż 200 znaków', async () => {
    const { errors } = await check(CreateApplicationDto, {
      name: 'x'.repeat(201),
      version: '1.0',
    });
    assert.equal(errors.length > 0, true);
  });

  it('zgłasza nieznane pole zamiast go po cichu ignorować', async () => {
    const { errors } = await check(CreateApplicationDto, {
      name: 'CRM',
      version: '1.0',
      hack: 1,
    });
    assert.equal(
      errors.some((e) => e.includes('hack')),
      true,
      `komunikat powinien wymienić „hack": ${errors.join(', ')}`,
    );
  });

  it('zamienia pusty string na undefined', async () => {
    // Formularz wysyła "" dla niewypełnionych pól opcjonalnych.
    const { instance } = await check(CreateApplicationDto, {
      name: 'CRM',
      version: '1.0',
      vendor: '',
    });
    assert.equal(instance.vendor, undefined);
  });

  it('zachowuje null — w PATCH-u oznacza „wyczyść"', async () => {
    const { instance } = await check(UpdateApplicationDto, {
      vendor: null,
    });
    assert.equal(instance.vendor, null, 'null nie może zamienić się w undefined');
  });

  it('zamienia tekst na liczbę (jawnym @Transform)', async () => {
    const { instance } = await check(CreateApplicationDto, {
      name: 'CRM',
      version: '1.0',
      criticality: '4',
    });
    assert.strictEqual(instance.criticality, 4);
  });

  it('odrzuca krytyczność spoza zakresu 1-4', async () => {
    for (const criticality of [0, 5, -1]) {
      const { errors } = await check(CreateApplicationDto, {
        name: 'CRM',
        version: '1.0',
        criticality,
      });
      assert.equal(errors.length > 0, true, `criticality=${criticality}`);
    }
  });

  it('odrzuca ułamkową krytyczność', async () => {
    const { errors } = await check(CreateApplicationDto, {
      name: 'CRM',
      version: '1.0',
      criticality: 2.5,
    });
    assert.equal(errors.length > 0, true);
  });

  it('odrzuca nieznaną klasyfikację i status', async () => {
    const bad = await check(CreateApplicationDto, {
      name: 'CRM',
      version: '1.0',
      securityClass: 'TAJNE',
    });
    assert.equal(bad.errors.length > 0, true);

    const bad2 = await check(CreateApplicationDto, {
      name: 'CRM',
      version: '1.0',
      status: 'DZIALA',
    });
    assert.equal(bad2.errors.length > 0, true);
  });

  it('przyjmuje wszystkie zadeklarowane statusy i klasyfikacje', async () => {
    for (const status of APP_STATUSES) {
      const { errors } = await check(CreateApplicationDto, {
        name: 'CRM',
        version: '1.0',
        status,
      });
      assert.deepEqual(errors, [], `status=${status}`);
    }
    for (const securityClass of SECURITY_CLASSES) {
      const { errors } = await check(CreateApplicationDto, {
        name: 'CRM',
        version: '1.0',
        securityClass,
      });
      assert.deepEqual(errors, [], `securityClass=${securityClass}`);
    }
  });

  it('odrzuca datę w innym formacie niż RRRR-MM-DD', async () => {
    // `new Date('15.03.2023')` w JS to Invalid Date — mimo że
    // `enableImplicitConversion` potrafi tu przepuścić śmieci.
    for (const bad of ['15.03.2023', '2023/03/15', '15-03-2023', '2023-3-5']) {
      const { errors } = await check(CreateApplicationDto, {
        name: 'CRM',
        version: '1.0',
        introducedOn: bad,
      });
      assert.equal(
        errors.some((e) => e.includes('RRRR-MM-DD')),
        true,
        `introducedOn=${bad} powinien dać komunikat o formacie, a było: ${errors.join(', ')}`,
      );
    }
  });

  it('przyjmuje poprawną datę', async () => {
    const { errors } = await check(CreateApplicationDto, {
      name: 'CRM',
      version: '1.0',
      introducedOn: '2023-03-15',
      sunsetOn: '2026-11-15',
    });
    assert.deepEqual(errors, []);
  });

  it('przyjmuje identyfikator osoby jako właściciela', async () => {
    // Właściciel jest osobą z ewidencji (`persons`), więc walidacja DTO
    // sprawdza wyłącznie kształt UUID — istnienie w katalogu pilnuje
    // serwis (`assertPersonsExist`), nie format.
    const { errors } = await check(CreateApplicationDto, {
      name: 'CRM',
      version: '1.0',
      ownerId: UUID_A,
    });
    assert.deepEqual(errors, []);
  });

  it('odrzuca właściciela, który nie jest UUID osoby', async () => {
    for (const ownerId of ['admin', 'anna@firma', '@firma.local', 'a b@firma.local']) {
      const { errors } = await check(CreateApplicationDto, {
        name: 'CRM',
        version: '1.0',
        ownerId,
      });
      assert.equal(errors.length > 0, true, `„${ownerId}" nie powinno przejść`);
    }
  });

  it('pusty właściciel to brak właściciela, nie błąd', async () => {
    const { errors, instance } = await check(CreateApplicationDto, {
      name: 'CRM',
      version: '1.0',
      ownerId: '',
    });
    assert.deepEqual(errors, []);
    assert.equal(instance.ownerId, undefined);
  });

  it('odrzuca listę administratorów ze złym identyfikatorem', async () => {
    const { errors } = await check(CreateApplicationDto, {
      name: 'CRM',
      version: '1.0',
      adminIds: [UUID_A, 'nie-uuid'],
    });
    assert.equal(errors.length > 0, true);
  });

  it('odrzuca ponad 50 administratorów', async () => {
    const many = Array.from({ length: 51 }, () => UUID_A);
    const { errors } = await check(CreateApplicationDto, {
      name: 'CRM',
      version: '1.0',
      adminIds: many,
    });
    assert.equal(
      errors.some((e) => e.includes('50')),
      true,
      `oczekiwany komunikat o limicie: ${errors.join(', ')}`,
    );
  });

  it('odrzuca ujemny koszt i ujemną liczbę licencji', async () => {
    const { errors } = await check(CreateApplicationDto, {
      name: 'CRM',
      version: '1.0',
      annualCost: -1,
    });
    assert.equal(errors.length > 0, true);

    const { errors: e2 } = await check(CreateApplicationDto, {
      name: 'CRM',
      version: '1.0',
      licenseCount: -5,
    });
    assert.equal(e2.length > 0, true);
  });

  it('odrzuca koszt z więcej niż dwoma miejscami po przecinku', async () => {
    const { errors } = await check(CreateApplicationDto, {
      name: 'CRM',
      version: '1.0',
      annualCost: 12.345,
    });
    assert.equal(errors.length > 0, true);
  });

  it('odrzuca adres WWW, który nie jest adresem', async () => {
    const { errors } = await check(CreateApplicationDto, {
      name: 'CRM',
      version: '1.0',
      websiteUrl: 'to nie jest adres',
    });
    assert.equal(errors.length > 0, true);
  });

  it('przyjmuje adres bez protokołu', async () => {
    const { errors } = await check(CreateApplicationDto, {
      name: 'CRM',
      version: '1.0',
      websiteUrl: 'crm.firma.local',
    });
    assert.deepEqual(errors, []);
  });
});

describe('UpdateApplicationDto (PATCH)', () => {
  it('akceptuje pusty ładunek', async () => {
    const { errors } = await check(UpdateApplicationDto, {});
    assert.deepEqual(errors, [], 'pusty PATCH nie powinien być błędem walidacji');
  });

  it('nie wymaga nazwy ani wersji', async () => {
    const { errors } = await check(UpdateApplicationDto, { status: 'DEPRECATED' });
    assert.deepEqual(errors, []);
  });

  it('nadal waliduje te pola, które są', async () => {
    const { errors } = await check(UpdateApplicationDto, {
      status: 'NIEZNANY',
      criticality: 99,
    });
    assert.equal(errors.length >= 2, true, 'oba pola powinny zostać odrzucone');
  });

  it('nadal odrzuca nieznane pola', async () => {
    const { errors } = await check(UpdateApplicationDto, { hack: 1 });
    assert.equal(
      errors.some((e) => e.includes('hack')),
      true,
    );
  });

  it('zachowuje walidację formatu daty', async () => {
    const { errors } = await check(UpdateApplicationDto, {
      sunsetOn: '31.12.2026',
    });
    assert.equal(errors.length > 0, true);
  });
});

describe('ListApplicationsQuery', () => {
  it('domyślnie daje limit 50 i offset 0', async () => {
    const { instance } = await check(ListApplicationsQuery, {});
    assert.equal(instance.limit, 50);
    assert.equal(instance.offset, 0);
  });

  it('zamienia tekst na liczby', async () => {
    const { instance } = await check(ListApplicationsQuery, {
      limit: '20',
      offset: '40',
    });
    assert.strictEqual(instance.limit, 20);
    assert.strictEqual(instance.offset, 40);
  });

  it('puste parametry wracają do wartości domyślnych', async () => {
    // `<select>` z filtrami wysyła "", gdy nic nie wybrano.
    const { instance, errors } = await check(ListApplicationsQuery, {
      status: '',
      securityClass: '',
      deliveryType: '',
      criticality: '',
      limit: '',
      offset: '',
    });
    assert.deepEqual(errors, []);
    assert.equal(instance.limit, 50);
    assert.equal(instance.offset, 0);
    assert.equal(instance.criticality, undefined, 'pusty filtr = brak filtra');
  });

  it('odrzuca limit spoza zakresu', async () => {
    for (const limit of [0, 201, -1]) {
      const { errors } = await check(ListApplicationsQuery, { limit });
      assert.equal(errors.length > 0, true, `limit=${limit}`);
    }
  });

  it('odrzuca ujemny offset', async () => {
    const { errors } = await check(ListApplicationsQuery, { offset: -1 });
    assert.equal(errors.length > 0, true);
  });

  it('rozumie includeDeleted tylko jako „true"', async () => {
    const { instance: yes } = await check(ListApplicationsQuery, {
      includeDeleted: 'true',
    });
    assert.equal(yes.includeDeleted, true);

    const { instance: no } = await check(ListApplicationsQuery, {
      includeDeleted: 'false',
    });
    assert.equal(no.includeDeleted, false);

    const { instance: nada } = await check(ListApplicationsQuery, {
      includeDeleted: 'cokolwiek',
    });
    assert.equal(nada.includeDeleted, false);
  });

  it('odrzuca zbyt długą frazę wyszukiwania', async () => {
    const { errors } = await check(ListApplicationsQuery, { q: 'x'.repeat(201) });
    assert.equal(errors.length > 0, true);
  });

  it('odrzuca krytyczność spoza zakresu', async () => {
    const { errors } = await check(ListApplicationsQuery, { criticality: 9 });
    assert.equal(errors.length > 0, true);
  });

  it('nie odrzuca sortowania — waliduje je serwis na białej liście', async () => {
    // Parametr `sort` jest dowolnym tekstem, a nazwa kolumny trafia
    // do ORDER BY. Walidacja formatu nic tu nie daje, więc poprawność
    // pilnuje biała lista w `buildOrderBy`.
    const { errors } = await check(ListApplicationsQuery, {
      sort: '-criticality',
    });
    assert.deepEqual(errors, []);

    const { errors: long } = await check(ListApplicationsQuery, {
      sort: 'x'.repeat(51),
    });
    assert.equal(long.length > 0, true, 'bardzo długi sort powinien być odrzucony');
  });

  it('puste filtry numeryczne są bezpieczne także przy włączonej konwersji domyślnej', async () => {
    // Zabezpieczenie ustawienia z src/main.ts: `enableImplicitConversion`
    // działa PRZED `@Transform` i dla pól bez wartości początkowej bierze
    // typ z `design:type`, czyli `Number`. `?criticality=` zamieniało się
    // wtedy w `0` i walidacja odrzucała żądanie jako „poniżej 1".
    //
    // Ten test pilnuje, żeby ktoś nie włączył tej opcji z powrotem:
    // musiałby jednocześnie poprawić te przypadki.
    const instance = plainToInstance(
      ListApplicationsQuery,
      { criticality: '', limit: '', offset: '' },
      { enableImplicitConversion: true },
    );
    const errors = await validate(instance as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    assert.deepEqual(
      errors.map((e) => Object.values(e.constraints ?? {})),
      [],
      'puste parametry nie mogą być błędem niezależnie od konfiguracji',
    );
    assert.equal(instance.criticality, undefined);
    assert.equal(instance.limit, 50);
    assert.equal(instance.offset, 0);
  });

  it('odrzuca nieznany typ dostarczenia', async () => {
    const { errors } = await check(ListApplicationsQuery, {
      deliveryType: 'ON_PREMISE',
    });
    assert.equal(errors.length > 0, true);
  });
});

describe('deliveryType i blok wsparcia', () => {
  it('przyjmuje każdy z czterech typów dostarczenia', async () => {
    for (const deliveryType of [
      'GENERAL_USE',
      'SELF_HOSTED',
      'SAAS',
      'VENDOR_MANAGED',
    ]) {
      const { errors } = await check(CreateApplicationDto, {
        name: 'CRM',
        version: '1.0',
        deliveryType,
      });
      assert.deepEqual(errors, [], `deliveryType=${deliveryType}`);
    }
  });

  it('odrzuca typ spoza listy, komunikatem po polsku', async () => {
    const { errors } = await check(CreateApplicationDto, {
      name: 'CRM',
      version: '1.0',
      deliveryType: 'ON_PREMISE',
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Nieznany typ dostarczenia/);
  });

  it('pusty string w filtrze to brak filtra, nie błąd', async () => {
    // `<select>` z filtrami wysyła "", gdy nic nie wybrano.
    const { instance, errors } = await check(ListApplicationsQuery, {
      deliveryType: '',
    });
    assert.deepEqual(errors, []);
    assert.equal(instance.deliveryType, undefined);
  });

  it('przyjmuje kompletny opis usługi hostowanej', async () => {
    const { errors } = await check(CreateApplicationDto, {
      name: 'Jira',
      version: '2026.1',
      deliveryType: 'SAAS',
      baseUrl: 'https://jira.example.pl',
      hostingLocation: 'chmura dostawcy',
      adminTeam: 'Zespół Platformy',
      supportOwnerType: 'VENDOR',
      supportOwnerName: 'Atlassian',
      supportEmail: 'support@example.com',
      supportUrl: 'https://example.atlassian.net',
      supportChannel: 'PORTAL',
      supportNotes: 'Zgłoszenia przez Jira IT.',
    });
    assert.deepEqual(errors, []);
  });

  it('odrzuca zły e-mail do wsparcia', async () => {
    const { errors } = await check(CreateApplicationDto, {
      name: 'Jira',
      version: '1.0',
      supportEmail: 'nie-adres',
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /E-mail do wsparcia/);
  });

  it('odrzuca adres bazowy, który nie jest adresem', async () => {
    // Protokół jest opcjonalny (tak jak przy `websiteUrl`), więc sama
    // domena jest poprawna — odrzucić musi tekst z odstępem.
    const { errors } = await check(CreateApplicationDto, {
      name: 'Jira',
      version: '1.0',
      baseUrl: 'jira firma.example.pl',
    });
    assert.equal(errors.length, 1);
  });

  it('przyjmuje adres bazowy bez protokołu', async () => {
    const { errors } = await check(CreateApplicationDto, {
      name: 'Jira',
      version: '1.0',
      baseUrl: 'jira.example.pl',
    });
    assert.deepEqual(errors, []);
  });

  it('odrzuca nieznany kanał wsparcia', async () => {
    const { errors } = await check(CreateApplicationDto, {
      name: 'Jira',
      version: '1.0',
      supportChannel: 'KURIER',
    });
    assert.equal(errors.length, 1);
  });

  it('nie ma już pola category', async () => {
    // Po przebudowie kategorii na typ dostarczenia stare pole musi zniknąć,
    // inaczej wraca wolny tekst obok typu i dwa źródła prawdy.
    const { errors } = await check(CreateApplicationDto, {
      name: 'CRM',
      version: '1.0',
      category: 'Finanse',
    });
    assert.equal(errors.length > 0, true, 'category powinno być odrzucone');
  });

  it('puste pola wsparcia nie trafiają do ładunku', async () => {
    // Formularz wysyła "" dla niewypełnionych pól — transform musi je
    // zwinąć do `undefined`, inaczej każda pusta nazwa zespołu
    // zapisywałaby się jako pusty string zamiast zostawiać pole puste.
    // Sama właściwość na instancji zostaje (przyszła w ładunku),
    // liczy się jej wartość — to `undefined` znaczy „nie ruszaj".
    const { instance } = await check(CreateApplicationDto, {
      name: '7-Zip',
      version: '24.08',
      deliveryType: 'GENERAL_USE',
      supportEmail: '',
      supportOwnerName: '',
      supportNotes: '',
    });
    assert.equal(instance.supportEmail, undefined);
    assert.equal(instance.supportOwnerName, undefined);
    assert.equal(instance.supportNotes, undefined);
  });
});
