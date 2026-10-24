import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { appConfig } from '../config/configuration';
import { hashPassword, validatePasswordStrength } from '../auth/password';
import { seedDemoApplications } from './demo-applications';
import { seedDemoAccess } from './demo-access';
import { seedDemoIpam } from './demo-ipam';
import { SettingsService } from '../settings/settings.service';

type AppCfg = ConfigType<typeof appConfig>;

/**
 * Domyślne środowiska — powstają przy pierwszym uruchomieniu.
 * Eksport na potrzeby testu spójności danych demo (nazwy używane
 * przez aplikacje demonstracyjne muszą istnieć w tym zbiorze).
 *
 * „Biurowe", nie „Produkcja": w tej organizacji „produkcja" znaczy
 * środowisko z danymi klientów, a rejestrowane tu aplikacje działają
 * wewnątrz organizacji. Istniejącą bazę przemianowuje jednorazowe
 * polecenie SQL z `docs/BAZA-DANYCH.md` — seed upsertuje po nazwie,
 * więc ciche zmienianie rekordów użytkownika przy każdym starcie
 * kontenera byłoby nadpisywaniem jego decyzji.
 */
export const DEFAULT_ENVIRONMENTS = [
  { name: 'Biurowe', sortOrder: 1, color: 'emerald' },
  { name: 'Test', sortOrder: 2, color: 'amber' },
  { name: 'Preprodukcja', sortOrder: 3, color: 'sky' },
  { name: 'Deweloperskie', sortOrder: 4, color: 'violet' },
];

/**
 * Sprawdza hasło startowe z `SEED_ADMIN_PASSWORD` pełną polityką haseł.
 *
 * Dlaczego nie wystarczy walidacja długości z `hashPassword()`:
 * ta funkcja jest też używana przy resetach haseł przez administratora,
 * czyli tam hasło nadaje człowiek, który potem je podaje. Hasło
 * startowe przychodzi natomiast z `.env`, więc nikt go nie weryfikuje —
 * a `.env.example` zawierał `zmien-to-haslo`, przechodzące samą długość
 * mimo braku wielkiej litery i cyfry, i dające dostęp SUPER_ADMIN.
 *
 * Wołane PRZED sprawdzeniem, czy konto już istnieje. Inaczej słabe hasło
 * w `.env` przeszłoby cicho przy każdym starcie kontenera (konto istnieje,
 * hasło nieużywane), a operator nie dostałby informacji, że jego `.env`
 * jest nieaktualny.
 *
 * Osobna funkcja, nie metoda — dzięki temu testuje się ją bez bazy
 * i bez podnoszenia kontenera.
 */
export function assertSeedPasswordIsStrong(password: string): void {
  const strength = validatePasswordStrength(password);
  if (strength.ok) return;

  throw new Error(
    'SEED_ADMIN_PASSWORD nie spełnia polityki haseł: ' +
      `${strength.errors.join(' ')} ` +
      'Ustaw w .env hasło spełniające te warunki i uruchomij kontener ponownie.',
  );
}

