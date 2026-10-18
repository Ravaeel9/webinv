/**
 * Dane demonstracyjne macierzy uprawnień: trzy osoby i cztery przypisania.
 *
 * Osobny plik od `demo-applications.ts`, bo to nie aplikacje tylko osoby —
 * i demo ma pokazywać oba ostrzeżenia naraz, których w realnym katalogu
 * prawie nigdy nie ma razem: wygasłe przypisanie (`expiresOn` w przeszłości)
 * i osobę nieaktywną. Bez nich ekran wygląda na zawsze poprawny, a
 * administrator pierwszy raz widzi ostrzeżenie już w produkcji.
 *
 * Nazwy aplikacji muszą istnieć w `demo-applications.ts` / `demo-services.ts`
 * — przypisania szukamy aplikacji po nazwie, bo UUID demo-aplikacji zmienia się
 * przy każdym seedzie na czystej bazie. Test `seed-access.test.ts` pilnuje,
 * żeby te nazwy nie rozjechały się z danymi demo aplikacji.
 *
 * Adresy na domenie `@example.invalid`, której nie da się zarejestrować
 * (RFC 2606) — tak samo rozpoznawalne jak `isDemo` przy aplikacjach,
 * a pasujące do założenia, że instalacja przetestowana to nie produkcja.
 *
 * Seed jest idempotentny: osoby po e-mailu (`upsert`), przypisania po
 * kluczu złożonym. Ponowne uruchomienie kontenera nie mnoży wierszy.
 */
import type { AccessLevelName } from '../access/access.port';

/** Minimalny podzbiór Prisma, którego potrzebuje ten seed. */
export interface DemoAccessSeeder {
  person: {
    upsert(args: {
      where: { email: string };
      create: { firstName: string; lastName: string; email: string; position?: string; department?: string; isActive: boolean };
      update: { position?: string; department?: string; isActive: boolean };
    }): Promise<{ id: string; email: string }>;
  };
  applicationAccess: {
    upsert(args: {
      where: { applicationId_personId: { applicationId: string; personId: string } };
      create: { applicationId: string; personId: string; level: AccessLevelName; expiresOn: Date | null; note: string | null };
      update: { level: AccessLevelName; expiresOn: Date | null; note: string | null };
    }): Promise<unknown>;
  };
  application: {
    findMany(args: { select: { id: true; name: true } }): Promise<Array<{ id: string; name: string }>>;
  };
}

/** Środowisko bezpiecznej daty: `T00:00:00Z`, bo kolumna to `@db.Date`. */
function data(tekst: string): Date {
  return new Date(`${tekst}T00:00:00Z`);
}

/** ── Dane wygenerowane z eksportu (`make export-demo`) — początek ── */
const DANE_OSOB = [
  {
    firstName: 'Anna',
    lastName: 'Zalewska',
    email: 'anna.zalewska@example.invalid',
    position: 'Kierownik zespołu IT',
    department: 'IT',
    isActive: true,
  },
  {
    firstName: 'Bolesław',
    lastName: 'Nowak',
    email: 'bolek.nowak@example.invalid',
    position: 'Specjalista ds. księgowości',
    department: 'Księgowość',
    isActive: true,
  },
  {
    firstName: 'Cecilia',
    lastName: 'Wójcik',
    email: 'cecilia.wojcik@example.invalid',
    position: 'Audytor wewnętrzny',
    department: 'Kontrola',
    isActive: false,
  },
];

/** Przypisania: nazwa aplikacji demo → osoby i poziomy. */
const DANE_PRZYPISAN: Array<{
  application: string;
  email: string;
  level: AccessLevelName;
  expiresOn: Date | null;
  note: string | null;
}> = [
  {
    application: '1Password Business',
    email: 'anna.zalewska@example.invalid',
    level: 'ADMIN',
    expiresOn: null,
    note: null,
  },
  {
    application: '1Password Business',
    email: 'bolek.nowak@example.invalid',
    level: 'USER',
    expiresOn: null,
    note: null,
  },
  {
    application: 'Grafana',
    email: 'anna.zalewska@example.invalid',
    level: 'OWNER',
    expiresOn: null,
    note: null,
  },
  {
    application: 'Grafana',
    email: 'bolek.nowak@example.invalid',
    level: 'USER',
    expiresOn: data('2026-01-31'),
    note: 'Dostęp czasowy na okres wdrożenia.',
  },
  {
    application: 'Grafana',
    email: 'cecilia.wojcik@example.invalid',
    level: 'READ_ONLY',
    expiresOn: null,
    note: null,
  },
  {
    application: 'Keycloak',
    email: 'anna.zalewska@example.invalid',
    level: 'ADMIN',
    expiresOn: null,
    note: null,
  },
];
/** ── Dane wygenerowane z eksportu (`make export-demo`) — koniec ─── */

/**
 * Wstawia osoby i przypisania demonstracyjne.
 *
 * Aplikacje bierzemy po **nazwie**, nie po stałym UUID: identyfikatory
 * demo-aplikacji zmieniają się z każdym seedem na czystej bazie, a przypisanie
 * po nazwie przetrwa restart i nową instalację.
 */
export async function seedDemoAccess(
  prisma: DemoAccessSeeder,
): Promise<{ persons: number; grants: number; pominiete: string[] }> {
  const osoby = new Map<string, string>();
  for (const osoba of DANE_OSOB) {
    const zapisana = await prisma.person.upsert({
      where: { email: osoba.email },
      create: {
        firstName: osoba.firstName,
        lastName: osoba.lastName,
        email: osoba.email,
        position: osoba.position,
        department: osoba.department,
        isActive: osoba.isActive,
      },
      update: {
        position: osoba.position,
        department: osoba.department,
        isActive: osoba.isActive,
      },
    });
    osoby.set(osoba.email, zapisana.id);
  }

  const aplikacje = new Map(
    (await prisma.application.findMany({ select: { id: true, name: true } })).map((a) => [
      a.name,
      a.id,
    ]),
  );

  let zapisane = 0;
  const pominiete: string[] = [];
  for (const przypisanie of DANE_PRZYPISAN) {
    const applicationId = aplikacje.get(przypisanie.application);
    const personId = osoby.get(przypisanie.email);
    // Demo aplikacji może nie istnieć (tryb demo wyłączony w ustawieniach,
    // seed tylko częściowy) — wtedy pomijamy przypisanie, ale **mówimy
    // o tym w logu**: ciche zero przypisań przy trzech zapisanych osobach
    // wygląda jak awaria seeda, a była literówką w nazwie aplikacji.
    if (!applicationId || !personId) {
      pominiete.push(przypisanie.application);
      continue;
    }

    await prisma.applicationAccess.upsert({
      where: { applicationId_personId: { applicationId, personId } },
      create: {
        applicationId,
        personId,
        level: przypisanie.level,
        expiresOn: przypisanie.expiresOn,
        note: przypisanie.note,
      },
      update: {
        level: przypisanie.level,
        expiresOn: przypisanie.expiresOn,
        note: przypisanie.note,
      },
    });
    zapisane++;
  }

  return { persons: osoby.size, grants: zapisane, pominiete };
}

/** Dane demo eksportowane dla testu — nie osobna kopia prawdy. */
export const DEMO_ACCESS_DATA = {
  persons: DANE_OSOB,
  grants: DANE_PRZYPISAN,
} as const;