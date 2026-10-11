/**
 * Uprawnienia IPAM — `ipam:read` i `ipam:write`.
 *
 * Adresy IP to dane o infrastrukturze, nie o aplikacjach, więc celowo
 * nie pożyczamy `app:read`/`app:write`: role, które mają czytać rejestr
 * aplikacji, nie muszą widzieć siatki adresowej (i odwrotnie).
 *
 * Część testów czyta `apps/web/src/types.ts` jako TEKST, bo modułów
 * Vite'a nie da się zaimportować w testach node — patrz
 * `helpers/web-permissions.ts`. Pełne porównanie tabel ról obu stron
 * robi już `settings-permissions.test.ts`; tutaj pilnujemy konkretnie
 * wpisów ipam, żeby ich brak nie przeszedł jako „spójny rozjazd".
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  roleHasPermission,
} from '../src/auth/permissions';
import { read } from './helpers/repo';

describe('Uprawnienia ipam:read / ipam:write', () => {
  it('VIEWER czyta IPAM, ale go nie zmienia', () => {
    assert.equal(roleHasPermission('VIEWER', 'ipam:read'), true);
    assert.equal(roleHasPermission('VIEWER', 'ipam:write'), false);
  });

  it('ADMIN edytuje IPAM', () => {
    assert.equal(roleHasPermission('ADMIN', 'ipam:write'), true);
  });

  it('każde uprawnienie ipam jest na liście wszystkich', () => {
    // Rozpisanie przez spread, a nie `PERMISSIONS.VIEWER.concat(...)`:
    // tablice są `as const`, więc ich typy-elementów różnią się między
    // rolami i `concat` nie znalazłby wspólnego przeciążenia.
    const przyznane = [
      ...PERMISSIONS.VIEWER,
      ...PERMISSIONS.ADMIN,
      ...PERMISSIONS.SUPER_ADMIN,
    ];
    for (const p of przyznane) {
      assert.ok(ALL_PERMISSIONS.includes(p), `${p} poza ALL_PERMISSIONS`);
    }
  });

  it('interfejs zna te same uprawnienia co API', () => {
    // Lustrzana kopia w apps/web/src/types.ts — bez tego trasa `/ipam`
    // byłaby widoczna dla VIEWER, a bramka po stronie API odrzuciłaby zapis.
    const web = read('apps/web/src/types.ts');
    assert.match(web, /'ipam:read'/);
    assert.match(web, /'ipam:write'/);
  });
});
