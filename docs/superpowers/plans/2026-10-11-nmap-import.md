# Import adresów z pliku nmap — Plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wgrać do IPAM plik `nmap -oX`, zobaczyć podgląd tego, co się zmieni, i zatwierdzić zapis — bez udziału serwera w skanowaniu sieci.

**Architecture:** `POST /api/ipam/import/preview` parsuje XML w pamięci i **nic nie zapisuje** — zwraca trzy grupy. Użytkownik wybiera pozycje na ekranie, a `POST /api/ipam/import/apply` dostaje jawną listę i zapisuje ją `upsert`-em w transakcji. Serwer nigdy nie wykonuje nmapa; plik powstaje na stacji użytkownika i trafia do przeglądarki jak zwykły upload.

**Tech Stack:** NestJS 11 + Fastify 5, `fast-xml-parser` (jedyna nowa zależność tego planu), Prisma 6, React 19 + TanStack Query. Testy: `node:test` przez `tsx`, bez bazy.

**Spec:** `docs/superpowers/specs/2026-10-11-ipam-design.md`, sekcja 5. Zakłada, że plan `docs/superpowers/plans/2026-10-11-ipam-catalog.md` jest **w całości wdrożony** — ten plan korzysta z `cidr.ts`, `IpamService`, `IpamPort`, uprawnień `ipam:*` i pola `lastSeenAt`, których nie tworzy sam.

## Global Constraints

- Node `>=22`, npm workspaces. Komendy z roza katalogu repo.
- Testy: `npm run test --workspace @webinv/api` — **bez bazy danych**.
- **Jedyna nowa zależność to `fast-xml-parser`.** Dodaj ją do `dependencies` pakietu `apps/api`, przypiętą dokładną wersją (styl repo: wersje bez `^`, np. `fast-xml-parser`: `"5.2.5"`).
- Teksty po polsku; nazwy plików i tras bez diakrytyków.
- Komentarze po polsku, z powodem — nie z opisem.
- Pola JSON w `AuditLog` maks. 200 znaków na wartość — pilnuje tego `AuditService.diff`. Nie zapisuj do dziennika listy adresów.

## Review Focus

1. **Uszkodzony lub obcięty plik XML** — parser nie może zwrócić „0 znalezionych hostów" i nie powiedzieć, że plik jest zły. Użytkownik musi dostać komunikat z powodem, inaczej pomyśli, że sieć jest pusta. → Task 1
2. **Wgranie pliku wielokrotnie, po korekcie podsieci** — `apply` musi być idempotentny. Drugie wgranie tego samego pliku nie może utworzyć duplikatu ani zgubić ręcznie dodanych adresów. → Task 4
3. **XML z encjami i z BOM-em** — nmap zapisuje plik jako UTF-8, ale użytkownik może edytować go w edytorze tekstu i nadpisać hostname znakami spoza ASCII albo zostawić BOM na początku. Parser ma to przeżyć, a nie wyciąć plik do połowy. → Task 1
4. **Skan z prywatnej podsieci wgrany do pustego katalogu** — wszystko ląduje w grupie „nieprzypisane". Ekran nie może na to pozwolić bez świadomego wyboru podsieci dla każdego hosta, bo przypisanie „w ciemno" do najszerszej podsieci byłoby błędem po cichu. → Task 4
5. **Hosty spoza IPv4** — nmap zawsze dokłada metadane i często IPv6. Parser ma je **pominąć cicho**, ale nie wolno mu przez to odrzucić całego pliku. → Task 1

---

## Struktura plików

| Plik | Odpowiedzialność (jedna) |
|---|---|
| `apps/api/src/ipam/nmap-xml.ts` | Tekst XML → lista `{ address, hostname }`. Nic nie wie o bazie. |
| `apps/api/test/fixtures/nmap-*.xml` | Małe pliki przykładowe dla testów. |
| `apps/api/test/nmap-xml.test.ts` | Parsowanie i limity. |
| `apps/api/test/ipam-import.test.ts` | Podgląd, dopasowanie, zapis, idempotencja. |
| `apps/web/src/pages/ImportPage.tsx` | Upload → podgląd trzech grup → zatwierdzenie. |
| `apps/web/src/lib/queries.ts` | Hooki `useImportPreview()`, `useApplyImport()`. |
| `apps/api/src/main.ts` | `bodyLimit` 2 MB → 6 MB (patrz Task 1). |

