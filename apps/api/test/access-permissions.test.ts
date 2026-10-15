/**
 * Uprawnienia matrycy — `access:read` i `access:write`.
 *
 * Osobne od `app:read`/`app:write`, bo macierz to dane osobowe osób
 * spoza panelu. Dziś dostają je dokładnie te same role co `app:write`,
 * ale rozdzielenie pozwala kiedyś dać sam odczyt bez zmian w kontrolerach.
 *
 * Część testu czyta `apps/web/src/types.ts` jako tekst — modułów Vite'a
 * nie da się zaimportować w testach node, patrz `helpers/web-permissions.ts`.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  roleHasPermission,
} from '../src/auth/permissions';
import { read } from './helpers/repo';
import { webPermissions } from './helpers/web-permissions';

describe('Uprawnienia access:read / access:write', () => {
  it('VIEWER nie widzi macierzy w ogóle', () => {
    assert.equal(roleHasPermission('VIEWER', 'access:read'), false);
    assert.equal(roleHasPermission('VIEWER', 'access:write'), false);
  });

  it('ADMIN i SUPER_ADMIN czytają i edytują macierz', () => {
    for (const rola of ['ADMIN', 'SUPER_ADMIN'] as const) {
      assert.equal(roleHasPermission(rola, 'access:read'), true, rola);
      assert.equal(roleHasPermission(rola, 'access:write'), true, rola);
    }
  });

  it('nowe uprawnienia są kompletne na liście wszystkich', () => {
    const przyznane = [
      ...PERMISSIONS.VIEWER,
      ...PERMISSIONS.ADMIN,
      ...PERMISSIONS.SUPER_ADMIN,
    ];
    for (const p of przyznane) {
      assert.ok(ALL_PERMISSIONS.includes(p), `${p} poza ALL_PERMISSIONS`);
    }
    assert.ok(ALL_PERMISSIONS.includes('access:read'));
    assert.ok(ALL_PERMISSIONS.includes('access:write'));
  });

  it('interfejs zna te same uprawnienia i te same role', () => {
    const web = webPermissions(read('apps', 'web', 'src', 'types.ts'));
    assert.ok(web, 'nie znaleziono PERMISSIONS w types.ts');
    for (const rola of ['ADMIN', 'SUPER_ADMIN']) {
      assert.ok(web[rola]!.includes('access:read'), `web ${rola}: brak access:read`);
      assert.ok(web[rola]!.includes('access:write'), `web ${rola}: brak access:write`);
    }
    assert.equal(web['VIEWER']!.includes('access:read'), false);
    assert.equal(web['VIEWER']!.includes('access:write'), false);
  });
});