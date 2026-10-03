/**
 * Wersja aplikacji pokazywana w rogu interfejsu.
 *
 * Wersja przychodzi jako `VITE_APP_VERSION` w czasie buildu obrazu
 * (patrz Makefile → compose → apps/web/Dockerfile). Nie ma jej w
 * źródłach, więc moduł musi ją czytać leniwie — `import.meta.env`
 * istnieje tylko w bundlu Vite'a, a ten plik ma dać się testować
 * w `node --test` (ten sam powód, dla którego `buildQuery` mieszka
 * w osobnym `query.ts`).
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { appVersion } from '../../web/src/lib/version';

// Bramka jak w `session-revoke.test.ts`: bez niej brak modułu dawałby
// testy, które „przechodzą" na komunikacie błędu zamiast sprawdzać
// cokolwiek.
assert.equal(
  typeof appVersion,
  'function',
  'appVersion musi istnieć — inaczej te testy nic nie sprawdzają',
);

describe('appVersion', () => {
  it('dodaje prefiks v do wersji z buildu', () => {
    assert.equal(appVersion('1.2.3'), 'v1.2.3');
  });

  it('przepuszcza wersję deweloperską bez zmian', () => {
    // Fallback przy buildzie poza Makefile ma być widoczny w UI,
    // a nie zamieniony na „nieznaną wersję".
    assert.equal(appVersion('0.0.0-dev'), 'v0.0.0-dev');
  });

  it('nie podwaja prefiksu, gdy ktoś podał go sam', () => {
    assert.equal(appVersion('v1.2.3'), 'v1.2.3');
  });

  it('zwraca null gdy wersji nie ma w buildzie', () => {
    // Czysty `vite dev` nie dostaje ARG-a — brak wersji ma być
    // widoczny jako brak plakietki, a nie jako „vundefined".
    assert.equal(appVersion(undefined), null);
    assert.equal(appVersion(''), null);
    assert.equal(appVersion(null), null);
  });

  it('obcina białe znaki z ARG-a', () => {
    assert.equal(appVersion('  1.0.0  '), 'v1.0.0');
  });

  it('przepuszcza wersje z przedrostkiem i sufiksem', () => {
    assert.equal(appVersion('1.0.0-rc.1'), 'v1.0.0-rc.1');
  });
});