---

### Task 1: Parser XML

**Files:**
- Modify: `apps/api/package.json` (zależność)
- Modify: `apps/api/src/main.ts:19-23` (`bodyLimit`)
- Create: `apps/api/src/ipam/nmap-xml.ts`
- Create: `apps/api/test/fixtures/nmap-basic.xml`, `nmap-edge.xml`
- Test: `apps/api/test/nmap-xml.test.ts`

**Interfaces:**
- Consumes: brak (moduł nie zależy od reszty IPAM).
- Produces:

```ts
export type ScannedHost = { address: string; hostname: string | null };

export type ParseResult = {
  /** Hosty z poprawnym IPv4, posortowane numerycznie po adresie. */
  hosts: ScannedHost[];
  /** Odrzucone wiersze — do pokazania w podglądzie, nie do zapisu. */
  skipped: number;
};

/** Rzuca `NmapXmlError` przy pliku, którego nie da się użyć. */
export function parseNmapXml(xml: string): ParseResult;

export class NmapXmlError extends Error {
  constructor(message: string);
}
```

Limity eksportowane jako stałe, bo potrzebne w komunikatach:

```ts
export const MAX_XML_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_HOSTS = 10_000;
```

- [ ] **Step 1: Napisz fixture'y**

`nmap-basic.xml` — dwa hosty, jeden z hostname, jeden bez, oraz `<host>` z samym `status="up"` bez `<address>`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<nmaprun scanner="nmap" version="7.94">
  <host><status state="up"/><address addr="10.20.5.7" addrtype="ipv4"/><hostnames><hostname name="jenkins"/></hostnames></host>
  <host><status state="up"/><address addr="10.20.5.12" addrtype="ipv4"/><hostnames></hostnames></host>
  <host><status state="up"/></host>
</nmaprun>
```

`nmap-edge.xml` — BOM na początku pliku, encja `&amp;` w hostname, host z IPv4 i IPv6 naraz, host z wyłącznie IPv6.

- [ ] **Step 2: Napisz testy**

```ts
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
    assert.equal(r.hosts.some((h) => h.address.includes(':')), false);
  });
  it('przeżywa BOM na początku pliku', () => {
    assert.equal(parseNmapXml('\uFEFF<?xml version="1.0"?><nmaprun><host><address addr="10.20.5.7" addrtype="ipv4"/></host></nmaprun>').hosts.length, 1);
  });
  it('rozwiązuje encje w hostname', () => {
    const r = parseNmapXml('<nmaprun><host><address addr="10.20.5.7" addrtype="ipv4"/><hostnames><hostname name="a&amp;b"/></hostnames></host></nmaprun>');
    assert.equal(r.hosts[0].hostname, 'a&b');
  });
  it('odrzuca plik, którego nie da się sparsować', () => {
    // Review Focus 1 — „0 hostów" bez powodu wygląda jak pusta sieć.
    assert.throws(() => parseNmapXml('<nmaprun><host>'), NmapXmlError);
  });
  it('odrzuca plik bez korzenia nmaprun', () => {
    assert.throws(() => parseNmapXml('<html><body>404</body></html>'), NmapXmlError);
  });
  it('odrzuca plik przekraczający limit hostów', () => {
    // Zbuduj wejście z 10 001 hostami i sprawdź komunikat.
    const xml = `<nmaprun>${'<host><address addr="10.20.5.7" addrtype="ipv4"/></host>'.repeat(MAX_HOSTS + 1)}</nmaprun>`;
    assert.throws(() => parseNmapXml(xml), /10 000/);
  });
});
```

Wzorzec czytania pliku: `read()` z `apps/api/test/helpers/repo.ts`.

Test „odrzuca plik przekraczający limit hostów" jest celowo kosztowny (10 001 hostów w jednym napisie). Jeśli `npm test` zrobi się zbyt wolny, ogranicz wczytanie parsera — **nie** podnoś limitu, bo limit właśnie przed czymś chroni.

- [ ] **Step 3: Dodaj zależność i podnieś limit**

`npm install --workspace @webinv/api fast-xml-parser@5.2.5` (przepisze `package.json` i `package-lock.json`).

W `apps/api/src/main.ts` zmień `bodyLimit: 2 * 1024 * 1024` na `6 * 1024 * 1024` z komentarzem: import nmap przyjmuje plik do 5 MB, a globalny limit jest tylko zaporą przed plikami większymi; właściwą granicę sprawdza `parseNmapXml`. **Nie podnoś go w nieskończoność** — to limit globalny dla wszystkich tras.

- [ ] **Step 4: Napisz `nmap-xml.ts`**

`new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', processEntities: false, trimValues: true })`.

