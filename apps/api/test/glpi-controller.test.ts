/**
 * Kontroler GLPI — bramki uprawnień i tłumaczenie błędów.
 *
 * Test źródłowy (wzorzec `settings-permissions.test.ts`): nie podnosimy
 * całej aplikacji Nest, sprawdzamy kontrakt w kodzie. Uprawnienie
 * `settings:write` ma wyłącznie super administrator, a błąd GLPI to
 * problem po drugiej stronie sieci (502), nie błąd danych formularza.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { read } from './helpers/repo';

const kontroler = read('apps', 'api', 'src', 'glpi', 'glpi.controller.ts');

describe('Kontroler GLPI', () => {
  it('każda trasa GLPI stoi za bramką settings:write', () => {
    const trasy = kontroler.match(/@(Get|Put|Post)\([^)]*\)[\s\S]*?async /g) ?? [];
    assert.ok(trasy.length >= 5, `kontroler ma mieć 5 tras, znalazł ${trasy.length}`);
    for (const trasa of trasy) {
      assert.match(
        trasa,
        /@RequirePermission\('settings:write'\)/,
        `trasa bez bramki: ${trasa.slice(0, 60)}…`,
      );
    }
  });

  it('błąd GLPI (sieć, poświadczenia) idzie jako 502, nie 500 ani 400', () => {
    assert.match(
      kontroler,
      /GlpiBlad[\s\S]*?BadGatewayException/,
      'GlpiBlad ma być tłumaczony na BadGatewayException (502)',
    );
  });

  it('import ma podgląd i zapis jako osobne trasy, jak pozostałe importy', () => {
    assert.match(kontroler, /@Post\('import\/preview'\)/);
    assert.match(kontroler, /@Post\('import\/apply'\)/);
  });
});
