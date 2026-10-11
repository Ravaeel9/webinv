/**
 * Ustawienia systemowe — tryb demonstracyjny.
 *
 * Stan trzymany w tabeli `settings`, a nie w zmiennej środowiskowej,
 * bo `SEED_DEMO_APPS` z `.env` nie jest trwały: kontener nie ma tego
 * pliku na wolumenie, więc decyzja administratora ginęła z restartem
 * i dane wracały wbrew temu, co kliknięto w panelu.
 *
 * Klucz `demo_mode` ma dwie reguły czytania, w kolejności:
 *
 *  1. **wpis w bazie** — decyduje i ignoruje zmienną środowiskową;
 *  2. **brak wpisu** — decyduje `SEED_DEMO_APPS`.
 *
 * Ta druga reguła istnieje dla wdrożeń, które nie przeszły migracji:
 * bez niej fresh install wypełniłby się danymi demo tylko dlatego, że
 * ktoś zapomniał wstawić wiersz do nowej tabeli.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { appConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/decorators';

type AppCfg = ConfigType<typeof appConfig>;

/** Klucz w tabeli `settings`. */
const DEMO_MODE_KEY = 'demo_mode';

/** Stan trybu demo wraz z tym, skąd pochodzi odczyt. */
export type DemoModeState = {
  enabled: boolean;
  /** `db` — wpis w bazie, `env` — brak wpisu, decyzja z `.env`. */
  source: 'db' | 'env';
  /** Rekordy oznaczone `is_demo`, do pokazania w panelu. */
  recordCount: number;
};

/**
 * Wąski port, przez który serwis rozmawia z bazą i dziennikiem.
 *
 * Osobny typ zamiast `PrismaService` + `AuditService`, żeby test mógł
 * podać atrapę i sprawdzić wywołania, zamiast podnosić bazę.
 * `$transaction` jest tu, bo kasowanie danych demo musi być jedną
 * transakcją z wpisem do dziennika — inaczej skasowane rekordy
 * bez śladu w dzienniku byłyby nie do odtworzenia.
 */
export type SettingsPort = {
  /**
   * Delegat `setting` — nazwa modelu w Prisma, taka sama jak w kodzie.
   * Port nie może nazywać go inaczej, bo `SettingsService` używa
   * `this.prisma.setting`, a test podawałby obiekt z polem `settings`
   * i dostawałby `undefined` zamiast błędu kompilacji.
   */
  setting: {
    findUnique(args: {
      where: { key: string };
    }): Promise<{ value: string } | null>;
    upsert(args: {
      where: { key: string };
      update: { value: string };
      create: { key: string; value: string };
    }): Promise<unknown>;
  };
  application: {
    count(args: { where: { isDemo: boolean } }): Promise<number>;
    deleteMany(args: { where: { isDemo: boolean } }): Promise<{ count: number }>;
  };
  audit: {
    record(entry: {
      action: string;
      entity: string;
      actorId?: string | null;
      actorName?: string | null;
      changes?: unknown;
      ip?: string | null;
    }): Promise<void>;
  };
  /**
   * Transakcja w formie wywołania zwrotnego — Prisma obsługuje obie
   * postacie, ale tylko ta pozwala objąć kasowanie i wpis do dziennika
   * jednym atomowym krokiem. Forma z tablicą operacji nie da się
   * połączyć z wpisem audytu, bo ten potrzebuje liczby usuniętych
   * rekordów, której wcześniej jeszcze nie ma.
   */
  $transaction<T>(operacja: () => Promise<T>): Promise<T>;
};

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(appConfig.KEY) private readonly cfg: AppCfg,
    private readonly audit: AuditService,
  ) {}

  /**
   * Czyta stan trybu demo.
   *
   * Wartości spoza `true`/`false` czytamy jako wyłączony tryb, a nie
   * jako błąd: wiersz w bazie może zostać poprawiony ręcznie, a tryb
   * włączony przy nieczytelnej wartości wypełniłby bazę danymi, których
   * nikt nie zamawiał.
   */
  async getDemoMode(): Promise<DemoModeState> {
    const wpis = await this.prisma.setting.findUnique({
      where: { key: DEMO_MODE_KEY },
    });

    const recordCount = await this.prisma.application.count({
      where: { isDemo: true },
    });

    if (wpis === null) {
      return { enabled: this.cfg.seed.demoApps, source: 'env', recordCount };
    }

    return {
      enabled: wpis.value === 'true',
      source: 'db',
      recordCount,
    };
  }

  /** Zapisuje decyzję administratora. */
  async setDemoMode(enabled: boolean): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key: DEMO_MODE_KEY },
      update: { value: String(enabled) },
      create: { key: DEMO_MODE_KEY, value: String(enabled) },
    });

    this.logger.log(
      `Tryb demo: ${enabled ? 'włączony' : 'wyłączony'} (zapis w bazie).`,
    );
  }

  /**
   * Kasuje rekordy demonstracyjne — na zawsze, nie soft delete.
   *
   * Twardo, bo soft delete zostawiłby 30 „usuniętych" rekordów widocznych
   * w filtrze „pokaż usunięte", czyli dokładnie tam, gdzie administrator
   * szukałby ich po wciśnięciu przycisku.
   *
   * Filtrowanie po `isDemo`, nie po nazwie z kodu: po nazwie zmiana rekordu
   * w interfejsie psułaby rozpoznawanie, a wpis zostałby w bazie
   * na zawsze.
   *
   * Jeden wpis w dzienniku z liczbą, nie trzydzieści zdarzeń `app.deleted`
   * — dziennik odpowiada na pytanie „co się stało", a tu odpowiedzią jest
   * jedna liczba.
   */
  async deleteDemoData(
    actor: AuthUser,
    ip?: string,
  ): Promise<{ deleted: number }> {
    const usuniete = await this.prisma.$transaction(async () => {
      const wynik = await this.prisma.application.deleteMany({
        where: { isDemo: true },
      });

      await this.audit.record({
        action: 'demo.data_deleted',
        entity: 'Application',
        actorId: actor.id,
        actorName: actor.username,
        changes: { deletedCount: { from: wynik.count, to: 0 } },
        ip,
      });

      return wynik.count;
    });

    this.logger.warn(
      `Usunięto ${usuniete} rekordów demonstracyjnych (zdarzenie demo.data_deleted).`,
    );

    return { deleted: usuniete };
  }

  /**
   * Czy tryb demo ma się wykonywać przy starcie kontenera.
   *
   * Wywoływane przez `SeedService`. Kolejność jest tu całym sensem:
   * wpis w bazie wygrywa ze zmienną środowiskową, bo administrator
   * kliknął w panelu i dane nie mogą wrócić wbrew temu.
   */
  async shouldSeedDemo(): Promise<boolean> {
    const wpis = await this.prisma.setting.findUnique({
      where: { key: DEMO_MODE_KEY },
    });

    if (wpis === null) return this.cfg.seed.demoApps;
    return wpis.value === 'true';
  }
}

/** Klucz, pod którym `SettingsPort` musi zgadzać się z Prisma. */
export const SETTINGS_DEMO_KEY = DEMO_MODE_KEY;

