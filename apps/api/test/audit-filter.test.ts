/**
 * Budowa zapytania do dziennika zdarzeń.
 *
 * Historia na karcie aplikacji prosi o jeden konkretny rekord
 * (`entity` + `entityId`), a kontroler wcześniej `entityId` ignorował —
 * panel pokazywał wtedy ostatnie zdarzenia dowolnej encji, podpisane
 * cudzą etykietą.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { buildAuditWhere } from '../src/audit/audit.controller';

describe('buildAuditWhere', () => {
  const appId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

  it('filtuje po entity i entityId', () => {
    // Bez entityId historia jednej aplikacji wyglądała jak historia
    // wszystkich rekordów naraz.
    const where = buildAuditWhere({
      entity: 'Application',
      entityId: appId,
    });
    assert.equal(where.entity, 'Application');
    assert.equal(where.entityId, appId);
  });

  it('pomija entityId, gdy go nie podano', () => {
    const where = buildAuditWhere({ entity: 'User' });
    assert.equal('entityId' in where, false);
  });

  it('pomija pusty entityId', () => {
    const where = buildAuditWhere({ entity: 'User', entityId: '' });
    assert.equal('entityId' in where, false);
  });

  it('łączy entity, entityId, action i actorId', () => {
    const where = buildAuditWhere({
      entity: 'Application',
      entityId: appId,
      action: 'app.updated',
      actorId: appId,
    });
    assert.deepEqual(where, {
      entity: 'Application',
      entityId: appId,
      action: { startsWith: 'app.updated' },
      actorId: appId,
    });
  });

  it('pusta selekcja daje pusty where', () => {
    assert.deepEqual(buildAuditWhere({}), {});
  });
});