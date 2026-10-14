import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  MAX_HOSTS,
  MAX_XML_BYTES,
  NmapXmlError,
  parseNmapXml,
} from '../src/ipam/nmap-xml';
import { read } from './helpers/repo';

describe('parseNmapXml', () => {
  it('czytaje adres i hostname', () => {
    const r = parseNmapXml(read('apps/api/test/fixtures/nmap-basic.xml'));
    assert.deepEqual(r.hosts, [
      { address: '10.20.5.7', hostname: 'jenkins' },
      { address: '10.20.5.12', hostname: null },
    ]);
  });

  it('pomija host bez adresu IPv4', () => {
    const r = parseNmapXml(read('apps/api/test/fixtures/nmap-basic.xml'));
    assert.equal(r.skipped, 1);
  });

  it('pomija IPv6, ale nie odrzuca pliku', () => {
    // Review Focus 5 — nmap dokłada IPv6 niemal zawsze. Cały plik
    // musi zostać wczytany mimo braku IPv4 u części hostów.
    const r = parseNmapXml(read('apps/api/test/fixtures/nmap-edge.xml'));
    assert.equal(r.hosts.length > 0, true);
    assert.equal(
      r.hosts.some((h) => h.address.includes(':')),
      false,
    );
    assert.equal(r.skipped, 1);
  });

  it('sortuje hosty numerycznie po adresie IPv4', () => {
    const xml =
      '<nmaprun>' +
      '<host><address addr="10.20.5.100" addrtype="ipv4"/></host>' +
      '<host><address addr="10.20.5.2" addrtype="ipv4"/></host>' +
      '<host><address addr="10.20.5.20" addrtype="ipv4"/></host>' +
      '</nmaprun>';
    const r = parseNmapXml(xml);
    assert.deepEqual(
      r.hosts.map((h) => h.address),
      ['10.20.5.2', '10.20.5.20', '10.20.5.100'],
    );
  });

  it('przeżywa BOM na początku pliku', () => {
    assert.equal(
      parseNmapXml(
        '\uFEFF<?xml version="1.0"?><nmaprun><host><address addr="10.20.5.7" addrtype="ipv4"/></host></nmaprun>',
      ).hosts.length,
      1,
    );
  });

  it('rozwiązuje encje w hostname', () => {
    const r = parseNmapXml(
      '<nmaprun><host><address addr="10.20.5.7" addrtype="ipv4"/><hostnames><hostname name="a&amp;b"/></hostnames></host></nmaprun>',
    );
    assert.equal(r.hosts[0]?.hostname, 'a&b');
  });

  it('odrzuca plik, którego nie da się sparsować', () => {
    // Review Focus 1 — „0 hostów" bez powodu wygląda jak pusta sieć.
    assert.throws(() => parseNmapXml('<nmaprun><host>'), NmapXmlError);
  });

  it('odrzuca plik bez korzenia nmaprun', () => {
    assert.throws(
      () => parseNmapXml('<html><body>404</body></html>'),
      NmapXmlError,
    );
  });

  it('odrzuca plik przekraczający limit rozmiaru 5 MB', () => {
    const duzy = '<nmaprun>' + 'a'.repeat(MAX_XML_BYTES) + '</nmaprun>';
    assert.throws(() => parseNmapXml(duzy), NmapXmlError);
  });

  it('odrzuca plik przekraczający limit hostów', () => {
    // Zbuduj wejście z 10 001 hostami i sprawdź komunikat.
    const xml = `<nmaprun>${'<host><address addr="10.20.5.7" addrtype="ipv4"/></host>'.repeat(MAX_HOSTS + 1)}</nmaprun>`;
    assert.throws(() => parseNmapXml(xml), /10 000/);
  });

  it('deduplikuje powtórzone adresy IPv4 i zachowuje niepusty hostname', () => {
    const xml =
      '<nmaprun>' +
      '<host><status state="up"/><address addr="10.20.5.7" addrtype="ipv4"/></host>' +
      '<host><status state="up"/><address addr="10.20.5.7" addrtype="ipv4"/><hostnames><hostname name="jenkins"/></hostnames></host>' +
      '</nmaprun>';
    const r = parseNmapXml(xml);
    assert.deepEqual(r.hosts, [{ address: '10.20.5.7', hostname: 'jenkins' }]);
  });

  it('pomija hosty ze statusem state="down"', () => {
    const xml =
      '<nmaprun>' +
      '<host><status state="down"/><address addr="10.20.5.1" addrtype="ipv4"/></host>' +
      '<host><status state="up"/><address addr="10.20.5.7" addrtype="ipv4"/></host>' +
      '</nmaprun>';
    const r = parseNmapXml(xml);
    assert.deepEqual(r.hosts, [{ address: '10.20.5.7', hostname: null }]);
    assert.equal(r.skipped, 1);
  });
});
