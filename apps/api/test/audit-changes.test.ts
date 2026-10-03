/**
 * Kształt `changes` po stronie interfejsu.
 *
 * Serwer ma dwa różne sygnały przycinania i oba trafiają pod tym
 * samym kluczem `_truncated`:
 *
 *   - `AuditService.diff` dopisuje LISTĘ nazw pól (`string[]`),
 *   - `GET /api/audit` przy zbyt dużym JSON zastępuje całość obiektem
 *     `{ _truncated: true }` — czyli booleanem.
 *
 * Frontend typował to jako `string[]` i wołał `.map()`. Na liście
 * działało przypadkiem, bo oba komponenty najpierw robią
 * `visibleChanges()` i przy pustym wyniku wychodzą wcześniej — ale
 * `.map()` na `true` to `TypeError`, a komunikat „przycięto wartości"
 * nigdy się nie pokazywał.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  visibleChanges,
  truncatedFields,
  type AuditChanges,
} from '../../web/src/types';

/**
 * Dokładnie to, co zwraca `GET /api/audit` dla bardzo szerokiej zmiany.
 * Bez `as unknown as` — `AuditChanges` używa `Omit`, więc dopuszcza oba
 * kształty `_truncated`; wcześniejsze przecięcie `Record & {…}` czyniło
 * każdą z tych wartości nie do przypisania.
 */
const truncatedByController: AuditChanges = { _truncated: true };
/** To, co dopisuje `AuditService.diff` przy długiej wartości pola. */
const truncatedByDiff: AuditChanges = {
  name: { from: 'a', to: 'b' },
  _truncated: ['description'],
};

describe('visibleChanges — klucz _truncated nie jest zmianą', () => {
  it('pomija booleanowy _truncated z kontrolera', () => {
    // Bez `typeof === 'object'` warunek `entry[0] !== '_truncated'`
    // przepuszczałby tę parę jako zwykłą zmianę.
    assert.deepEqual(visibleChanges({ ...truncatedByController }), []);
  });

  it('pomija listowy _truncated z diff()', () => {
    const visible = visibleChanges({ ...truncatedByDiff });
    assert.deepEqual(visible, [['name', { from: 'a', to: 'b' }]]);
  });

  it('nie mutuje wejścia', () => {
    const input = { ...truncatedByDiff };
    visibleChanges(input);
    assert.ok('_truncated' in input);
  });

  it('obsługuje brak zmian', () => {
    assert.deepEqual(visibleChanges({}), []);
  });

  it('pomija dowolny klucz, którego wartość nie jest zmianą', () => {
    // Filtrowanie po kształcie, nie po nazwie: klucz techniczny przyjdzie
    // z JSON-a, więc polegać na jego nazwie nie ma sensu.
    const visible = visibleChanges({
      name: { from: 'a', to: 'b' },
      _truncated: true,
      jakiśObcyKlucz: ['a'],
    });
    assert.deepEqual(visible, [['name', { from: 'a', to: 'b' }]]);
  });
});

describe('truncatedFields — lista nazw pól', () => {
  it('zwraca nazwy pól przyciętych przez diff()', () => {
    assert.deepEqual(truncatedFields({ ...truncatedByDiff }), ['description']);
  });

  it('zwraca pustą listę dla booleanowego _truncated', () => {
    // `true` nie ma `.map()` — komponent musi to obsłużyć osobno,
    // bo przycięto wtedy całą zmianę, a nie konkretne pola.
    assert.deepEqual(truncatedFields({ ...truncatedByController }), []);
  });

  it('zwraca pustą listę gdy nic nie przycięto', () => {
    assert.deepEqual(truncatedFields({ name: { from: 'a', to: 'b' } }), []);
  });
});