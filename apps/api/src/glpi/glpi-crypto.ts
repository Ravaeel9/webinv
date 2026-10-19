/**
 * Szyfrowanie sekretów GLPI (AES-256-GCM).
 *
 * Moduł celowo czysty — bez NestJS i bazy — żeby dał się sprawdzić
 * testem jednostkowym i żeby seria `glpi.settings_updated` nie zależała
 * od frameworka.
 *
 * Format zapisu w tabeli `settings`: `v1:<iv>:<tag>:<szyfrogram>` (hex).
 * Prefiks wersji pozwala kiedyś wymienić szyfr bez migracji danych:
 * stare wpisy odszyfrujemy starym kodekiem, nowe zapiszemy nowym.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Prefiks formatu — zmiana oznacza nowy kodek, nie nową tabelę. */
const PREFIKS = 'v1';

/** Wyprowadza klucz AES-256 z sekretu sesji. */
function klucz(sekret: string): Buffer {
  return createHash('sha256').update(sekret, 'utf8').digest();
}

/** Szyfruje tekst. Puste wejście to błąd — nie ma czego szyfrować. */
export function szyfruj(tekst: string, sekret: string): string {
  if (!tekst) {
    throw new Error('Szyfrowanie pustego tekstu jest błędem — pusty sekret zostaw jako brak wpisu.');
  }

  const iv = randomBytes(12);
  const szyfr = createCipheriv('aes-256-gcm', klucz(sekret), iv);
  const zaszyfrowane = Buffer.concat([szyfr.update(tekst, 'utf8'), szyfr.final()]);
  const tag = szyfr.getAuthTag();

  return [PREFIKS, iv.toString('hex'), tag.toString('hex'), zaszyfrowane.toString('hex')].join(':');
}

/** Odszyfrowuje dane z formatu `v1:…`. Każde ściemnienie to czytelny błąd. */
export function odszyfruj(dane: string, sekret: string): string {
  const czesci = dane.split(':');
  if (czesci.length !== 4 || czesci[0] !== PREFIKS) {
    throw new Error('Nie można odszyfrować: dane nie mają rozpoznanego formatu.');
  }

  try {
    const [, ivHex, tagHex, tekstHex] = czesci as [string, string, string, string];
    const odszyfr = createDecipheriv('aes-256-gcm', klucz(sekret), Buffer.from(ivHex, 'hex'));
    odszyfr.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([odszyfr.update(Buffer.from(tekstHex, 'hex')), odszyfr.final()]).toString('utf8');
  } catch {
    // Zły klucz albo naruszony szyfrogram — GCM odmawia otwarcia.
    // Zamieniamy wewnętrzny wyjątek na jeden czytelny komunikat.
    throw new Error('Nie można odszyfrować: nieprawidłowy klucz albo uszkodzone dane.');
  }
}
