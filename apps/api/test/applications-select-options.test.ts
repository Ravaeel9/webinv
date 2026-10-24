/**
 * Słownik aplikacji dla selectów — `/applications/options`.
 *
 * Błąd, który to zamyka: select „Aplikacja" w macierzy uprawnień prosił
 * `GET /api/applications?limit=500`, a `ListApplicationsQuery` ma
 * `@Max(200)` — żądanie bierze 400, select na zawsze pokazuje tylko
 * „wszystkie", a błąd nikt nie wyświetla. Select nie potrzebuje
 * stronicowanego rejestru — potrzebuje małego słownika, jak `owner-options`
 * dla właścicieli. Dlatego własny endpoint: filtr GENERAL_USE i usunięte
 * robi serwer (jedno źródło prawdy z macierzą), a web nie musi znać
 * ograniczeń stronicowania.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ApplicationsService } from '../src/applications/applications.service';
import { read } from './helpers/repo';

/** Serwis ze stubem prisma — metoda słownika nie dotyka niczego innego. */
function serwisZ(prisma: unknown): ApplicationsService {
  return new ApplicationsService(prisma as never, {} as never, {} as never);
}

describe('ApplicationsService.selectOptions — słownik dla selectów', () => {
  it('pobiera id, nazwę i typ dostarczenia, bez usuniętych i bez GENERAL_USE, po nazwie', async () => {
    let argsZbudowane: unknown;
    const prisma = {
      application: {
        findMany: async (args: unknown) => {
          argsZbudowane = args;
          return [
            { id: 'a1', name: 'Archiwum', deliveryType: 'SELF_HOSTED' },
            { id: 'b1', name: 'Biletomat', deliveryType: 'SAAS' },
          ];
        },
      },
    };
    const serwis = serwisZ(prisma);

    const opcje = await serwis.selectOptions();

    assert.deepEqual(argsZbudowane, {
      where: { deletedAt: null, deliveryType: { not: 'GENERAL_USE' } },
      select: { id: true, name: true, deliveryType: true },
      orderBy: { name: 'asc' },
    });
    assert.deepEqual(opcje, [
      { id: 'a1', name: 'Archiwum', deliveryType: 'SELF_HOSTED' },
      { id: 'b1', name: 'Biletomat', deliveryType: 'SAAS' },
    ]);
  });
});

describe('Trasa select-options w kontrolerze aplikacji', () => {
  const zrodlo = read('apps', 'api', 'src', 'applications', 'applications.controller.ts');

  it('GET options istnieje i wymaga app:read, bez @Public', () => {
    const start = zrodlo.indexOf("@Get('options')");
    assert.ok(start !== -1, 'brak trasy @Get(options)');
    // Blok do najbliższej trasy, nie do @Get(':id') — między nimi mogą
    // mieszkać inne trasy (np. publiczne environments).
    const doNastepnej = zrodlo.slice(start + 1).search(/\n {2}@(Get|Post|Patch|Delete)\(/);
    const blok = zrodlo.slice(start, doNastepnej === -1 ? undefined : start + 1 + doNastepnej);
    assert.ok(
      blok.includes("@RequirePermission('app:read')"),
      'słownik musi wymagać app:read — nazwy usług to dane rejestru',
    );
    assert.ok(!blok.includes('@Public()'), 'słownik nie jest publiczny');
  });

  it('trasa jest zadeklarowana przed @Get(:id) — inaczej ParseUUIDPipe zje słowo "options"', () => {
    assert.ok(
      zrodlo.indexOf("@Get('options')") < zrodlo.indexOf("@Get(':id')"),
      'kolejność deklaracji decyduje o dopasowaniu tras',
    );
  });
});

describe('Web — select macierzy zasilany słownikiem', () => {
  const accessPage = read('apps', 'web', 'src', 'pages', 'AccessPage.tsx');
  const queriesApplications = read('apps', 'web', 'src', 'lib', 'queries-applications.ts');

  it('AccessPage używa useApplicationOptions i nie pyta o limit 500', () => {
    assert.ok(
      accessPage.includes('useApplicationOptions('),
      'select ma korzystać ze słownika, nie ze stronicowanego rejestru',
    );
    assert.ok(
      !accessPage.includes('limit: 500'),
      'limit 500 przekracza @Max(200) API i po cichu psuje select',
    );
  });

  it('queries-applications eksportuje useApplicationOptions', () => {
    assert.ok(
      queriesApplications.includes('export function useApplicationOptions'),
      'brak hooka słownika aplikacji',
    );
  });
});
