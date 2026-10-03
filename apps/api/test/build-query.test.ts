/**
 * Budowanie query stringa po stronie przeglądarki.
 *
 * `buildQuery` pomijalo każdą wartość `false`, więc `includeInactive=false`
 * nigdy nie trafiało do URL-a. API interpretuje brak parametru jako `true`
 * (`includeInactive !== 'false'`), więc odznaczenie „Pokazuj nieaktywne
 * konta" po cichu nic nie robiło — a reguła zadziałałaby tak samo na
 * każdy przyszły filtr boolean.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { buildQuery } from '../../web/src/lib/query';

describe('buildQuery', () => {
  it('pomija undefined', () => {
    assert.equal(buildQuery({ q: undefined }), '');
  });

  it('pomija null', () => {
    assert.equal(buildQuery({ q: null }), '');
  });

  it('pomija pusty string', () => {
    assert.equal(buildQuery({ q: '' }), '');
  });

  it('zachowuje false — filtr boolean musi dojechać do API', () => {
    // Gdyby `false` wypadło, API czytałoby brak parametru jako `true`.
    assert.equal(
      buildQuery({ includeInactive: false }),
      '?includeInactive=false',
    );
  });

  it('zachowuje true', () => {
    assert.equal(buildQuery({ includeInactive: true }), '?includeInactive=true');
  });

  it('łączy wartości z różnych typów', () => {
    assert.equal(
      buildQuery({ status: 'PROD', limit: 25, includeInactive: false }),
      '?status=PROD&limit=25&includeInactive=false',
    );
  });

  it('koduje znaki specjalne', () => {
    assert.equal(buildQuery({ q: 'a b&c' }), '?q=a+b%26c');
  });

  it('pusta selekcja daje pusty string', () => {
    assert.equal(buildQuery({}), '');
  });
});