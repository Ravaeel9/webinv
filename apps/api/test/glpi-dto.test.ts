/**
 * DTO importu GLPI — walidacja typu dostarczenia wiersza oprogramowania.
 *
 * Analogicznie do `access-dto.test.ts`: bez bazy, `validate()` na
 * ztransformowanym obiekcie to dokładnie to, co robi produkcyjny
 * `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, transform).
 */
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ImportGlpiDto } from '../src/glpi/dto/glpi.dto';

async function bledy(dto: object): Promise<string[]> {
  const instancja = plainToInstance(ImportGlpiDto, dto);
  const wynik = await validate(instancja as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  // Błędy wierszy siedzą zagnieżdżone w `children` (@ValidateNested) —
  // same `constraints` wierzchołka są wtedy puste.
  const zbieraj = (blad: (typeof wynik)[number]): string[] => [
    ...Object.values(blad.constraints ?? {}),
    ...(blad.children ?? []).flatMap((dziecko) => zbieraj(dziecko)),
  ];
  return wynik.flatMap(zbieraj);
}

function payload(software: Array<Record<string, unknown>>): object {
  return { sections: ['software'], software };
}

describe('DTO importu GLPI — typ dostarczenia oprogramowania', () => {
  it('przyjmuje każdą wartość enumu DeliveryType', async () => {
    for (const deliveryType of ['GENERAL_USE', 'SELF_HOSTED', 'SAAS', 'VENDOR_MANAGED']) {
      const wynik = await bledy(payload([{ name: 'Aplikacja', deliveryType }]));
      assert.equal(wynik.length, 0, `wartość ${deliveryType} ma być poprawna`);
    }
  });

  it('odrzuca wartość spoza enumu, zanim trafi do serwisu', async () => {
    const wynik = await bledy(payload([{ name: 'Aplikacja', deliveryType: 'CHMURA_OBCA' }]));
    assert.ok(
      wynik.some((b) => b.includes('typ dostarczenia')),
      'komunikat ma mówić o typie dostarczenia',
    );
  });

  it('pole jest opcjonalne — brak typu nie odrzuca wiersza', async () => {
    const wynik = await bledy(payload([{ name: 'Aplikacja', version: '1.0' }]));
    assert.equal(wynik.length, 0);
  });
});