`processEntities: false` jest **wymaganiem bezpieczeństwa**, nie konfiguracją smaku: bez niego plik z podstawionymi encjami rozrośnie się wykładniczo i wyciągnie proces. Dopisz to w komentarzu.

Kolejność: sprawdź `MAX_XML_BYTES` na `Buffer.byteLength(xml, 'utf8')`, potem parsuj, potem `if (!parsed.nmaprun) throw new NmapXmlError('Plik nie jest wynikiem nmap (-oX).')`. Zbierz adresy z `host.address` tam, gdzie `@_addrtype === 'ipv4'` i `isValidIpv4('@_addr')` z `cidr.ts` — **to istniejące funkcje z planu katalogu IPAM, nie pisz ich drugich kopii**. Hosty bez poprawnego IPv4 zwiększają `skipped`.

Posortuj `hosts` rosnąco przez `ipToNumber(h.address)` z `cidr.ts` i `Array.prototype.sort`. Nie ma w `cidr.ts` funkcji sortującej adresy — `sortCidrs` sortuje podsieci po `network`, nie po adresie hosta.

Sprawdź limit **przed** zwróceniem wyniku i rzuć `NmapXmlError` z komunikatem zawierającym liczbę `10 000`.

- [ ] **Step 5: Uruchom testy**

Run: `npm run test --workspace @webinv/api`
Expected: PASS dla `nmap-xml.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json package-lock.json apps/api/src/main.ts apps/api/src/ipam/nmap-xml.ts apps/api/test
git commit -m "feat(ipam): parser wyników nmap w formacie XML"
```

---

### Task 2: Podgląd importu

**Files:**
- Modify: `apps/api/src/ipam/ipam.service.ts`
- Modify: `apps/api/src/ipam/ipam.controller.ts`
- Create: `apps/api/src/ipam/dto/import.dto.ts`
- Test: `apps/api/test/ipam-import.test.ts`

**Interfaces:**
- Consposes: `parseNmapXml`, `ParseResult` (Task 1); `findContainingSubnet`, `parseCidr`, `isValidIpv4` (plan katalogu IPAM, Task 2); `IpamService` i `IpamPort`.
- Produces: `IpamService.previewImport(xml: string)` oraz DTO dla apply (Task 3).

```ts
export type PreviewRow = {
  address: string;
  hostname: string | null;
  /** Opis z istniejącego rekordu — do pokazania różnicy. */
  existingDescription: string | null;
};

export type ImportPreview = {
  /** Adres z pliku, którego nie ma w podsieci wskazanej przez CIDR. */
  new: (PreviewRow & { subnetId: string; subnetName: string; cidr: string })[];
  /** Adres już zarejestrowany — z podpowiedzią podsieci, do której należy. */
  existing: (PreviewRow & { id: string; status: IpAddressStatus; subnetId: string; subnetName: string })[];
  /** Adres spoza wszystkich podsieci — administrator musi wskazać podsieć ręcznie. */
  unmatched: PreviewRow[];
  skipped: number;
};
```

- [ ] **Step 1: Napisz `import.dto.ts`**

```ts
export class ImportSelectionDto {
  address: string;   // @IsString, @MaxLength(18), @IsIpv4()
  subnetId: string;  // @IsUUID('4')
  description?: string; // @IsOptional, @IsString, @MaxLength(2000)
}
export class ApplyImportDto {
  selections: ImportSelectionDto[]; // @IsArray, @ValidateNested({each:true}), @Type(() => ImportSelectionDto), @ArrayMaxSize(MAX_HOSTS)
}
```

`@IsIpv4()` jest z `class-validator` — użyj go, nie pisz własnego wzorca.

- [ ] **Step 2: Napisz testy podglądu**

