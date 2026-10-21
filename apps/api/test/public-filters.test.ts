/**
 * Testy widoku publicznego (gościa) — filtry i sortowanie.
 *
 * `toPublicView` usuwa ukryte pola z odpowiedzi (patrz public-view.test.ts),
 * ale samo usunięcie nie wystarczało: filtr i sortowanie działają w bazie,
 * więc gość mógł odzyskać klasyfikację i krytyczność na dwa sposoby:
 *
 *   1. wyrocznia — `?securityClass=RESTRICTED` i odczyt `total`,
 *   2. kolejność wierszy — `?sort=criticality` samo ustawia rekordy
 *      według ukrytej wartości.
 *
 * Te testy pilnują, żeby obie drogi były zamknięte dla bezsesji.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  ApplicationsService,
  buildOrderBy,
} from '../src/applications/applications.service';

type Where = Record<string, unknown>;

/** Wywołuje prywatne `buildWhere` na prototypie — metoda nie dotyka bazy. */
function buildWhere(
  query: Record<string, unknown>,
  restrict: boolean,
): Where {
  const service = Object.create(ApplicationsService.prototype) as {
    buildWhere: (q: Record<string, unknown>, restrict: boolean) => Where;
  };
  return service.buildWhere(query, restrict);
}

describe('buildWhere — gość nie dostaje filtrów po ukrytych polach', () => {
  it('ignoruje securityClass', () => {
    const where = buildWhere({ securityClass: 'RESTRICTED' }, true);
    assert.equal('securityClass' in where, false);
  });

  it('ignoruje criticality', () => {
    const where = buildWhere({ criticality: 4 }, true);
    assert.equal('criticality' in where, false);
  });

  it('ignoruje właściciela', () => {
    const where = buildWhere({ ownerEmail: 'a@firma.local' }, true);
    assert.equal('owner' in where, false);
  });

  it('zalogowany dostaje wszystkie trzy filtry', () => {
    assert.equal(
      'securityClass' in buildWhere({ securityClass: 'RESTRICTED' }, false),
      true,
    );
    assert.equal('criticality' in buildWhere({ criticality: 4 }, false), true);
    assert.equal(
      'owner' in buildWhere({ ownerEmail: 'a@firma.local' }, false),
      true,
    );
  });

  it('filtry, których nie ukrywamy, działają również u gościa', () => {
    const where = buildWhere(
      { status: 'PROD', environmentId: 'e-1', deliveryType: 'SAAS' },
      true,
    );
    assert.equal('status' in where, true);
    assert.equal('environments' in where, true);
    assert.equal('deliveryType' in where, true);
  });

  it('gość nie filtruje po ukrytych danych wsparcia', () => {
    // `deliveryType` jest widoczne publicznie, ale blok wsparcia już nie —
    // bez tego gość wyszukiwałby wpisy po nazwie zespołu lub adresie
    // dostawcy i odzyskiwał w ten sposób dane, które mają zostać ukryte.
    const where = buildWhere(
      { q: 'support', supportEmail: 'support@example.com' },
      true,
    );
    const serialised = JSON.stringify(where);
    assert.equal(serialised.includes('supportEmail'), false);
    assert.equal(serialised.includes('adminTeam'), false);
    assert.equal(serialised.includes('supportOwnerName'), false);
  });

  it('wyszukiwanie nie szuka po osobach (właściciel, admini)', () => {
    // Gość wpisując fragment adresu dostawałby trafienie w wynikach —
    // samo to wystarcza, żeby wyciągnąć czyj to wpis.
    const where = buildWhere({ q: 'firma.local' }, true);
    const serialised = JSON.stringify(where);
    assert.equal(serialised.includes('owner'), false);
    assert.equal(serialised.includes('admins'), false);
  });

  it('zalogowany nadal szuka po osobach (właściciel, admini)', () => {
    const where = buildWhere({ q: 'firma.local' }, false);
    const serialised = JSON.stringify(where);
    assert.equal(serialised.includes('owner'), true);
  });

  it('wyszukiwanie po nazwie działa u gościa', () => {
    const where = buildWhere({ q: 'CRM' }, true);
    assert.equal(Array.isArray(where.OR), true);
  });

  it('gość nie widzi usuniętych, nawet jak poprosi', () => {
    const where = buildWhere({ includeDeleted: true }, true);
    assert.equal(where.deletedAt, null);
  });

  it('missingOwner działa i u gościa, i zalogowanego', () => {
    // To filtr, którego karta na pulpicie używa dla każdego,
    // więc nie może być ukryty tylko przed gościem.
    assert.equal(buildWhere({ missingOwner: true }, true).ownerId, null);
    assert.equal(buildWhere({ missingOwner: true }, false).ownerId, null);
  });
});

describe('buildOrderBy — gość nie sortuje po ukrytych polach', () => {
  it('po krytyczności wraca do nazwy', () => {
    // Sama kolejność wierszy zdradzałaby wartość krytyczności.
    assert.deepEqual(buildOrderBy('criticality', true), [{ name: 'asc' }]);
  });

  it('po klasyfikacji bezpieczeństwa wraca do nazwy', () => {
    assert.deepEqual(buildOrderBy('securityClass', true), [{ name: 'asc' }]);
  });

  it('odwrócona wersja też jest odrzucona', () => {
    assert.deepEqual(buildOrderBy('-criticality', true), [{ name: 'asc' }]);
  });

  it('zwykłe sortowania działają u gościa', () => {
    assert.deepEqual(buildOrderBy('name', true), [{ name: 'asc' }]);
    assert.deepEqual(buildOrderBy('-name', true), [{ name: 'desc' }]);
    assert.deepEqual(buildOrderBy('updatedAt', true), [
      { updatedAt: 'desc' },
      { name: 'asc' },
    ]);
  });

  it('kierunek zgadza się z etykietą w menu', () => {
    // `SORTABLE` trzyma domyślną kolejność pola, a `-` ją odwraca.
    // Dla dat domyślna jest malejąca, więc „najnowsze" = bez minusa.
    // Ta macierz pilnuje, żeby etykiety w UI nie rozjechały się
    // z kierunkiem — błąd jest cichy, bo lista po prostu jest
    // odwrócona i nic nie mówi dlaczego.
    assert.deepEqual(
      buildOrderBy('introducedOn'),
      [{ introducedOn: 'desc' }, { name: 'asc' }],
      '„Najnowsze" musi dawać malejąco',
    );
    assert.deepEqual(
      buildOrderBy('-introducedOn'),
      [{ introducedOn: 'asc' }, { name: 'asc' }],
      '„Najstarsze" musi dawać rosnąco',
    );
    assert.deepEqual(
      buildOrderBy('updatedAt'),
      [{ updatedAt: 'desc' }, { name: 'asc' }],
      '„Ostatnio zmienione" musi dawać malejąco',
    );
    assert.deepEqual(
      buildOrderBy('sunsetOn'),
      [{ sunsetOn: 'asc' }, { name: 'asc' }],
      '„Wycofanie ↑" musi dawać rosnąco',
    );
  });

  it('zalogowany nadal sortuje po ukrytych polach', () => {
    assert.deepEqual(buildOrderBy('criticality', false), [
      { criticality: 'desc' },
      { name: 'asc' },
    ]);
  });

  it('nieznana kolumna i tak wypada na nazwę', () => {
    assert.deepEqual(buildOrderBy('passwordHash', true), [{ name: 'asc' }]);
    assert.deepEqual(buildOrderBy('; DROP TABLE "Application"; --', true), [
      { name: 'asc' },
    ]);
  });
});
