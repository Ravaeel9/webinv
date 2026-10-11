/**
 * Rachunek na adresach IPv4 — jedyna warstwa, w której liczymy bity.
 *
 * `Subnet.cidr` i `IpAddress.address` to zwykły `VarChar`, a nie natywny
 * `inet` w Postgresie. Świadomie: operatory SQL da się sprawdzić tylko
 * z kontenerem i bazą, a całą walidację zakresów, wykrywanie nakładania
 * i dopasowanie adresu do podsieci chcemy mieć w jednym miejscu, które
 * testuje się bez bazy.
 *
 * Konwencja: adresy trzymamy jako liczby 32-bitowe (`>>>` zeruje znak),
 * a na ekran wracają dopiero w postaci tekstowej.
 *
 * Plik jest celowo czysty — bez Prisma i bez NestJS, bo jedenaście
 * kolejnych zadań opiera się wyłącznie na tych podpisach.
 */

export type Cidr = {
  /** Adres sieciowy jako liczba 32-bitowa (10.20.0.0/16 → 0x0A140000). */
  network: number;
  /** Długość prefiksu 0–32. */
  prefix: number;
  /** Pierwszy adres w zakresie — równy `network`. */
  first: number;
  /** Adres rozgłoszeniowy, czyli ostatni w zakresie. */
  broadcast: number;
  /** Znormalizowany zapis sieci: "10.20.0.0/16". */
  text: string;
};

/**
 * Zamienia zapis kropkowy na liczbę 32-bitową; `null` gdy nie ma
 * dokładnie czterech oktetów 0–255.
 *
 * `parseInt` z bazą 10 (nie 16) jest tu istotny: bez podanej bazy
 * oktety z literami byłyby odczytane jako szesnastkowe.
 */
export function ipToNumber(text: string): number | null {
  const octets = text.split('.');
  if (octets.length !== 4) {
    return null;
  }

  let value = 0;
  for (const octet of octets) {
    const parsed = parseInt(octet, 10);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 255) {
      return null;
    }
    value = value * 256 + parsed;
  }
  return value >>> 0;
}

/** Odwrotność `ipToNumber` — liczba 32-bitowa na zapis kropkowy. */
export function numberToIp(value: number): string {
  const v = value >>> 0;
  return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join('.');
}

/** `true` dla "10.20.1.15", `false` dla "10.20.1" i "10.20.1.256". */
export function isValidIpv4(text: string): boolean {
  return ipToNumber(text) !== null;
}

/** Maska sieci dla prefiksu 0–32 (`/0` → 0, `/32` → pełne 32 jedynki). */
function prefixMask(prefix: number): number {
  // Dla /0 przesunięcie o 32 dałoby `<< 32 === << 0`, czyli maskę pełną.
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

/** Parsuje "sieć/prefiks" albo zwraca `null`. */
function splitCidr(text: string): { ip: string; prefix: number } | null {
  const parts = text.split('/');
  if (parts.length !== 2) {
    return null;
  }

  const [, rawPrefix = ''] = parts;
  // Tylko cyfry — samo `parseInt` przyjęłoby "16abc" i przeszłoby dalej.
  if (!/^\d+$/.test(rawPrefix)) {
    return null;
  }
  const prefix = parseInt(rawPrefix, 10);
  if (prefix > 32) {
    return null;
  }

  const [ip = ''] = parts;
  return { ip, prefix };
}

/**
 * `null` dla złego formatu, IPv6 i adresu z ustawionymi bitami hosta.
 *
 * Odrzucamy bity hosta, bo `10.20.1.5/24` to nie podsieć, tylko literówka:
 * gdybyśmy po cichu zapisali `10.20.0.0/24`, pokazalibyśmy użytkownikowi
 * stan inny niż wpisany.
 */
export function parseCidr(text: string): Cidr | null {
  const split = splitCidr(text);
  if (!split) {
    return null;
  }

  const ip = ipToNumber(split.ip);
  if (ip === null) {
    return null;
  }

  const { prefix } = split;
  const mask = prefixMask(prefix);
  // Bity poza prefiksem muszą być zerowe — inaczej adres nie jest adresem sieci.
  if (((ip & ~mask) >>> 0) !== 0) {
    return null;
  }

  const network = (ip & mask) >>> 0;
  return {
    network,
    prefix,
    first: network,
    broadcast: (network | (~mask >>> 0)) >>> 0,
    text: `${numberToIp(network)}/${prefix}`,
  };
}

/** Czy `ip` leży w zakresie `cidr`. */
export function ipInCidr(ip: string, cidr: Cidr): boolean {
  const value = ipToNumber(ip);
  if (value === null) {
    return false;
  }
  return value >= cidr.first && value <= cidr.broadcast;
}

/** Czy zakres `child` w całości mieści się w `parent`. Równe zakresy → true. */
export function containsSubnet(child: Cidr, parent: Cidr): boolean {
  return child.first >= parent.first && child.broadcast <= parent.broadcast;
}

/** Czy zakresy mają choć jeden wspólny adres. */
export function rangesOverlap(a: Cidr, b: Cidr): boolean {
  return a.first <= b.broadcast && b.first <= a.broadcast;
}

/**
 * Podsieć zawierająca `ip` o **największym** prefiksie (najwęższa),
 * czyli null jeśli żadna nie zawiera. Przy remisie wygrywa pierwsza
 * w kolejności argumentu.
 *
 * Wybieramy największy prefiks, nie pierwszą trafioną: podsieć `/24`
 * opisuje dokładnie swoje adresy, podczas gdy `/16` obejmuje cały blok
 * i w katalogu oznacza zupełnie inną jednostkę.
 */
export function findContainingSubnet(ip: string, subnets: Cidr[]): Cidr | null {
  const value = ipToNumber(ip);
  if (value === null) {
    return null;
  }

  let best: Cidr | null = null;
  for (const subnet of subnets) {
    const fits = value >= subnet.first && value <= subnet.broadcast;
    // Ścisłe `>` zamiast `>=`: przy remisie zostaje ta z wcześniejszego miejsca.
    if (fits && (best === null || subnet.prefix > best.prefix)) {
      best = subnet;
    }
  }
  return best;
}

/** Sortuje po `network` rosnąco, a przy równych sieciach po `prefix` rosnąco. */
export function sortCidrs(list: Cidr[]): Cidr[] {
  // Nowa tablica: kolejność z katalogu w bazie nie wolno nam zepsuć.
  return [...list].sort((a, b) => a.network - b.network || a.prefix - b.prefix);
}

/** Komunikat błędu dla DTO; `null` gdy `text` jest poprawnym CIDR. */
export function cidrErrorMessage(text: string): string | null {
  if (parseCidr(text) !== null) {
    return null;
  }

  const split = splitCidr(text);
  if (!split) {
    return 'Wpisz adres sieci w formacie CIDR, np. 10.20.0.0/16 (sieć IPv4 i długość prefiksu 0–32).';
  }
  const ip = ipToNumber(split.ip);
  if (ip === null) {
    return 'Adres IP musi mieć postać czterech oktetów 0–255, np. 10.20.0.0.';
  }

  // Do tej linii wiemy, że prefiks jest poprawny i jedynym powodem odrzucenia
  // zostały bity hosta — podpowiedzmy więc od razu właściwą sieć.
  const network = numberToIp((ip & prefixMask(split.prefix)) >>> 0);
  return `Podaj adres sieci, nie adres hosta — sieć ma bity poza prefiksem zerowe, np. ${network}/${split.prefix}.`;
}