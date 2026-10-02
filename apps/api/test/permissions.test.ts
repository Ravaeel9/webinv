/**
 * Testy mapowania ról na uprawnienia.
 *
 * Frontend trzyma lustrzaną kopię tej tabeli w src/types.ts, więc te
 * testy pilnują, by serwer nie zaczął przyznawać więcej, niż interfejs
 * zakłada (albo odwrotnie — blokować widok, do którego user ma prawo).
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  permissionsFor,
  roleHasPermission,
  type Role,
} from '../src/auth/permissions';

describe('roleHasPermission', () => {
  it('VIEWER czyta rejestr, ale go nie zmienia', () => {
    assert.equal(roleHasPermission('VIEWER', 'app:read'), true);
    assert.equal(roleHasPermission('VIEWER', 'app:write'), false);
  });

  it('VIEWER nie zarządza kontami', () => {
    assert.equal(roleHasPermission('VIEWER', 'user:read'), true);
    assert.equal(roleHasPermission('VIEWER', 'user:write'), false);
  });

  it('ADMIN zmienia aplikacje, ale nie konta', () => {
    assert.equal(roleHasPermission('ADMIN', 'app:write'), true);
    assert.equal(roleHasPermission('ADMIN', 'user:read'), true);
    assert.equal(roleHasPermission('ADMIN', 'user:write'), false);
  });

  it('SUPER_ADMIN ma wszystkie uprawnienia', () => {
    for (const permission of ALL_PERMISSIONS) {
      assert.equal(
        roleHasPermission('SUPER_ADMIN', permission),
        true,
        `SUPER_ADMIN powinien mieć ${permission}`,
      );
    }
  });

  it('nieznana rola nie ma żadnych uprawnień', () => {
    // Chroni przed sytuacją, w której nowa rola w bazie dostałaby
    // dostęp „na wiarę", bo nigdzie nie ma wpisu w PERMISSIONS.
    const bogus = 'NIEZNANA' as Role;
    assert.equal(roleHasPermission(bogus, 'app:read'), false);
    assert.equal(roleHasPermission(bogus, 'app:write'), false);
  });

  it('hierarchia jest zachowana: VIEWER ⊂ ADMIN ⊂ SUPER_ADMIN', () => {
    for (const permission of PERMISSIONS.VIEWER) {
      assert.equal(
        roleHasPermission('ADMIN', permission),
        true,
        `ADMIN powinien mieć wszystko, co ma VIEWER (${permission})`,
      );
      assert.equal(
        roleHasPermission('SUPER_ADMIN', permission),
        true,
        `SUPER_ADMIN powinien mieć wszystko, co ma VIEWER (${permission})`,
      );
    }
    for (const permission of PERMISSIONS.ADMIN) {
      assert.equal(
        roleHasPermission('SUPER_ADMIN', permission),
        true,
        `SUPER_ADMIN powinien mieć wszystko, co ma ADMIN (${permission})`,
      );
    }
  });

  it('każda rola ma uprawnienie app:read', () => {
    // Bez tego użytkownik zalogowany na poprawne hasło zobaczyłby
    // pustą aplikację zamiast listy.
    for (const role of ['VIEWER', 'ADMIN', 'SUPER_ADMIN'] as const) {
      assert.equal(roleHasPermission(role, 'app:read'), true, role);
    }
  });

  it('tylko SUPER_ADMIN ma user:write', () => {
    const withWrite = (['VIEWER', 'ADMIN', 'SUPER_ADMIN'] as const).filter((r) =>
      roleHasPermission(r, 'user:write'),
    );
    assert.deepEqual(withWrite, ['SUPER_ADMIN']);
  });

  it('ALL_PERMISSIONS pokrywa dokładnie to, co jest w tabeli ról', () => {
    // Gdyby ktoś dopisał uprawnienie do tabeli ról, ale zapomniał
    // o `ALL_PERMISSIONS`, powyższe testy przeszłyby w ciemno.
    const fromRoles = new Set(Object.values(PERMISSIONS).flat());
    assert.deepEqual([...fromRoles].sort(), [...ALL_PERMISSIONS].sort());
  });

  it('permissionsFor zgadza się z roleHasPermission', () => {
    // `permissionsFor` to jedyne miejsce, które czyta tabelę ról.
    // Test pilnuje, żeby nie rozjechało się z funkcją, którą faktycznie
    // wołają kontrolery.
    for (const role of ['VIEWER', 'ADMIN', 'SUPER_ADMIN'] as const) {
      const granted = permissionsFor(role);
      assert.deepEqual([...granted].sort(), [...PERMISSIONS[role]].sort());
      for (const permission of ALL_PERMISSIONS) {
        assert.equal(
          roleHasPermission(role, permission),
          granted.includes(permission),
          `${role} / ${permission}`,
        );
      }
    }
  });

  it('nieznana rola daje pustą listę uprawnień', () => {
    assert.deepEqual(permissionsFor('NIEZNANA' as Role), []);
  });
});
