/**
 * Zgodność uprawnień między API a interfejsem.
 *
 * `PERMISSIONS` w `apps/web/src/types.ts` jest **ręczną kopią** pliku
 * `apps/api/src/auth/permissions.ts`. Kopia dlatego, że klient nie może
 * importować z `apps/api` — bundlacz Vite sięgnąłby poza `apps/web`.
 *
 * Ręczna kopia to dwa źródła prawdy, więc muszą być sprawdzane razem.
 * Rozjazd jest cichy: `can()` w interfejsie po prostu zwraca `false` dla
 * uprawnienia, którego tam nie ma, a użytkownik widzi „Brak uprawnień"
 * na stronie, do której super administrator przecież ma prawo.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  PERMISSIONS as API_PERMISSIONS,
  roleHasPermission,
} from '../src/auth/permissions';
import { webPermissions } from './helpers/web-permissions';
import { webSources } from './helpers/web-sources';
import { read } from './helpers/repo';

const WEB = webPermissions(read('apps', 'web', 'src', 'types.ts'));

describe('Uprawnienia API i interfejsu', () => {
  it('plik interfejsu zawiera stałą PERMISSIONS', () => {
    assert.ok(
      WEB,
      'nie udało się przeczytać PERMISSIONS z apps/web/src/types.ts — ' +
        'test poniżej porównywałby puste listy i przechodził na próżno',
    );
  });

  for (const rola of ['VIEWER', 'ADMIN', 'SUPER_ADMIN'] as const) {
    it(`rola ${rola} ma w obu warstwach ten sam zestaw uprawnień`, () => {
      assert.deepEqual(
        [...(WEB?.[rola] ?? [])].sort(),
        [...API_PERMISSIONS[rola]].sort(),
        `rola ${rola}: uprawnienia rozjeżdżają się między ` +
          '`apps/api/src/auth/permissions.ts` a `apps/web/src/types.ts`',
      );
    });
  }

  it('interfejs nie zna uprawnienia, którego nie ma w API', () => {
    // Odwrotna strona tego samego rozjazdu: uprawnienie dodane w
    // `types.ts`, ale zapomniane w API, wyglądałoby w interfejsie
    // jak działające — bramka przeszłaby, a API odmówiłoby z 403.
    const wApi = new Set(Object.values(API_PERMISSIONS).flat());
    const tylkoWInterfejsie = Object.values(WEB ?? {})
      .flat()
      .filter((p) => !wApi.has(p as never));

    assert.deepEqual(tylkoWInterfejsie, []);
  });

  it('ustawienia należą wyłącznie do super administratora', () => {
    // Osobny przypadek, bo to uprawnienie z operacją nieodwracalną.
    // `ADMIN` ma `app:write`, czyli może usunąć aplikację pojedynczo —
    // nie powinien dostać przycisku kasującego 30 rekordów naraz.
    //
    // Sprawdzenie przez `roleHasPermission`, a nie przez `.includes`
    // na stałej: `ADMIN` jest typowane jako lista bez `settings:write`,
    // więc `includes('settings:write')` nie skompilowałoby się — i to
    // jest **ta sama** informacja, tylko zgłoszona przez kompilator.
    // Używamy funkcji, która pyta o rolę, a nie o konkretną rolę
    // zakodowaną w typie.
    assert.ok(roleHasPermission('SUPER_ADMIN', 'settings:write'));
    assert.equal(
      roleHasPermission('ADMIN', 'settings:write'),
      false,
      'ADMIN nie powinien kasować danych demonstracyjnych',
    );
    assert.equal(roleHasPermission('VIEWER', 'settings:write'), false);
    assert.ok(WEB?.SUPER_ADMIN.includes('settings:write'));
  });
});

describe('Panel ustawień', () => {
  it('trasa jest za bramką uprawnienia, a nie roli', () => {
    // Bramka na rolę przestałaby działać przy zmianie nazwy roli,
    // a `RequirePermission` już to obsługuje dla reszty aplikacji.
    const router = read('apps', 'web', 'src', 'router.tsx');
    assert.match(router, /path: 'ustawienia'/, 'brak trasy /ustawienia');
    assert.match(
      router,
      /permission="settings:write"/,
      'trasa bez bramki uprawnień pokazałaby panel każdemu zalogowanemu',
    );
  });

  it('pozycja w menu jest widoczna tylko dla super administratora', () => {
    const layout = read(
      'apps',
      'web',
      'src',
      'components',
      'layout',
      'AppLayout.tsx',
    );
    assert.match(layout, /to: '\/ustawienia'.*permission: 'settings:write'/s);
  });

  it('kasowanie idzie przez endpoint za bramką uprawnienia', () => {
    // Kasowanie z panelu bez bramki na API to bramka tylko w interfejsie:
    // każdy, kto zna adres endpointu, skasowałby dane wprost.
    const controller = read(
      'apps',
      'api',
      'src',
      'settings',
      'settings.controller.ts',
    );
    assert.match(
      controller,
      /@Delete\('demo\/data'\)[\s\S]{0,200}@RequirePermission\('settings:write'\)/,
      'endpoint kasujący bez `settings:write`',
    );
  });
});

describe('Klient ustawień', () => {
  it('po skasowaniu danych unieważnia listę aplikacji i statystyki', () => {
    // Rekordy znikają z bazy, więc lista i pulpit pokazywałyby dane,
    // których już nie ma, dopóki ktoś nie odświeży strony ręcznie.
    const queries = read('apps', 'web', 'src', 'lib', 'queries.ts');
    const sekcja = queries.slice(queries.indexOf('useDeleteDemoData'));

    assert.match(
      sekcja,
      /invalidateQueries\(\{ queryKey: \['applications'\] \}\)/,
    );
    assert.match(sekcja, /invalidateQueries\(\{ queryKey: qk\.stats \}\)/);
  });
});

describe('Źródła interfejsu', () => {
  it('lista plików nie jest pusta', () => {
    // `ui-css-output.test.ts` zna już pułapkę z sekwencją zamykającą
    // komentarz. Ten przypadek chroni samą listę przed sfałszowaniem —
    // katalog, którego już nie ma, dałoby pustkę i zielone testy.
    assert.ok(webSources().length > 0, 'webSources() zwróciło pustą listę');
  });
});