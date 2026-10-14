/**
 * Parser plików XML z `nmap -oX`.
 *
 * Moduł działa wyłącznie na tekście i nic nie wie o bazie danych —
 * wyciąga wyłącznie adres IPv4 oraz pierwszą nazwę hosta (`hostname`),
 * odrzucając metadane skanu, porty, adresy MAC i IPv6.
 */
import { XMLParser } from 'fast-xml-parser';
import { ipToNumber, isValidIpv4 } from './cidr';

export const MAX_XML_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_HOSTS = 10_000;

export type ScannedHost = { address: string; hostname: string | null };

export type ParseResult = {
  /** Hosty z poprawnym IPv4, posortowane numerycznie po adresie. */
  hosts: ScannedHost[];
  /** Odrzucone wiersze — do pokazania w podglądzie, nie do zapisu. */
  skipped: number;
};

export class NmapXmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NmapXmlError';
  }
}

/**
 * `processEntities: false` jest wymaganiem bezpieczeństwa, nie konfiguracją
 * smaku: bez niego plik z podstawionymi encjami `<!ENTITY>` (billion laughs /
 * XXE) rozrośnie się wykładniczo i wyciągnie proces Node.js.
 *
 * Ponieważ `processEntities: false` w `fast-xml-parser` wyłącza też pięć
 * wbudowanych encji XML, w `hostname` rozwiązujemy je ręcznie jednym
 * nierekurencyjnym przebiegiem (`decodeStandardXmlEntities`).
 */
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false,
  trimValues: true,
});

const STANDARD_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

function decodeStandardXmlEntities(text: string): string {
  return text.replace(
    /&(?:amp|lt|gt|quot|apos|#(\d+)|#x([0-9a-fA-F]+));/g,
    (match, dec: string | undefined, hex: string | undefined) => {
      if (dec !== undefined) {
        const code = Number.parseInt(dec, 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
      }
      if (hex !== undefined) {
        const code = Number.parseInt(hex, 16);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
      }
      return STANDARD_ENTITIES[match] ?? match;
    },
  );
}

function asArray<T>(val: T | T[] | undefined | null): T[] {
  if (val === undefined || val === null || val === '') return [];
  return Array.isArray(val) ? val : [val];
}

type RawAddress = {
  '@_addr'?: unknown;
  '@_addrtype'?: unknown;
};

type RawHostname = {
  '@_name'?: unknown;
};

type RawStatus = {
  '@_state'?: unknown;
};

type RawHost = {
  status?: RawStatus | RawStatus[];
  address?: RawAddress | RawAddress[];
  hostnames?:
    | { hostname?: RawHostname | RawHostname[] }
    | Array<{ hostname?: RawHostname | RawHostname[] }>
    | string;
};

/** Rzuca `NmapXmlError` przy pliku, którego nie da się użyć. */
export function parseNmapXml(xml: string): ParseResult {
  if (typeof xml !== 'string' || xml.trim().length === 0) {
    throw new NmapXmlError('Plik XML jest pusty.');
  }

  const bytes = Buffer.byteLength(xml, 'utf8');
  if (bytes > MAX_XML_BYTES) {
    throw new NmapXmlError(
      'Plik XML przekracza maksymalny rozmiar 5 MB.',
    );
  }

  // Usuwamy ewentualny BOM UTF-8 z początku pliku — edytory pod Windows
  // potrafią go dopisać przy ręcznej edycji wyniku skanu.
  const cleaned = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;

  let parsed: Record<string, unknown>;
  try {
    // Drugi argument `true` włącza walidator składni XML: bez niego
    // `fast-xml-parser` po cichu domyka obcięte znaczniki i zwraca „0 hostów".
    parsed = xmlParser.parse(cleaned, true) as Record<string, unknown>;
  } catch {
    throw new NmapXmlError(
      'Plik XML jest uszkodzony lub niekompletny — nie udało się go odczytać.',
    );
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('nmaprun' in parsed) ||
    parsed.nmaprun === undefined ||
    parsed.nmaprun === null
  ) {
    throw new NmapXmlError('Plik nie jest wynikiem nmap (-oX).');
  }

  const nmaprun = parsed.nmaprun as { host?: RawHost | RawHost[] } | string;
  const rawHosts =
    typeof nmaprun === 'object' && nmaprun !== null
      ? asArray<RawHost>(nmaprun.host)
      : [];

  if (rawHosts.length > MAX_HOSTS) {
    throw new NmapXmlError(
      'Plik zawiera ponad 10 000 hostów — podziel skan na mniejsze zakresy.',
    );
  }

  const byAddress = new Map<string, ScannedHost>();
  let skipped = 0;

  for (const rawHost of rawHosts) {
    if (!rawHost || typeof rawHost !== 'object') {
      skipped++;
      continue;
    }

    const statuses = asArray<RawStatus>(rawHost.status);
    const hasNonUpStatus = statuses.some(
      (s) =>
        s &&
        typeof s === 'object' &&
        typeof s['@_state'] === 'string' &&
        s['@_state'] !== 'up',
    );
    if (hasNonUpStatus) {
      skipped++;
      continue;
    }

    const addresses = asArray<RawAddress>(rawHost.address);
    const ipv4Entry = addresses.find(
      (a) =>
        a &&
        typeof a === 'object' &&
        a['@_addrtype'] === 'ipv4' &&
        typeof a['@_addr'] === 'string' &&
        isValidIpv4(a['@_addr']),
    );

    if (!ipv4Entry || typeof ipv4Entry['@_addr'] !== 'string') {
      skipped++;
      continue;
    }

    let hostname: string | null = null;
    if (rawHost.hostnames && typeof rawHost.hostnames === 'object') {
      const containers = asArray(rawHost.hostnames);
      for (const container of containers) {
        if (!container || typeof container !== 'object') continue;
        const hnList = asArray<RawHostname>(container.hostname);
        const firstNamed = hnList.find(
          (h) =>
            h &&
            typeof h === 'object' &&
            typeof h['@_name'] === 'string' &&
            h['@_name'].trim().length > 0,
        );
        if (firstNamed && typeof firstNamed['@_name'] === 'string') {
          hostname = decodeStandardXmlEntities(firstNamed['@_name'].trim());
          break;
        }
      }
    }

    const addr = ipv4Entry['@_addr'];
    const existing = byAddress.get(addr);
    if (existing) {
      if (!existing.hostname && hostname) {
        existing.hostname = hostname;
      }
    } else {
      byAddress.set(addr, {
        address: addr,
        hostname,
      });
    }
  }

  const hosts = [...byAddress.values()];
  hosts.sort(
    (a, b) => (ipToNumber(a.address) ?? 0) - (ipToNumber(b.address) ?? 0),
  );

  return { hosts, skipped };
}
