/**
 * Usługi demonstracyjne — 5 SaaS i 5 na własnej infrastrukturze.
 *
 * Osobny plik od `demo-applications.test.ts`, bo to inny typ dostarczenia
 * i inny zestaw pól: dochodzą `baseUrl`, `hostingLocation` i `adminTeam`,
 * a strona szczegółów renderuje dla tych rekordów sekcję „Dostęp i wsparcie",
 * której przy `GENERAL_USE` nie ma. Trzymanie ich osobno pilnuje, żeby
 * różnica pozostała widoczna w kodzie, który ją opisuje.
 *
 * Te dane weryfikują dokładnie tymi samym walidatorami, co ładunek
 * z formularza — seed zapisuje do bazy z pominięciem DTO.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateApplicationDto } from '../src/applications/dto/application.dto';
import { DEMO_SERVICES } from '../src/seed/demo-services';

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

/** Pola, które wypełnia wyłącznie sekcja „Dostęp i wsparcie". */
const BLOK_USLUGI = ['baseUrl', 'hostingLocation', 'adminTeam'] as const;

const SAA = DEMO_SERVICES.filter((r) => r.deliveryType === 'SAAS');
const ON_PREM = DEMO_SERVICES.filter((r) => r.deliveryType === 'SELF_HOSTED');

