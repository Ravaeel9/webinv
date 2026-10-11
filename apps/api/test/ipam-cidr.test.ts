/**
 * Rachunek na adresach IPv4.
 *
 * Kolumny `Subnet.cidr` i `IpAddress.address` to zwykły `VarChar`, a nie
 * natywny `inet` — cała walidacja, wykrywanie nakładania i dopasowanie
 * adresu do podsieci mieszka więc w tym jednym pliku.
 *
 * Te testy pilnują dwóch rzeczy, które łatwo zepsuć po cichu: odrzucania
 * adresów z ustawionymi bitami hosta (użytkownik pisze `10.20.1.5/24`, a my
 * zapisalibyśmy `10.20.0.0/24` i pokazali stan inny niż wpisany) oraz
 * rozróżniania *nakładania* się zakresów od *zawierania* — pół-sieci stykające
 * się granicą nakładają się, choć żadna nie zawiera drugiej.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  type Cidr,
  cidrErrorMessage,
  containsSubnet,
  findContainingSubnet,
  ipInCidr,
  ipToNumber,
  isValidIpv4,
  numberToIp,
  parseCidr,
  rangesOverlap,
  sortCidrs,
} from '../src/ipam/cidr';

/** Parsuje poprawny CIDR; rzuca, jeśli test użył złego przykładu. */
function c(text: string): Cidr {
  const parsed = parseCidr(text);
  assert.ok(parsed, `test użył niepoprawnego CIDR: ${text}`);
  return parsed;
}

describe('parseCidr', () => {
  it('czytuje poprawną sieć', () => {
    const parsed = parseCidr('10.20.0.0/16');
    assert.equal(parsed?.text, '10.20.0.0/16');
    assert.equal(parsed?.broadcast, ipToNumber('10.20.255.255'));
  });

  it('odrzuca /33, bo IPv4 ma 32 bity', () => {
    assert.equal(parseCidr('10.20.0.0/33'), null);
  });

  it('odrzuca adres spoza zakresu oktetu', () => {
    assert.equal(parseCidr('999.1.1.1/8'), null);
  });

  it('odrzuca zapis bez prefiksu', () => {
    assert.equal(parseCidr('10.20.0.0'), null);
  });

  it('odrzuca adres z ustawionymi bitami hosta', () => {
    // Użytkownik pisze "10.20.1.5/24", a my zapisalibyśmy "10.20.0.0/24".
    // Cicho zamieniając adres na sieć, pokazalibyśmy stan inny niż wpisany.
    assert.equal(parseCidr('10.20.1.5/24'), null);
  });

  it('odrzuca IPv6', () => {
    assert.equal(parseCidr('fd00::/8'), null);
  });

  it('liczy adres rozgłoszeniowy dla /30', () => {
    assert.equal(parseCidr('10.20.0.4/30')?.broadcast, ipToNumber('10.20.0.7'));
  });

  it('czytuje /0 i /32', () => {
    assert.equal(parseCidr('0.0.0.0/0')?.broadcast, ipToNumber('255.255.255.255'));
    assert.equal(parseCidr('10.20.0.1/32')?.broadcast, ipToNumber('10.20.0.1'));
  });

  it('odrzuca pusty prefiks i ujemny prefiks', () => {
    assert.equal(parseCidr('10.20.0.0/'), null);
    assert.equal(parseCidr('10.20.0.0/-1'), null);
  });

  it('odrzuca za dużo części po ukośniku', () => {
    assert.equal(parseCidr('10.20.0.0/16/24'), null);
  });
});

describe('isValidIpv4 i ipToNumber', () => {
  it('akceptuje pełny adres i odrzuca niepełny', () => {
    assert.equal(isValidIpv4('10.20.1.15'), true);
    assert.equal(isValidIpv4('10.20.1'), false);
  });

  it('odrzuca oktet spoza zakresu', () => {
    assert.equal(isValidIpv4('10.20.1.256'), false);
  });

  it('odrzuca oktety ze znakiem, bo wypadają poza zakres 0–255', () => {
    assert.equal(isValidIpv4('10.20.1.-1'), false);
  });

  it('zapętla liczby w całym zakresie 32-bitowym', () => {
    assert.equal(ipToNumber('0.0.0.0'), 0);
    assert.equal(ipToNumber('255.255.255.255'), 4294967295);
  });
});

describe('numberToIp', () => {
  it('zamienia największą liczbę na adres', () => {
    assert.equal(numberToIp(4294967295), '255.255.255.255');
  });

  it('zamienia zero na adres zerowy', () => {
    assert.equal(numberToIp(0), '0.0.0.0');
  });

  it('zachowuje oktety powyżej 255, bo liczba 32-bitowa je dopuszcza', () => {
    // np. maska podsieci albo `~mask` — gdyby obcięliśmy 24 bity, kontrola
    // "bitów hosta" w parseCidr działałaby na ułamkach.
    assert.equal(numberToIp(0xffffff00), '255.255.255.0');
  });
});

