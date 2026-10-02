/**
 * Regresja: `/aplikacje` wisi na „Ładowanie…" dla gościa.
 *
 * `AuthProvider` reaguje na 401 z `/auth/me`. Gość na publicznym
 * `/aplikacje` dostaje ten 401 przy każdym wejściu, więc reakcja na
 * niego musi być inna niż na wygasłą sesję:
 *
 *   - `removeQueries` → `queryCache.remove` → `query.destroy()`
 *     → `cancel({ silent: true })`. Zapytanie `applications` ginie
 *     w locie, a obserwator strony zostaje w stanie `pending` na
 *     zawsze — bez błędu, więc użytkownik widzi tylko wspinacz.
 *   - `resetQueries` zeruje stan i pozwala aktywnym zapytaniom
 *     dociągnąć danych ponownie, zamiast je cicho anulować.
 *
 * Test używa `QueryObserver` z query-core zamiast Reacta, bo problem
 * leży w cyklu życia zapytania, a nie w renderowaniu.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/query-core';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Strona `/aplikacje` — zapytanie w locie, opóźnione o 50 ms. */
function mountListPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const observer = new QueryObserver(client, {
    queryKey: ['applications', { limit: 25 }],
    queryFn: () =>
      new Promise((resolve) =>
        setTimeout(() => resolve({ items: [{ id: 'a1' }] }), 50),
      ),
  });
  const unsubscribe = observer.subscribe(() => {});

  return { client, observer, unsubscribe };
}

/** Odwzorowanie efektu w AuthProvider. */
function handleUnauthorized(
  client: QueryClient,
  hadSession: boolean,
  method: 'remove' | 'reset' = 'reset',
) {
  // Gość nie był zalogowany — nie ma czego czyścić.
  if (!hadSession) return;

  if (method === 'remove') {
    client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
  } else {
    client.resetQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
  }
}

describe('gość na /aplikacje kończy ładowanie', () => {
  it('401 bez wcześniejszej sesji nie rusza zapytania listy', async () => {
    const { client, observer, unsubscribe } = mountListPage();

    handleUnauthorized(client, false);
    await sleep(200);

    const result = observer.getCurrentResult();
    assert.equal(result.isLoading, false, 'lista musi się doczytać');
    assert.equal(result.status, 'success');
    assert.deepEqual(result.data, { items: [{ id: 'a1' }] });

    unsubscribe();
    client.clear();
  });

  it('removeQueries przy 401 zostawia obserwator w stanie „ładuj" (powód regresji)', async () => {
    // Udokumentowanie zachowania, które wywołało zgłoszenie:
    // gdyby ktoś wrócił do `removeQueries`, ten test przypomni dlaczego nie.
    const { client, observer, unsubscribe } = mountListPage();

    handleUnauthorized(client, true, 'remove');
    await sleep(200);

    const result = observer.getCurrentResult();
    assert.equal(result.isLoading, true, 'dokładnie ten stan psuł widok');
    assert.notEqual(result.status, 'error', 'i nie było widać żadnego błędu');

    unsubscribe();
    client.clear();
  });
});

describe('wygasła sesja czyści dane, ale nie zawiesza widoku', () => {
  it('resetQueries pozwala dociągnąć listę ponownie', async () => {
    const { client, observer, unsubscribe } = mountListPage();

    // Najpierw zapytanie dociąga się normalnie.
    await sleep(120);
    assert.equal(observer.getCurrentResult().isLoading, false);

    handleUnauthorized(client, true, 'reset');
    await sleep(200);

    const result = observer.getCurrentResult();
    assert.equal(result.isLoading, false, 'po resecie lista musi wrócić');
    assert.equal(result.status, 'success');

    unsubscribe();
    client.clear();
  });

  it('zapytanie me nie jest resetowane', async () => {
    // Gdyby `me` też było resetowane, od razu dostałoby 401
    // i uruchomiłoby tę samą procedurę w pętli.
    const { client, unsubscribe } = mountListPage();

    let meFetches = 0;
    client
      .fetchQuery({
        queryKey: ['me'],
        queryFn: () => {
          meFetches += 1;
          return Promise.reject(new Error('401'));
        },
        retry: false,
      })
      .catch(() => {});

    await sleep(20);
    const before = meFetches;

    handleUnauthorized(client, true, 'reset');
    await sleep(120);

    assert.equal(meFetches, before, 'zapytanie me nie może zostać odpytywane ponownie');

    unsubscribe();
    client.clear();
  });
});
