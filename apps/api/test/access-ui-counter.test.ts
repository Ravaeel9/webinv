/**
 * UI /uprawnienia — kosz zamiast „Odebraj", ikona sekcji i licznik.
 *
 * Trzy zmiany czysto prezentacyjne, ale każda z nich ma powód, dla
 * którego test to pilnuje:
 *
 *  - **Kosz zamiast tekstu.** Kolumna akcji grantów ma tylko ikony
 *    (sr-only „Akcje") — tekst „Odebraj" rozdęwał wiersz i łamał
 *    konwencję kosza z karty aplikacji. Ikona bez `aria-label`/`title`
 *    byłaby niedostępna — stąd asercja na etykietę.
 *  - **Ikona sekcji.** Puste `section-icon` (kolorowe kółko) na stronie
 *    osoby to wyjątek od konwencji wszystkich kart — SVG w `section-icon`.
 *  - **Licznik katalogu.** Pasek podsumowania na /uprawnienia musi być
 *    zasilony hookiem `usePersonsCount` (globalne liczby z bazy), nie
 *    długością przefiltrowanej listy.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { read } from './helpers/repo';

describe('Strona osoby — kosz zamiast „Odebraj"', () => {
  const strona = read('apps', 'web', 'src', 'pages', 'PersonDetailPage.tsx');

  it('przycisk odbioru grantu to ikona kosza z etykietą dostępności', () => {
    assert.equal(
      /\bOdebraj\b/u.test(strona),
      false,
      'tekst Odebraj przestaje istnieć — zostaje ikona kosza',
    );
    assert.ok(
      /<IconTrash/.test(strona),
      'przycisk odbioru grantu używa IconTrash (konwencja z karty aplikacji)',
    );
    assert.ok(
      /(aria-label|title)=["'`{]?\s*"?Odbierz dostęp/u.test(strona),
      'ikonowa akcja musi mieć aria-label albo title „Odbierz dostęp"',
    );
  });

  it('sekcja „Dostęp do aplikacji" ma ikonę, nie gołe kółko', () => {
    assert.ok(
      /section-icon tone-info">\s*<IconUsers/u.test(strona),
      'span.section-icon musi zawierać <IconUsers /> (konwencja kart)',
    );
  });
});

describe('Strona /uprawnienia — licznik katalogu osób', () => {
  const strona = read('apps', 'web', 'src', 'pages', 'AccessPage.tsx');
  const hooks = read('apps', 'web', 'src', 'lib', 'queries-access.ts');
  const klucze = read('apps', 'web', 'src', 'lib', 'queries-keys.ts');
  const typy = read('apps', 'web', 'src', 'types.ts');
  void typy;

  it('pasek podsumowania jest zasilony hookiem usePersonsCount', () => {
    assert.ok(
      strona.includes('usePersonsCount'),
      'AccessPage musi wołać usePersonsCount — licznik z bazy, nie z filtrowanej listy',
    );
    assert.ok(
      /W katalogu:/.test(strona),
      'pasek podsumowania ma etykietę „W katalogu:"',
    );
  });

  it('hook i klucz zapytania są zadeklarowane', () => {
    assert.ok(
      /export function usePersonsCount\(\)/.test(hooks),
      'brak hooka usePersonsCount w queries-access.ts',
    );
    assert.ok(
      hooks.includes('/access/persons/count'),
      'hook ma celować w GET /access/persons/count',
    );
    assert.ok(
      /personsCount:\s*\['access'/.test(klucze),
      'qk.personsCount musi być zadeklarowany pod prefiksem access (wspólna invalidacja)',
    );
  });
});
