/**
 * Status aplikacji „W użyciu" (`IN_USE`).
 *
 * W tej organizacji „produkcja" znaczy środowisko z danymi klientów,
 * a część rejestru to aplikacje wykorzystywane wewnątrz organizacji —
 * one potrzebują własnego, żywotnego statusu obok `PROD`. Kod wartości
 * jest spójny z `IpStatus.IN_USE` (ta sama nazwa, ten sam sens:
 * „to jest w codziennym użyciu").
 *
 * Test importuje `types.ts` interfejsu (plik bez importów uruchomieniowych)
 * zamiast czytać go tekstowo — jak w `ipam-status-tone.test.ts`. Kompletność
 * map pilnują typy `Record<AppStatus, …>` — brakujący klucz nie skompiluje
 * się, a test pilnuje wartości.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { APP_STATUSES } from '../src/applications/dto/application.dto';
import {
  STATUS_LABELS,
  STATUS_TONES,
} from '../../web/src/types';

describe('Status „W użyciu" (IN_USE)', () => {
  it('API przyjmuje IN_USE jako status wdrożenia', () => {
    assert.equal(
      (APP_STATUSES as readonly string[]).includes('IN_USE'),
      true,
      'APP_STATUSES musi zawierać IN_USE, inaczej walidacja @IsIn go odrzuci',
    );
  });

  it('UI pokazuje polską etykietę „W użyciu" po PROD', () => {
    assert.equal(STATUS_LABELS.IN_USE, 'W użyciu');
    // Kolejność wstawienia steruje listą w formularzu — IN_USE
    // powinien być rodzinnym statusem obok PROD, nie na końcu.
    const klucze = Object.keys(STATUS_LABELS);
    assert.equal(klucze.indexOf('IN_USE'), klucze.indexOf('PROD') + 1);
  });

  it('odznaka IN_USE ma ton pozytywnego stanu żywotności', () => {
    assert.equal(STATUS_TONES.IN_USE, 'ok');
  });
});