/**
 * Jednorazowa inicjalizacja danych startowych.
 *
 * Uruchamiana po starcie aplikacji (a nie jako część migracji), bo
 * potrzebuje hashowania hasła Argon2, którego Prisma nie zrobi sama.
 * Operacje są idempotentne — powtórne uruchomienie nie duplikuje danych.
 */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(appConfig.KEY) private readonly cfg: AppCfg,
    private readonly settings: SettingsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedEnvironments();
    await this.seedSuperAdmin();
    await this.seedDemoApplications();
    await this.seedIpam();
  }

  /**
   * Programy demonstracyjne — tylko gdy `SEED_DEMO_APPS=true`.
   *
   * Ostatni w kolejności, bo potrzebuje środowisk z pierwszego kroku.
   * Domyślnie wyłączony: patrz `appConfig.seed.demoApps`.
   */
  private async seedDemoApplications(): Promise<void> {
    // Nie czytamy tu `cfg.seed.demoApps`: decyzja administratora
    // zapisana w panelu ma pierwszeństwo przed zmienną z `.env`.
    // Bez tego wyłączenie trybu demo przestałoby działać po restarcie
    // kontenera, bo `.env` wciąż miałby `SEED_DEMO_APPS=true`.
    const wlaczony = await this.settings.shouldSeedDemo();
    if (!wlaczony) {
      this.logger.log('Tryb demo wyłączony — pomijam dane demonstracyjne.');
      return;
    }

    const count = await seedDemoApplications(this.prisma);

    // Osoby i przypisania po tym samym seedzie aplikacji: przypisania
    // wskazują aplikacje po nazwie, więc muszą powstać po nich.
    const macierz = await seedDemoAccess(this.prisma);
    if (macierz.pominiete.length > 0) {
      this.logger.warn(
        `Pominięte przypisania macierzy — brak aplikacji demo o nazwie: ` +
          `${macierz.pominiete.join(', ')}.`,
      );
    }
    this.logger.log(
      `Dane demonstracyjne: ${count} rekordów (upsert), ` +
        `${macierz.persons} osób i ${macierz.grants} przypisań. ` +
        'Wyłącz tryb demo w Ustawieniach albo SEED_DEMO_APPS, ' +
        'aby przestały wracać przy starcie.',
    );
  }

  /**
   * Podsieci i adresy IP demonstracyjne — po aplikacjach, bo powiązanie
   * aplikacja–adres szuka aplikacji po nazwie.
   */
  private async seedIpam(): Promise<void> {
    const wynik = await seedDemoIpam(this.prisma);
    if (wynik.pominiete.length > 0) {
      this.logger.warn(
        `Pominięte powiązania IP — brak aplikacji demo o nazwie: ` +
          `${[...new Set(wynik.pominiete)].join(', ')}.`,
      );
    }
    this.logger.log(
      `Dane demonstracyjne IPAM: ${wynik.subnets} podsieci, ` +
        `${wynik.addresses} adresów, ${wynik.links} powiązań (upsert).`,
    );
  }

  /** Środowiska — tworzone tylko te, których jeszcze nie ma. */
  private async seedEnvironments(): Promise<void> {
    for (const env of DEFAULT_ENVIRONMENTS) {
      // upsert po nazwie — bezpieczne przy powtórnym starcie
      await this.prisma.environment.upsert({
        where: { name: env.name },
        update: { sortOrder: env.sortOrder, color: env.color },
        create: env,
      });
    }
    this.logger.log(
      `Środowiska: ${DEFAULT_ENVIRONMENTS.length} zdefiniowanych (upsert).`,
    );
  }

  /**
   * Konto super administratora.
   *
   * Jeśli konto o podanej nazwie już istnieje, nic nie robimy — nie
   * nadpisujemy hasła, bo to zablokowałoby użytkownika, który je zmienił.
   * Hasło z env ustawiamy tylko przy pierwszym utworzeniu.
   */
  private async seedSuperAdmin(): Promise<void> {
    const { username, email, password, fullName } = this.cfg.seed;
    assertSeedPasswordIsStrong(password);

    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ username }, { email }],
      },
      select: { id: true, username: true, role: true },
    });

    if (existing) {
      // Konto istnieje, ale nie jest super adminem (np. ktoś obniżył rolę).
      // Nie podnosimy automatycznie — to decyzja człowieka.
      if (existing.role !== 'SUPER_ADMIN') {
        this.logger.warn(
          `Konto "${existing.username}" istnieje, ale ma rolę ${existing.role}. ` +
            `Podnieś do SUPER_ADMIN ręcznie, jeśli to konto ma być administratorem.`,
        );
      }
      return;
    }

    const passwordHash = await hashPassword(password);

    await this.prisma.user.create({
      data: {
        username,
        email,
        fullName,
        passwordHash,
        role: 'SUPER_ADMIN',
        isActive: true,
        // Wymuszenie zmiany hasła startowego przy pierwszym logowaniu
        mustChangePassword: true,
        passwordChangedAt: new Date(),
      },
    });

    this.logger.warn(
      `Utworzono konto SUPER_ADMIN: "${username}". ` +
        `Hasło startowe wymaga zmiany przy pierwszym logowaniu.`,
    );
  }
}
