/**
 * Mapowanie rekordów GLPI na modele web-inv — czyste funkcje.
 *
 * Trzy reguły ustalone w projekcie integracji:
 *
 *  1. **Czego GLPI nie ma, tego nie wymyślamy** — puste pole GLPI
 *     zostawia puste pole web-inv do ręcznego uzupełnienia.
 *  2. **Tożsamość osoby to e-mail** — jak w imporcie z CSV; użytkownik
 *     GLPI bez e-maila jest dla nas nie do dopasowania i staje się
 *     błędem wiersza, nie cichym pominięciem.
 *  3. **Limity kolumn są pilnowane tu**, a nie dopiero w bazie —
 *     komunikat „za długa wartość" z PostgreSQL nic nie mówi
 *     administratorowi o tym, które pole w GLPI poprawić.
 */

/** Użytkownik GLPI — tylko pola, których używa mapping (resztę API ignoruje). */
export type GlpiUser = {
  id: number;
  username: string;
  realname: string | null;
  firstname: string | null;
  /** API zwraca naprzemiennie string i obiekt `{ email }` — przyjmujemy oba. */
  emails: Array<string | { email: string }>;
  title: string | null;
  category: string | null;
  is_active: boolean;
  is_deleted: boolean;
};

/** Szkic osoby katalogu web-inv (model `Person`). */
export type OsobaSzkic = {
  firstName: string;
  lastName: string;
  email: string;
  position: string | null;
  department: string | null;
};

/** Software GLPI z listą wersji (ostatnia traktowana jako najnowsza). */
export type GlpiSoftware = {
  id: number;
  name: string;
  versions: Array<{ id: number; name: string }>;
};

/** Szkic aplikacji web-inv (model `Application`) — tylko pola z GLPI. */
export type AplikacjaSzkic = {
  name: string;
  version: string;
  description: null;
};

/** Przynależność użytkownika do grupy z legacy API (`Group_User`). */
export type GlpiCzlonkostwo = { users_id: number; groups_id: number };

/** Grupa GLPI z informacją o rodzicu (REST v2.3 `/Administration/Group`). */
export type GlpiGrupa = {
  id: number;
  name: string;
  completename: string;
  parent: { id: number; name: string } | null;
};

/** Powód odrzucenia wiersza — kod, który UI przetłumaczy na polski. */
export type PowodOdrzucenia = 'MISSING_EMAIL' | 'MISSING_NAME';

const LIMITY = {
  imie: 100,
  nazwisko: 100,
  email: 200,
  stanowisko: 150,
  dzial: 150,
  wersja: 100,
} as const;

function oczysc(wartosc: string | null | undefined): string | null {
  if (wartosc === null || wartosc === undefined) return null;
  const przyciete = wartosc.trim();
  return przyciete === '' ? null : przyciete;
}

function uciety(wartosc: string | null, limit: number): string | null {
  if (wartosc === null) return null;
  return wartosc.slice(0, limit);
}

/**
 * Użytkownik GLPI → szkic osoby. Zwraca albo szkic, albo kod błędu —
 * nigdy obu i nigdy żadnego.
 */
export function mapujOsobe(
  user: GlpiUser,
): { osoba: OsobaSzkic; blad?: undefined } | { osoba?: undefined; blad: PowodOdrzucenia } {
  // E-mail może przyjść jako string albo obiekt `{ email }` — bierzemy
  // pierwszy niepusty po oczyszczeniu.
  const email = uciety(
    oczysc(
      user.emails
        .map((e) => (typeof e === 'string' ? e : e.email))
        .find((e) => oczysc(e) !== null),
    ),
    LIMITY.email,
  );
  if (!email) return { blad: 'MISSING_EMAIL' };

  const nazwisko = uciety(oczysc(user.realname), LIMITY.nazwisko);
  const imie = uciety(oczysc(user.firstname), LIMITY.imie);

  // Brak nazwiska: nazwiskiem staje się imię (częste w GLPI dla kont
  // technicznych typu „Sekretariat"). Pustka po obu to błąd danych.
  const nazwiskoFinalne = nazwisko ?? imie;
  if (!nazwiskoFinalne) return { blad: 'MISSING_NAME' };

  return {
    osoba: {
      firstName: imie ?? nazwiskoFinalne,
      lastName: nazwiskoFinalne,
      email,
      position: uciety(oczysc(user.title), LIMITY.stanowisko),
      department: uciety(oczysc(user.category), LIMITY.dzial),
    },
  };
}

/** Software GLPI → szkic aplikacji. Nazwa jest jedynym wymaganym polem. */
export function mapujOprogramowanie(software: GlpiSoftware): AplikacjaSzkic {
  const nazwa = oczysc(software.name);
  if (!nazwa) {
    throw new Error('Oprogramowanie GLPI bez nazwy nie może zostać zaimportowane.');
  }

  // Kolumna `version` nie przyjmuje NULL, więc brak wersji to pusty ciąg.
  const wersja = uciety(oczysc(software.versions.at(-1)?.name), LIMITY.wersja) ?? '';

  return { name: nazwa, version: wersja, description: null };
}

/** Dzieci grupy nadrzędnej — każdy podrzęd = jedna aplikacja/blok dostępu. */
export function grupyDostepu(grupy: GlpiGrupa[], grupaNadrzedna: string): GlpiGrupa[] {
  const rodzic = grupy.find(
    (g) => g.name.trim().toLowerCase() === grupaNadrzedna.trim().toLowerCase(),
  );
  if (!rodzic) return [];
  return grupy.filter((g) => g.parent?.id === rodzic.id);
}

/**
 * Członkostwa → parami osoba×aplikacja dla macierzy.
 *
 * Członek bez osoby w katalogu (albo grupa bez aplikacji) jest po prostu
 * pomijany — import dostępów nie zapisuje niczego „na pół".
 */
export function mapujCzlonkow(
  czlonkowie: GlpiCzlonkostwo[],
  grupaNaAplikacje: Record<number, string>,
  uzytkownikNaOsobe: Record<number, string>,
  poziom: 'OWNER' | 'ADMIN' | 'USER' | 'READ_ONLY',
): Array<{ applicationId: string; personId: string; level: typeof poziom }> {
  const wynik: Array<{ applicationId: string; personId: string; level: typeof poziom }> = [];
  for (const czlonek of czlonkowie) {
    const applicationId = grupaNaAplikacje[czlonek.groups_id];
    const personId = uzytkownikNaOsobe[czlonek.users_id];
    if (!applicationId || !personId) continue;
    wynik.push({ applicationId, personId, level: poziom });
  }
  return wynik;
}