```ts
it('kwalifikuje nowy adres do najwęższej podsieci', async () => {
  const r = await serwis(port({ podsieci: [subnet('10.20.0.0/16', 'Sieć'), subnet('10.20.5.0/24', 'Serwery')] }))
    .previewImport(xmlZHostem('10.20.5.7', 'jenkins'));
  assert.equal(r.new.length, 1);
  assert.equal(r.new[0].subnetName, 'Serwery'); // nie 'Sieć' — węższa wygrywa
});

it('kwalifikuje istniejący adres do grupy existing', async () => {
  const r = await serwis(port({ podsieci: [subnet('10.20.0.0/16', 'Sieć')], ipAddresses: [adres('10.20.5.7', 'stary opis')] }))
    .previewImport(xmlZHostem('10.20.5.7', 'jenkins'));
  assert.equal(r.existing.length, 1);
  assert.equal(r.existing[0].existingDescription, 'stary opis');
});

it('daje adres spoza wszystkich podsieci do unmatched', async () => {
  const r = await serwis(port({ podsieci: [subnet('10.20.0.0/16', 'Sieć')] }))
    .previewImport(xmlZHostem('192.168.5.7', null));
  assert.equal(r.unmatched.length, 1);
});

it('pusty katalog daje cały plik jako unmatched', () => {
  // Review Focus 4 — to pierwszy import realnej sieci i najczęstszy scenariusz.
  // Ekran musi wymusić ręczny wybór podsieci dla każdego adresu.
  assert.equal(r.unmatched.length, r.new.length + r.existing.length);
});
```

Dalej: `previewImport` na złym XML przekazuje `NmapXmlError` do warstwy HTTP (test jednostkowy sprawdza tylko, że nie zwraca wyniku); `preview` **nie wykonuje żadnego zapisu** — asercja na atrapze, że `ipAddress.upsert`, `create` i `update` nie zostały wywołane. Ta ostatnia jest najważniejsza: podgląd, który cokolwiek zapisuje, przy 500 hostów zrobi bałagan bez pytania.

- [ ] **Step 3: Uruchom i potwierdź błąd**

Run: `npm run test --workspace @webinv/api 2>&1 | grep -i "ipam-import"`
Expected: brak metody `previewImport`.

- [ ] **Step 4: Zaimplementuj `previewImport`**