describe('Usługi demonstracyjne', () => {
  it('jest pięć SaaS i pięć na własnej infrastrukturze', () => {
    assert.equal(SAA.length, 5);
    assert.equal(ON_PREM.length, 5);
    assert.equal(
      DEMO_SERVICES.length,
      10,
      'liczba zmienia się świadomie, nie „dokładaniem do dziesięciu"',
    );
  });

  it('każdy rekord przechodzi walidację jak ładunek z formularza', async () => {
    for (const record of DEMO_SERVICES) {
      const errors = await errorsFor(record as Record<string, unknown>);
      assert.deepEqual(
        errors,
        [],
        `${record.name}: ${errors.join('; ')} — seed omija DTO, więc jedyne ` +
          'co pilnuje poprawności, to ten test',
      );
    }
  });

  it('każda usługa ma komplet pól bloku „dostęp i wsparcie"', () => {
    // Puste `baseUrl` przy usłudze to rekord bez adresu — w UI puste pole
    // w sekcji, która właśnie po to sekcję ma.
    for (const record of DEMO_SERVICES) {
      for (const pole of BLOK_USLUGI) {
        const wartosc = (record as Record<string, unknown>)[pole];
        assert.ok(
          typeof wartosc === 'string' && wartosc.trim().length > 0,
          `${record.name}: brak pola ${pole}`,
        );
      }
    }
  });

  it('adres bazowy usługi jest poprawnym adresem https', () => {
    // Walidacja DTO przyjmuje adres bez protokołu, ale w polu „Adres
    // bazowy" użytkownik klikalby w adres bez `https://`, który przeglądarka
    // potraktuje jako ścieżkę względną — i otworzyłby sam rejestr.
    for (const record of DEMO_SERVICES) {
      assert.match(
        record.baseUrl,
        /^https:\/\/[^\s]+$/,
        `${record.name}: baseUrl musi być pełnym adresem https`,
      );
    }
  });

  it('adres usługi hostowanej u nas prowadzi do naszej domeny', () => {
    // Własna infrastruktura, własny adres. Adres dostawcy w rekordzie
    // SELF_HOSTED znaczyłby, że opisaliśmy usługę, której nie hostujemy.
    for (const record of ON_PREM) {
      assert.match(
        record.baseUrl,
        /^https:\/\/[a-z0-9.-]*\.?firma\.pl(?::\d+)?(\/|$)/i,
        `${record.name}: adres ${record.baseUrl} nie jest adresem w naszej domenie`,
      );
    }
  });

  it('usługa SaaS wskazuje adres u dostawcy, nie u nas', () => {
    for (const record of SAA) {
      assert.ok(
        !/\.firma\.pl/.test(record.baseUrl),
        `${record.name}: usługa SaaS nie powinna mieć adresu w naszej domenie`,
      );
    }
  });

  it('wsparcie zgadza się z tym, kto hostuje usługę', () => {
    // Usługa na naszej infrastrukturze, do której nie mamy umowy ze
    // wsparciem zewnętrznym, zgłasza się do nas. Odwrotnie: wsparcie
    // dostawcy dla usługi, którą sami hostujemy, kieruje do kogoś,
    // kto tej usługi nie zna.
    for (const record of ON_PREM) {
      assert.equal(
        record.supportOwnerType,
        'INTERNAL',
        `${record.name}: hostujemy ją sami, więc wsparcie jest nasze`,
      );
    }

    for (const record of SAA) {
      assert.equal(
        record.supportOwnerType,
        'VENDOR',
        `${record.name}: usługa u dostawcy, więc wsparcie jest po jego stronie`,
      );
      assert.notEqual(
        (record.supportEmail as string).split('@')[1],
        (record.ownerEmail as string).split('@')[1],
        `${record.name}: wsparcie SaaS musi prowadzić do dostawcy`,
      );
    }
  });

  it('runbook ma każda usługa hostowana u nas', () => {
    // Bez runbooka awarię obsługuje ten, kto pierwszy zobaczy alarm.
    for (const record of ON_PREM) {
      assert.match(
        record.runbookUrl,
        /^https:\/\//,
        `${record.name}: usługa na naszej infrastrukturze bez runbooka`,
      );
    }
  });

  it('nazwy są unikalne', () => {
    const names = DEMO_SERVICES.map((r) => r.name.toLowerCase());
    assert.equal(
      new Set(names).size,
      names.length,
      `powtórzone nazwy: ${names.filter((n, i) => names.indexOf(n) !== i).join(', ')}`,
    );
  });

  it('pokrywa warianty, których nie ma w zestawie programów', () => {
    // Zestaw usług ma pokazywać filtry po statusie i klasyfikacji w rzucie
    // innym niż programy — inaczej w UI wygląda jak ta sama lista.
    const statusy = new Set(DEMO_SERVICES.map((r) => r.status));
    assert.ok(statusy.has('PROD'), 'brak usługi produkcyjnej');
    assert.ok(
      [...statusy].some((s) => s !== 'PROD'),
      'wszystkie usługi PROD — brak wariantu w filtrze statusu',
    );

    for (const securityClass of ['PUBLIC', 'CONFIDENTIAL', 'RESTRICTED']) {
      assert.ok(
        DEMO_SERVICES.some((r) => r.securityClass === securityClass),
        `brak usługi z klasyfikacją ${securityClass}`,
      );
    }

    assert.ok(
      DEMO_SERVICES.some((r) => r.criticality === 4),
      'brak usługi o krytyczności 4 — to najważniejszy wariant filtra',
    );
  });

  it('żadna usługa nie jest wycofywana', () => {
    // `sunsetOn` przy usłudze to rekord w trakcie likwidacji; żadna z tych
    // dziesięciu nią nie jest, a data wyglądałaby jak zobowiązanie.
    for (const record of DEMO_SERVICES) {
      assert.equal(
        record.sunsetOn,
        undefined,
        `${record.name}: usługa ma datę zakończenia`,
      );
    }
  });

  it('usługi kosztują albo są hostowane przez nas', () => {
    // Usługa SaaS z zerowym kosztem rocznym wygląda jak darmowa, a w
    // rejestrze liczbę czytają kierownicy przy planowaniu budżetu.
    for (const record of DEMO_SERVICES) {
      assert.ok(
        record.annualCost > 0,
        `${record.name}: roczny koszt ${record.annualCost} wygląda jak puste pole`,
      );
    }
  });
});