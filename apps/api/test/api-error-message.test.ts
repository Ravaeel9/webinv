/**
 * Tłumaczenie błędów API na komunikaty dla administratora.
 *
 * Regresja: integracja GLPI raportuje błędy jako 502 z **czytelnym
 * opisem po polsku** („GLPI odrzuciło…", „Import dostępów wymaga…"),
 * a klient HTTP nadpisywał go ogólnym „Usługa chwilowo niedostępna.
 * Spróbuj ponownie za chwilę." — co nic nie mówi. Ogólny tekst jest
 * tylko dla 502/503 **bez** treści (czysty nginx przed awarią API),
 * nie dla odpowiedzi Nest z konkretnym komunikatem.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { extractError } from '../../../apps/web/src/lib/api-error';

/** Fałszywy `Response` — tylko to, czego `extractError` używa. */
function odpowiedz(status: number, body: unknown): Response {
  return {
    status,
    json: async () => {
      if (body === undefined) throw new SyntaxError('nie jest JSON-em');
      return body;
    },
  } as unknown as Response;
}

describe('extractError — komunikat z API nie ginie pod ogólnym', () => {
  it('502 z konkretnym komunikatem Nest zostaje czytelny', async () => {
    const blad = await extractError(
      odpowiedz(502, {
        message: 'Import dostępów wymaga skonfigurowanego legacy API (adres, token osobisty i App-Token) w ustawieniach integracji.',
        error: 'Bad Gateway',
        statusCode: 502,
      }),
    );

    assert.match(blad.message, /legacy API/);
  });

  it('502 bez treści JSON (nginx) dostaje ogólny komunikat', async () => {
    const blad = await extractError(odpowiedz(502, undefined));

    assert.equal(blad.message, 'Usługa chwilowo niedostępna. Spróbuj ponownie za chwilę.');
  });

  it('400 z komunikatem walidacji pozostaje konkretny', async () => {
    const blad = await extractError(odpowiedz(400, { message: 'Adres API GLPI musi zaczynać się od http:// albo https://.' }));

    assert.match(blad.message, /Adres API GLPI/);
  });
});
