/**
 * Granice okna wycofywania na pulpicie.
 *
 * `sunset_on` jest kolumną `@db.Date`, a `now` w kodzie to timestamp
 * z godziną. Postgres rzutuje `date` na timestamp o północy, więc
 * porównanie date ↔ timestamp daje błędny wynik: aplikacja wycofywana
 * **dziś** (północ dziś < teraz) trafiała do „po terminie wycofania",
 * a nie do „wycofywane w ciągu 90 dni".
 *
 * Te testy pilnują, żeby granice liczone były po dacie, nie po czasie.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { eolWindow } from '../src/applications/applications.service';

/** Doba do porównania w Postgresie: `date` → timestamp o północy. */
const startOfDay = (d: Date): Date => {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
};

describe('eolWindow — granice liczone od daty, nie od timestampu', () => {
  const now = new Date('2026-10-03T19:30:00');
  const { soonFrom, soonTo, passedBefore } = eolWindow(now, 90);

  it('dolna granica "wkrótce" to początek dziśszego dnia', () => {
    // Nie `now` — inaczej aplikacja wycofywana dziś o północy
    // wypadałaby z przedziału.
    assert.equal(soonFrom.toISOString(), '2026-10-03T00:00:00.000Z');
  });

  it('aplikacja wycofywana dziś trafia do "wkrótce", nie do "po terminie"', () => {
    const sunsetToday = new Date('2026-10-03T00:00:00');
    assert.equal(sunsetToday >= soonFrom, true, 'musi być w oknie soon');
    assert.equal(sunsetToday < passedBefore, false, 'nie może być po terminie');
  });

  it('wczoraj jest już po terminie', () => {
    const yesterday = new Date('2026-10-02T00:00:00');
    assert.equal(yesterday < passedBefore, true);
  });

  it('jutro jest w oknie', () => {
    const tomorrow = new Date('2026-10-04T00:00:00');
    assert.equal(tomorrow >= soonFrom, true);
    assert.equal(tomorrow <= soonTo, true);
  });

  it('górna granica to początek dnia 90 dni do przodu', () => {
    assert.equal(soonTo.toISOString(), '2027-01-01T00:00:00.000Z');
  });

  it('startOfDay zgłasza granicę do godziny 00:00', () => {
    // Sanity check na sam helper — jego błąd przeniósłby się na wszystkie
    // trzy granice naraz.
    assert.equal(
      startOfDay(new Date('2026-10-03T19:30:00')).toISOString(),
      soonFrom.toISOString(),
    );
  });
});