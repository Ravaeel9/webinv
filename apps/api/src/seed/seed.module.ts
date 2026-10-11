import { Global, Module } from '@nestjs/common';
import { SeedService } from './seed.service';
import { SettingsModule } from '../settings/settings.module';

/**
 * Inicjalizacja danych startowych.
 *
 * SeedService implementuje OnApplicationBootstrap, więc Nest wywoła
 * `run()` po tym, jak wszystkie moduły się podniosą i Prisma połączy
 * się z bazą. Operacje są idempotentne.
 *
 * `SettingsModule` importujemy, bo seed sprawdza w nim stan trybu demo:
 * decyzja z panelu administratora ma pierwszeństwo przed zmienną
 * `SEED_DEMO_APPS` z `.env`.
 */
@Global()
@Module({
  imports: [SettingsModule],
  providers: [SeedService],
  exports: [SeedService],
})
export class SeedModule {}
