/**
 * Ton odznaki statusu adresu IP.
 *
 * `IP_STATUS_TONES` nie jest w katalogu testów jedynie detalem
 * wyglądu: `IN_USE` znaczy „ten adres jest zajęty”, a zielone tło
 * mówiło „wszystko w porządku” — te dwie wiadomości są sprzeczne.
 * Po zmianie importu z nmap na `IN_USE` („nmap widzi tam hosta”)
 * odznaka stała się codziennym stanem katalogu, więc zielony
 * odcień byłby wprowadzający dla każdego, kto patrzy na podsieć.
 *
 * Test importuje `types.ts` interfejsu (plik bez importów, więc czytelny
 * poza bundlerem) zamiast czytać go tekstowo: chodzi o wartość stałej,
 * a nie o kształt źródła. Kompletność mapy pilnuje sam typ
 * `Record<IpStatus, Tone>` — brakujący klucz nie skompiluje się.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  IP_STATUS_LABELS,
  IP_STATUS_TONES,
  IP_STATUSES,
  type Tone,
} from '../../web/src/types';

const TONY: readonly Tone[] = [
  'neutral',
  'info',
  'violet',
  'ok',
  'warn',
  'danger',
];

describe('Odznaka statusu adresu IP', () => {
  it('zajęty adres ma tło ostrzegawcze, nie „sukces"', () => {
    assert.equal(IP_STATUS_TONES.IN_USE, 'danger');
  });

  it('każdy status ma swój ton i etykietę', () => {
    for (const status of IP_STATUSES) {
      assert.ok(TONY.includes(IP_STATUS_TONES[status]), `${status} ma nieznany ton`);
      assert.ok(IP_STATUS_LABELS[status].length > 0, `${status} ma pustą etykietę`);
    }
  });
});