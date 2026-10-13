/**
 * Test zgodności walidacji IPv4 serwer ↔ interfejs.
 *
 * `apps/web/src/lib/ip.ts` to celowa kopia walidacji z
 * `apps/api/src/ipam/cidr.ts` (`isValidIpv4`). Kopia istnieje po to, żeby
 * użytkownik dostał komunikat pod polem, a nie dopiero po odpowiedzi 400
 * z serwera.
 *
 * Cena za powtórzenie to ryzyko rozjazdu — i dokładnie ono wystąpiło:
 * kopia w `SubnetDetailPage.tsx` dopuszczała `\d{1,2}`, czyli oktety
 * 1–2 cyfrowe. `10.1.120.120` i `192.168.100.1` były odrzucane przez
 * przeglądarkę, choć serwer je przyjmował. Ten test porównuje **werdykt**
 * obu implementacji, nie ich treść.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { isValidIpv4 } from '../src/ipam/cidr';
import { isIpv4 } from '../../web/src/lib/ip';

/**
 * Zestaw prób dobrany tak, żeby trafiać w każdą gałąź obu reguł:
 * trzycyfrowe oktety (tu był bug), oktety na granicy 255, odrzucane
 * zapisy i te, które wyglądają poprawnie, ale nie są adresem.
 */
const PROBY: string[] = [
  // Poprawne — oktety 1–2 cyfrowe (to testowały dotychczasowe testy)
  '10.20.1.15',
  '8.8.8.8',
  '0.0.0.0',
  '127.0.0.1',
  // Poprawne — oktety trzycyfrowe (regres: `\d{1,2}` je odrzucał)
  '10.1.120.120',
  '192.168.100.1',
  '10.1.255.255',
  '10.1.99.120',
  '100.100.100.100',
  // Poprawne — same skrajne wartości oktetu
  '255.255.255.255',
  // Odrzucane — poza zakresem 0–255
  '10.20.1.256',
  '10.20.1.999',
  '999.1.1.1',
  // Odrzucane — nie cztery oktety
  '10.20.1',
  '10.20.1.2.3',
  // Odrzucane — zera wiodące (notacja dwuznaczna)
  '10.020.1.15',
  '010.1.1.1',
  // Odrzucane — nie cyfry
  '10.20.1.a',
  'abc.def.1.1',
  // Odrzucane — podsieć to nie adres
  '10.20.1.15/24',
  // Odrzucane — otoczone białymi znakami
  ' 10.20.1.15',
  // Odrzucane — puste
  '',
];

describe('parzystość walidacji IPv4: interfejs ↔ serwer', () => {
  for (const adres of PROBY) {
    it(`oba znają werdykt dla ${JSON.stringify(adres)}`, () => {
      assert.equal(
        isIpv4(adres),
        isValidIpv4(adres),
        `interfejs i serwer różnią się dla ${JSON.stringify(adres)}`,
      );
    });
  }

  it('serwer przyjmuje adres z trzycyfrowymi oktetami', () => {
    // Kotwica dla powyższych: gdyby serwer sam odrzucał `10.1.120.120`,
    // zgodność byłaby pozorna — obie strony byłyby złe.
    assert.equal(isValidIpv4('10.1.120.120'), true);
    assert.equal(isIpv4('10.1.120.120'), true);
  });

  it('oba odrzucają oktety spoza zakresu', () => {
    assert.equal(isValidIpv4('10.20.1.256'), false);
    assert.equal(isIpv4('10.20.1.256'), false);
  });

  it('oba odrzucają zera wiodące', () => {
    assert.equal(isValidIpv4('10.020.1.15'), false);
    assert.equal(isIpv4('10.020.1.15'), false);
  });
});