describe('ipInCidr', () => {
  it('adres w zakresie należy do podsieci', () => {
    assert.equal(ipInCidr('10.20.5.7', c('10.20.0.0/16')), true);
  });

  it('adres spoza zakresu nie należy do podsieci', () => {
    assert.equal(ipInCidr('10.21.0.1', c('10.20.0.0/16')), false);
  });

  it('niepoprawny adres nie należy do żadnej podsieci', () => {
    assert.equal(ipInCidr('nie-adres', c('10.20.0.0/16')), false);
  });
});

describe('containsSubnet', () => {
  it('równe zakresy zawierają się', () => {
    assert.ok(containsSubnet(c('10.20.0.0/16'), c('10.20.0.0/16')));
  });

  it('węższy mieści się w szerszym', () => {
    assert.ok(containsSubnet(c('10.20.5.0/24'), c('10.20.0.0/16')));
  });

  it('szerszy nie mieści się w węższym', () => {
    assert.equal(containsSubnet(c('10.20.0.0/16'), c('10.20.5.0/24')), false);
  });

  it('sąsiadujące podsieci nie zawierają się', () => {
    assert.equal(containsSubnet(c('10.21.0.0/16'), c('10.20.0.0/16')), false);
  });
});

describe('rangesOverlap', () => {
  it('dwie połówki /16 rozchodzące się na granicy nie nakładają się', () => {
    // /17 rozcina trzeci oktet na jego najwyższym bicie: 10.20.0.0/17 kończy
    // się na 10.20.127.255, a 10.20.128.0/128 zaczyna dopiero wtedy.
    // To dwa kawałki rozcinające jedno /16, nie nakładanie.
    assert.equal(rangesOverlap(c('10.20.0.0/17'), c('10.20.128.0/17')), false);
  });

  it('podsieć wewnątrz innej nakłada się z nią', () => {
    assert.equal(rangesOverlap(c('10.20.0.0/16'), c('10.20.128.0/17')), true);
  });

  it('podsieci obok siebie nie nakładają się', () => {
    assert.equal(rangesOverlap(c('10.20.0.0/16'), c('10.21.0.0/16')), false);
  });

  it('podsieć zawarta w innej nakłada się z nią', () => {
    // Kolizja w katalogu opiera się o nakładanie, nie o zawieranie —
    // inaczej `10.20.5.0/24` przeszłoby obok `10.20.0.0/16`.
    assert.equal(rangesOverlap(c('10.20.5.0/24'), c('10.20.0.0/16')), true);
  });
});

describe('findContainingSubnet', () => {
  const subnets = [c('10.20.0.0/16'), c('10.20.5.0/24')];

  it('przy kilku pasujących zwraca tę z najdłuższym prefiksem', () => {
    assert.equal(findContainingSubnet('10.20.5.7', subnets)?.text, '10.20.5.0/24');
  });

  it('adres spoza wszystkich podsieci nie pasuje', () => {
    assert.equal(findContainingSubnet('10.30.0.1', subnets), null);
  });

  it('przy remisie prefiksów wygrywa pierwsza z kolejności', () => {
    const same = [c('10.20.0.0/24'), c('10.20.0.0/24')];
    assert.equal(findContainingSubnet('10.20.0.9', same)?.text, '10.20.0.0/24');
  });
});

describe('sortCidrs', () => {
  it('sortuje numerycznie, nie leksykograficznie', () => {
    // Leksykograficznie "10.10.0.0" < "10.9.0.0", bo '1' < '9'.
    assert.deepEqual(
      sortCidrs([c('10.9.0.0/16'), c('10.10.0.0/16')]).map((x) => x.text),
      ['10.9.0.0/16', '10.10.0.0/16'],
    );
  });

  it('przy równych sieciach ustawia krótszy prefiks pierwszy', () => {
    assert.deepEqual(
      sortCidrs([c('10.20.0.0/24'), c('10.20.0.0/16')]).map((x) => x.text),
      ['10.20.0.0/16', '10.20.0.0/24'],
    );
  });

  it('nie mutuje argumentu', () => {
    const input = [c('10.10.0.0/16'), c('10.9.0.0/16')];
    sortCidrs(input);
    assert.equal(input[0]?.text, '10.10.0.0/16');
  });
});

describe('cidrErrorMessage', () => {
  it('poprawny CIDR nie daje błędu', () => {
    assert.equal(cidrErrorMessage('10.20.0.0/16'), null);
  });

  it('błąd dla adresu z bitami hosta wymienia sieć', () => {
    const message = cidrErrorMessage('10.20.1.5/24');
    assert.ok(message);
    assert.match(message, /sieć/);
  });

  it('błąd wymienia powód: format, prefiks, zakres oktetu', () => {
    assert.ok(cidrErrorMessage('10.20.0.0'));
    assert.ok(cidrErrorMessage('10.20.0.0/33'));
    assert.ok(cidrErrorMessage('999.1.1.1/8'));
  });
});