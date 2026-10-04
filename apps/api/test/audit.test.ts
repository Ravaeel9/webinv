/**
 * Testy logiki audytu — budowanie mapy zmian.
 *
 * Testy czystej logiki, bez bazy. Kluczowe przypadki: pola niezmienione
 * nie trafiają do dziennika, a długie wartości są przycinane, żeby kolumna
 * JSON nie rosła bez ograniczeń.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { AuditService } from '../src/audit/audit.service';

describe('AuditService.diff', () => {
  it('pusta różnica dla identycznych obiektów', () => {
    const changes = AuditService.diff({ name: 'CRM' }, { name: 'CRM' });
    assert.deepEqual(changes, {});
  });

  it('rejestruje zmienione pole', () => {
    const changes = AuditService.diff(
      { name: 'CRM', version: '3.1.0' },
      { name: 'CRM', version: '3.2.0' },
    );
    assert.deepEqual(changes, {
      version: { from: '3.1.0', to: '3.2.0' },
    });
  });

  it('pomija pola niezmienione', () => {
    const changes = AuditService.diff(
      { name: 'CRM', deliveryType: 'SAAS' },
      { name: 'CRM', deliveryType: 'SAAS' },
    );
    assert.deepEqual(Object.keys(changes), []);
  });

  it('pomija updatedAt domyślnie', () => {
    // updatedAt zmienia się przy każdym zapisie — bez pominięcia
    // każde zdarzenie pokazywałoby fałszywą zmianę.
    const changes = AuditService.diff(
      { name: 'CRM', updatedAt: '2026-01-01' },
      { name: 'CRM', updatedAt: '2026-09-30' },
    );
    assert.deepEqual(changes, {});
  });

  it('honoruje własną listę pomijanych pól', () => {
    const changes = AuditService.diff(
      { name: 'CRM', secret: 'a' },
      { name: 'CRM', secret: 'b' },
      ['secret'],
    );
    assert.deepEqual(changes, {});
  });

  it('traktuje undefined i null jako tę samą wartość', () => {
    // Częsty przypadek: pole opcjonalne nieustawione w jednym obiekcie,
    // jawnie null w drugim. To nie jest zmiana.
    const changes = AuditService.diff({ vendor: undefined }, { vendor: null });
    assert.deepEqual(changes, {});
  });

  it('rejestruje wyczyszczenie pola (wartość → null)', () => {
    const changes = AuditService.diff({ vendor: 'Firma XYZ' }, { vendor: null });
    assert.deepEqual(changes, {
      vendor: { from: 'Firma XYZ', to: null },
    });
  });

  it('rejestruje ustawienie pola (null → wartość)', () => {
    const changes = AuditService.diff({ vendor: null }, { vendor: 'Firma XYZ' });
    assert.deepEqual(changes, {
      vendor: { from: null, to: 'Firma XYZ' },
    });
  });

  it('wykrywa pole dodane tylko w nowym obiekcie', () => {
    const changes = AuditService.diff({}, { websiteUrl: 'https://x.example' });
    assert.deepEqual(changes, {
      websiteUrl: { from: null, to: 'https://x.example' },
    });
  });

  it('wykrywa pole usunięte', () => {
    const changes = AuditService.diff(
      { websiteUrl: 'https://x.example' },
      {},
    );
    assert.deepEqual(changes, {
      websiteUrl: { from: 'https://x.example', to: null },
    });
  });

  it('rozróżnia 0 od null — to nie jest ta sama wartość', () => {
    const changes = AuditService.diff({ criticality: 0 }, { criticality: null });
    assert.deepEqual(changes, {
      criticality: { from: 0, to: null },
    });
  });

  it('przycina długie wartości i oznacza pole kluczem _truncated', () => {
    const long = 'x'.repeat(500);
    const changes = AuditService.diff(
      { description: 'krótki' },
      { description: long },
    );

    const change = changes.description as { from: unknown; to: unknown };
    assert.equal(typeof change.to, 'string');
    assert.ok(
      (change.to as string).length < long.length,
      'wartość powinna być krótsza niż oryginał',
    );
    assert.ok(
      (change.to as string).includes('znaków'),
      'komunikat powinien mówić, ile znaków ucięto',
    );
    assert.deepEqual(changes._truncated, ['description']);
  });

  it('nie oznacza _truncated, gdy nic nie przycięto', () => {
    const changes = AuditService.diff({ name: 'CRM' }, { name: 'ERP' });
    assert.equal('_truncated' in changes, false);
  });

  it('wymienia wszystkie przycięte pola', () => {
    const changes = AuditService.diff(
      { description: 'a'.repeat(400), purpose: 'b'.repeat(400) },
      { description: 'c'.repeat(400), purpose: 'd'.repeat(400) },
    );
    assert.deepEqual(
      [...(changes._truncated ?? [])].sort(),
      ['description', 'purpose'],
    );
  });

  it('nie przycina krótkich wartości', () => {
    const changes = AuditService.diff({ vendor: 'Firma' }, { vendor: 'Dostawca' });
    assert.equal('_truncated' in changes, false);
    assert.equal(changes.vendor.to, 'Dostawca');
  });

  it('przycina też wartość „from"', () => {
    const changes = AuditService.diff(
      { description: 'e'.repeat(500) },
      { description: 'krótki' },
    );
    const change = changes.description as { from: unknown };
    assert.ok((change.from as string).length < 500);
    assert.deepEqual(changes._truncated, ['description']);
  });

  it('_truncated nie jest zmianą — widać go w Object.keys, ale nie w parach', () => {
    // Interfejs używa widocznychChanges(), które odfiltrowują ten klucz.
    // Tu sprawdzamy kontrakt: jest enumerable (dojdzie do JSON-a),
    // więc wartość trafia do bazy.
    const changes = AuditService.diff(
      { description: 'a'.repeat(400) },
      { description: 'b'.repeat(400) },
    );
    assert.ok(Object.keys(changes).includes('_truncated'));
    assert.ok(JSON.stringify(changes).includes('_truncated'));
  });

  it('obsługuje puste obiekty', () => {
    assert.deepEqual(AuditService.diff({}, {}), {});
  });

  it('liczy różnicę dla tablic (np. administratorzy po ID)', () => {
    const changes = AuditService.diff(
      { admins: ['a', 'b'] },
      { admins: ['a', 'c'] },
    );
    assert.deepEqual(changes, {
      admins: {
        from: ['a', 'b'],
        to: ['a', 'c'],
      },
    });
  });
});
