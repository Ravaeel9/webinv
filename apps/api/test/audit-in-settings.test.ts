/**
 * Dziennik zdarzeń w Ustawieniach.
 *
 * Trzy rzeczy, które nie mogą się rozjechać:
 *
 *  - **Jedno wejście do dziennika.** Po przeniesieniu pod Ustawienia pozycja
 *    „Dziennik zdarzeń” nie może zostać w menu bocznym — inaczej ten sam widok
 *    miałby dwa adresy i dwie bramki uprawnień.
 *  - **Stary adres nie prowadzi w 404.** Linki w zakładkach muszą trafić na
 *    nowe miejsce.
 *  - **Historia zmian aplikacji nie znika dla administratorów.** `audit:read`
 *    karmi zakładkę „Zmiany” w karcie aplikacji, więc zostaje w `ADMIN` —
 *    pełny dziennik pod Ustawieniami też ma własną bramkę `audit:read`,
 *    nie wspólną `settings:write` całej sekcji.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { roleHasPermission } from '../src/auth/permissions';
import { read } from './helpers/repo';
import { webPermissions } from './helpers/web-permissions';
import { webLibText } from './helpers/web-sources';

const layout = read('apps', 'web', 'src', 'components', 'layout', 'AppLayout.tsx');
const router = read('apps', 'web', 'src', 'router.tsx');
const settings = read('apps', 'web', 'src', 'pages', 'SettingsPage.tsx');
const audit = read('apps', 'web', 'src', 'pages', 'AuditPage.tsx');

describe('Dziennik zdarzeń przeniesiony do Ustawień', () => {
  it('menu boczne nie ma już pozycji Dziennik zdarzeń', () => {
    const nav = layout.match(/const NAV = \[[\s\S]*?\] as const;/)?.[0] ?? '';
    assert.equal(nav.includes('/audyt'), false, 'NAV nadal zawiera /audyt');
    assert.equal(nav.includes('Dziennik zdarzeń'), false);
  });

  it('Ustawienia prowadzą do dziennika, a dziennik ma powrót do Ustawień', () => {
    assert.ok(
      settings.includes('/ustawienia/dziennik'),
      'SettingsPage musi linkować do /ustawienia/dziennik',
    );
    assert.ok(
      audit.includes("to: '/ustawienia'"),
      'AuditPage musi mieć powrót do /ustawienia',
    );
  });

  it('trasa /ustawienia/dziennik jest chroniona audit:read, a /audyt przekierowuje', () => {
    assert.ok(
      router.includes("path: 'dziennik'"),
      'brak podtrasy dziennik pod ustawienia',
    );
    // Dziennik jest w sekcji z podwidokami o różnych uprawnieniach, więc
    // bramka stoi na podtrasie, nie na gałęzi — ADMIN ma `audit:read`
    // i musi móc otworzyć pełny dziennik.
    assert.match(
      router,
      /path:\s*'dziennik'[\s\S]{0,80}permission="audit:read"/,
      'podtrasa dziennik bez bramki audit:read',
    );
    assert.ok(
      /path:\s*'audyt'[\s\S]{0,160}Navigate[\s\S]{0,80}\/ustawienia\/dziennik/.test(
        router,
      ),
      '/audyt musi przekierowywać na /ustawienia/dziennik',
    );
  });

  it('VIEWER nie ma audit:read, ale ADMIN zachowuje je dla historii zmian aplikacji', () => {
    assert.equal(roleHasPermission('VIEWER', 'audit:read'), false);
    assert.equal(roleHasPermission('ADMIN', 'audit:read'), true);
    assert.equal(roleHasPermission('SUPER_ADMIN', 'audit:read'), true);

    const web = webPermissions(webLibText((plik) => /^types(-.*)?\.ts$/.test(plik)));
    assert.ok(web);
    assert.equal(web['VIEWER']!.includes('audit:read'), false);
    assert.equal(web['ADMIN']!.includes('audit:read'), true);
  });
});