Wczytaj wszystkie podsieci raz i zmapuj je przez `parseCidr`. Wczytaj adresy tylko dla podsieci, w których cokolwiek dopasowano (mniejsze zapytanie niż „wszystkie adresy"). Dla każdego hosta: `findContainingSubnet(address, cidry)` — **funkcja z planu katalogu zwraca najwęższą podsieć**, więc nie powtarzaj tu wyboru. Brak dopasowania → `unmatched`. Dopasowanie bez istniejącego rekordu → `new`, z dopasowaniem → `existing`.

`previewImport` **nie zapisuje niczego** — to jest cała wartość tego kroku.

- [ ] **Step 5: Dodaj trasę**

`@Post('import/preview')` z `@RequirePermission('ipam:write')`, `@Body('xml') xml: string`, limit rozmiaru sprawdzany w `parseNmapXml`. Złapanie `NmapXmlError` → `BadRequestException(e.message)`. Uwaga na trasę: `@Post('import/preview')` musi być zadeklarowane **przed** trasami z `:id`, inaczej Fastify potraktuje `import` jako identyfikator.

- [ ] **Step 6: Uruchom testy**

Run: `npm run test --workspace @webinv/api && npm run typecheck --workspace @webinv/api`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/ipam apps/api/test/ipam-import.test.ts
git commit -m "feat(ipam): podgląd importu z pliku nmap bez zapisu"
```

---

### Task 3: Zapis zatwierdzonego importu

**Files:**
- Modify: `apps/api/src/ipam/ipam.service.ts`
- Modify: `apps/api/src/ipam/ipam.controller.ts`
- Modify: `apps/api/test/ipam-import.test.ts`

**Interfaces:**
- Consumes: `ApplyImportDto` (Task 2), `IpamService`, `IpamPort`.
- Produces: `IpamService.applyImport(dto, actor, ip)` oraz trasa `POST /api/ipam/import/apply`.

- [ ] **Step 1: Napisz testy zapisu**

```ts
it('odrzuca pozycję z nieznanym adresem podsieci', async () => {
  await assert.rejects(
    () => serwis(port({})).applyImport({ selections: [{ address: '10.20.5.7', subnetId: 'nie-uuid' }] }, AKTOR),
    /nie istnieje/,
  );
});

it('odrzuca adres spoza wskazanej podsieci', async () => {
  // Administrator mógł wybrać podsieć z rozwijanej listy, ale lista
  // pochodzi z podglądu sprzed godziny — dane mogły się rozjechać.
  await assert.rejects(
    () => serwis(port({ podsieci: [subnet('10.20.0.0/16', 'Sieć')] }))
      .applyImport({ selections: [{ address: '192.168.1.5', subnetId: PODNET_ID }] }, AKTOR),
    /poza zakresem/,
  );
});

it('zapisuje zatwierdzone adresy i ustawia lastSeenAt', async () => {
  await serwis(p).applyImport({ selections: [{ address: '10.20.5.7', subnetId: PODNET_ID }] }, AKTOR);
  // assertuj na atrapie, że create/upsert dostał lastSeenAt !== null
});

it('drugie wgranie tego samego pliku nie tworzy duplikatu', async () => {
  // Review Focus 2 — upsert, nie create. Wywołanie apply dwa razy
  // z tym samym wejściem daje ten sam stan, bez wyjątku.
  await serwis(p).applyImport(dto, AKTOR);
  await serwis(p).applyImport(dto, AKTOR);
  // asercja: brak createMany z duplikatem; stan identyczny
});

it('loguje jeden wpis audytu dla całego importu', async () => {
  await serwis(p).applyImport({ selections: trzyPozycje }, AKTOR);
  assert.equal(dziennik.length, 1);
  assert.equal(dziennik[0].action, 'ip_addresses.import');
});
```

- [ ] **Step 2: Uruchom i potwierdź błąd**

Run: `npm run test --workspace @webinv/api 2>&1 | grep -i "ipam-import"`
Expected: brak `applyImport`.

- [ ] **Step 3: Zaimplementuj `applyImport`**

`$transaction` obejmujący cały zapis. Kolejność: (1) pobierz wskazane podsieci, (2) dla każdej pozycji sprawdź, że podsieć istnieje i zawiera adres — **oba błędy to `BadRequestException`**, bo to dane z ekranu sprzed czasu, nie intencja użytkownika, (3) `upsert` po klawiszu `subnetId_address` (to odpowiednik `@@unique([subnetId, address])` w Prismie) z `lastSeenAt: new Date()`.

`description` przy `update` ustawiaj tylko wtedy, gdy w ładunku jest podane. Inaczej ponowne wgranie pliku **wyczyściłoby ręcznie opisane adresy** — cichy niszczenie danych przy najczęstszej operacji.

- [ ] **Step 4: Dodaj trasę i wpis audytu**

`@Post('import/apply')` z `@RequirePermission('ipam:write')`, `@CurrentUser() actor`, `@ClientIp() ip`. Audyt: `entity: 'Subnet'`, `action: 'ip_addresses.import'`, `changes: { count: { from: null, to: N }, source: { from: null, to: 'nmap-xml' } }`. **Bez listy adresów** — przy 500 hostach przekroczyłaby limit wartości w dzienniku i zaśmieciła listę zdarzeń.

- [ ] **Step 5: Uruchom testy**

Run: `npm run test --workspace @webinv/api`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ipam apps/api/test/ipam-import.test.ts
git commit -m "feat(ipam): zapis zatwierdzonego importu z pliku nmap"
```

---

### Task 4: Ekran importu

**Files:**
- Create: `apps/web/src/pages/ImportPage.tsx`
- Modify: `apps/web/src/lib/queries.ts` (hooki i klucze)
- Modify: `apps/web/src/types.ts` (typy odpowiedzi)
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/pages/IpamListPage.tsx` (przycisk wejścia)

**Interfaces:**
- Consposes: `POST /api/ipam/import/preview` i `POST /api/ipam/import/apply` (Tasky 2–3), `useSubnets` (plan katalogu IPAM).
- Produces: hooki `useImportPreview()`, `useApplyImport()` oraz trasa `/ipam/import` — podmienia `ipam/nowa` w kolejności tras!

- [ ] **Step 1: Dodaj typy i hooki**

`types.ts`: `ImportPreviewRow`, `ImportPreview`. `queries.ts`: klucze `importPreview` i `importApply`, mutacja `useApplyImport()` unieważniająca po sukcesie `qk.subnets` **oraz** `qk.ipamAddresses` dla każdej podsieci objętej importem — po imporcie liczniki na liście i dane na karcie aplikacji muszą być odświeżone, inaczej użytkownik od razu zobaczy nieaktualne liczby.

- [ ] **Step 2: Dodaj trasę przed parametrami**

W `router.tsx`, wewnątrz gałęzi `RequireAuth`, **przed** `{ path: 'ipam/:id' }` dodaj `ipam/import` z `RequirePermission permission="ipam:write"`. Kolejność jest tu kwestią działania, nie stylu: `ipam/import` za trasą z parametrem nigdy by się nie otworzyło.

- [ ] **Step 3: Napisz `ImportPage`**

Trzy etapy na jednej stronie, stan w lokalnym `useState`:

1. **Upload.** `<input type="file" accept=".xml">`, nazwa pliku i rozmiar po wyborze. Pod spodem stały blok instrukcji z poleceniem `nmap -oX wynik.xml <zakres>` w elemencie `<code>`, podpowiedzią `-sn` (szybki sweep bez portów) i informacją, że nmap wymaga uprawnień administratora na stacji skanującej. Pod tekstem jedno zdanie wprost: **serwer nie skanuje niczego — powstaje plik, który wgrywasz tutaj.** Bez tego zdania użytkownik będzie szukał pola „zakres do skanowania”, którego nie ma.
2. **Podgląd.** Po `preview` pokaż trzy grupy: nowe, istniejące (z porównaniem opisu starego i nowego), nieprzypisane. Checkboxy domyślnie zaznaczone tylko w grupie „nowe". Każdy wiersz pokazuje adres, hostname i podsieć docelową. Grupa „nieprzypisane" wymaga wyboru podsieci z listy rozwijanej i jest domyślnie odznaczona. Nagłówek pokazuje liczbę pominiętych wierszy z `skipped`, z wyjaśnieniem, że to IPv6 lub hosty bez adresu IPv4.
3. **Zapis.** `apply` z zatwierdzonymi pozycjami. Ekran bez zaznaczonych pozycji ma przycisk nieaktywny — i tłumaczy, dlaczego (`nic nie zaznaczono`).

Przycisk wejścia „Importuj z nmap" na `IpamListPage`, widoczny tylko przy `can(role, 'ipam:write')`.

- [ ] **Step 4: Sprawdź kompilację i przepływ**

Run: `npm run typecheck --workspaces --if-present && npm run test:web-build && npm run test --workspace @webinv/api`
Expected: PASS.

Sprawdzenie ręczne: wygeneruj `nmap -oX /tmp/wynik.xml 127.0.0.1/32` (localhost, bez uprawnień), wgraj plik → podgląd → wskazaj podsieć dla adresu `127.0.0.1` → zapis → adres pojawia się na liście z `lastSeenAt`. Wgraj ten sam plik ponownie → **zero duplikatów**, opisy zachowane. Wgraj plik uszkodzony (`echo '<html>' > /tmp/zepsuty.xml`) → czytelny komunikat, nie pusty ekran.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): ekran importu adresów z pliku nmap"
```

---

### Task 5: Dokumentacja importu

**Files:**
- Modify: `docs/API.md`
- Modify: `docs/INSTALACJA.md` (sekcja o narzędziach administratora)

**Interfaces:**
- Consposes: Taski 1–4.

- [ ] **Step 1: Opisz obie trasy w `docs/API.md`**

`POST /api/ipam/import/preview` i `POST /api/ipam/import/apply`, ich ładunki, uprawnienie `ipam:write` i fakt, że `preview` nic nie zapisuje.

- [ ] **Step 2: Dopisz instrukcję w `docs/INSTALACJA.md`**

Krótka procedura: zainstaluj `nmap`, przeskanuj zakres z prawami administracyjnymi, przejrzyj podgląd, zatwierdź. Zaznacz, że konto administratora systemu nie jest potrzebne — plik powstaje na stacji, do której administrator ma dostęp.

- [ ] **Step 3: Commit**

```bash
git add docs
git commit -m "docs(ipam): import z pliku nmap"
```

---

## Koniec planu

Po Task 5 działa pełny obieg: katalog podsieci i adresów, powiązanie z aplikacjami oraz import z wyniku skanu. `lastSeenAt` daje odpowiedź na pytanie, którego katalog sam nie odpowiada — co zniknęło z sieci między skanami. Porównanie „był wczoraj, nie ma dzisiaj" jest następnym krokiem i świadomie go tu nie budujemy.