/**
 * Testy walidacji ładunków IPAM (podsieci, adresy, przypisania).
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
  CreateAddressDto,
  CreateSubnetDto,
  IP_STATUSES,
  SetApplicationIpAddressesDto,
  UpdateAddressDto,
  UpdateSubnetDto,
} from '../src/ipam/dto/ipam.dto';
import { cidrErrorMessage } from '../src/ipam/cidr';

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
const UUID_B = '22222222-2222-4222-8222-222222222222';

describe('CreateSubnetDto', () => {
  it('przyjmuje minimalny poprawny rekord', async () => {
    const { errors } = await check(CreateSubnetDto, {
      name: 'Sieć produkcyjna',
      cidr: '10.20.0.0/16',
    });
    assert.deepEqual(errors, []);
  });

  it('przyjmuje kompletny rekord', async () => {
    const { errors } = await check(CreateSubnetDto, {
      name: 'Sieć produkcyjna',
      cidr: '10.20.0.0/16',
      description: 'Rdzeń sieci campuses',
      color: 'sky',
      vlan: 100,
      location: 'Serwerownia A',
    });
    assert.deepEqual(errors, []);
  });

  it('odrzuca pustą nazwę ze spacjami', async () => {
    const { errors } = await check(CreateSubnetDto, {
      name: '   ',
      cidr: '10.20.0.0/16',
    });
    assert.equal(errors.length > 0, true, 'samo spacje to nie nazwa');
  });

  it('odrzuca cidr z bitami hosta komunikatem zawierającym „sieć”', async () => {
    const { errors } = await check(CreateSubnetDto, {
      name: 'X',
      cidr: '10.20.1.5/24',
    });
    assert.equal(
      errors.some((e) => e.includes('sieć')),
      true,
      `oczekiwany komunikat o sieci, a było: ${errors.join(', ')}`,
    );
  });

  it('komunikat cidr jest dokładnie wartością z cidrErrorMessage', async () => {
    // UI pokazuje ten komunikat wprost, bez przetłumaczeń — więc DTO
    // nie wolno dorabiać własnej tre ani otoczki.
    const bad = '10.20.1.5/24';
    const { errors } = await check(CreateSubnetDto, { name: 'X', cidr: bad });
    assert.equal(errors.length, 1);
    assert.equal(
      errors[0],
      cidrErrorMessage(bad) as string,
      'walidator ma delegować komunikat 1:1 do cidr.ts',
    );
  });

  it('odrzuca cidr dłuższy niż 18 znaków', async () => {
    const { errors } = await check(CreateSubnetDto, {
      name: 'X',
      cidr: 'x'.repeat(19),
    });
    assert.equal(
      errors.some((e) => e.includes('18')),
      true,
      `oczekiwany komunikat o długości 18, a było: ${errors.join(', ')}`,
    );
  });

  it('odrzuca vlan poza zakresem 1-4094', async () => {
    for (const vlan of [0, 5000]) {
      const { errors } = await check(CreateSubnetDto, {
        name: 'X',
        cidr: '10.20.0.0/16',
        vlan,
      });
      assert.equal(errors.length > 0, true, `vlan=${vlan}`);
    }
  });

  it('akceptuje graniczne wartości vlan', async () => {
    for (const vlan of [1, 4094]) {
      const { errors } = await check(CreateSubnetDto, {
        name: 'X',
        cidr: '10.20.0.0/16',
        vlan,
      });
      assert.deepEqual(errors, [], `vlan=${vlan}`);
    }
  });

  it('odrzuca vlan, który nie jest liczbą', async () => {
    const { errors } = await check(CreateSubnetDto, {
      name: 'X',
      cidr: '10.20.0.0/16',
      vlan: 'dziesięć',
    });
    assert.equal(errors.length > 0, true);
  });

  it('pusty string w polu opcjonalnym to brak wartości, nie błąd', async () => {
    // Formularz wysyła "" dla niewypełnionych pól.
    const { instance, errors } = await check(CreateSubnetDto, {
      name: 'X',
      cidr: '10.20.0.0/16',
      description: '',
      color: '',
      location: '',
      vlan: '',
    });
    assert.deepEqual(errors, []);
    assert.equal(instance.description, undefined);
    assert.equal(instance.color, undefined);
    assert.equal(instance.location, undefined);
    assert.equal(instance.vlan, undefined);
  });

  it('odrzuca kolor z wielką literą lub cyfrą', async () => {
    // Kolor to nazwa tony kafelka (jak `slate` w schemacie), nie dowolny tekst.
    // Pusty string to „nie ustawiono” — sprawdza go osobno test wyżej.
    for (const color of ['Sky', 'sky-500', '#00a2ff']) {
      const { errors } = await check(CreateSubnetDto, {
        name: 'X',
        cidr: '10.20.0.0/16',
        color,
      });
      assert.equal(errors.length > 0, true, `kolor „${color}” nie powinien przejść`);
    }
  });
});

describe('CreateAddressDto', () => {
  it('przyjmuje minimalny poprawny rekord', async () => {
    const { errors } = await check(CreateAddressDto, {
      address: '10.20.1.15',
    });
    assert.deepEqual(errors, []);
  });

  it('odrzuca adres ze oktetem spoza zakresu komunikatem zawierającym „adres IP”', async () => {
    const { errors } = await check(CreateAddressDto, {
      address: '10.20.0.999',
    });
    assert.equal(
      errors.some((e) => e.includes('adres IP')),
      true,
      `oczekiwany komunikat o adresie IP, a było: ${errors.join(', ')}`,
    );
  });

  it('odrzuca adres z maską i adres niepełny', async () => {
    for (const address of ['10.20.0.0/16', '10.20.1', 'abc.def.ghi.jkl']) {
      const { errors } = await check(CreateAddressDto, { address });
      assert.equal(errors.length > 0, true, `„${address}” nie powinno przejść`);
    }
  });

  it('przyjmuje każdy zadeklarowany status i odrzuca obcy', async () => {
    for (const status of IP_STATUSES) {
      const { errors } = await check(CreateAddressDto, {
        address: '10.20.1.15',
        status,
      });
      assert.deepEqual(errors, [], `status=${status}`);
    }
    const { errors } = await check(CreateAddressDto, {
      address: '10.20.1.15',
      status: 'ZYJE',
    });
    assert.equal(errors.length > 0, true);
  });
});

describe('UpdateSubnetDto i UpdateAddressDto (PATCH)', () => {
  it('akceptują pusty ładunek', async () => {
    const subnet = await check(UpdateSubnetDto, {});
    assert.deepEqual(subnet.errors, [], 'pusty PATCH nie powinien być błędem walidacji');
    const address = await check(UpdateAddressDto, {});
    assert.deepEqual(address.errors, []);
  });

  it('nadal walidują te pola, które są — w tym delegację do cidrErrorMessage', async () => {
    // `PartialType` musi przenosić własne walidatory razem z resztą
    // metadanych; gdyby zgubił `@ValidateBy`, PATCH przepuściłby hosta
    // zamiast sieci.
    const { errors } = await check(UpdateSubnetDto, { cidr: '10.20.1.5/24' });
    assert.equal(errors.length, 1);
    assert.equal(errors[0], cidrErrorMessage('10.20.1.5/24') as string);

    const { errors: e2 } = await check(UpdateAddressDto, { address: '10.20.0.999' });
    assert.equal(e2.some((e) => e.includes('adres IP')), true);
  });

  it('null przy opcjonalnych polach oznacza „wyczyść”, a nie „brak”', async () => {
    const { instance, errors } = await check(UpdateSubnetDto, {
      vlan: null,
      location: null,
    });
    assert.deepEqual(errors, []);
    assert.strictEqual(instance.vlan, null);
    assert.strictEqual(instance.location, null);
  });
});

describe('SetApplicationIpAddressesDto', () => {
  it('akceptuje listę identyfikatorów', async () => {
    const { errors } = await check(SetApplicationIpAddressesDto, {
      ipAddressIds: [UUID_A, UUID_B],
    });
    assert.deepEqual(errors, []);
  });

  it('akceptuje pustą listę — oznacza „odpiąć wszystkie”', async () => {
    const { errors } = await check(SetApplicationIpAddressesDto, {
      ipAddressIds: [],
    });
    assert.deepEqual(errors, []);
  });

  it('odrzuca nie-UUID w liście', async () => {
    const { errors } = await check(SetApplicationIpAddressesDto, {
      ipAddressIds: [UUID_A, 'nie-uuid'],
    });
    assert.equal(errors.length > 0, true);
  });

  it('odrzuca listę dłuższą niż 100', async () => {
    const many = Array.from({ length: 101 }, () => UUID_A);
    const { errors } = await check(SetApplicationIpAddressesDto, {
      ipAddressIds: many,
    });
    assert.equal(
      errors.some((e) => e.includes('100')),
      true,
      `oczekiwany komunikat o limicie: ${errors.join(', ')}`,
    );
  });
});
