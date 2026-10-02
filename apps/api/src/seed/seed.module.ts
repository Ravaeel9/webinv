import { Global, Module } from '@nestjs/common';
import { SeedService } from './seed.service';

/**
 * Inicjalizacja danych startowych.
 *
 * SeedService implementuje OnApplicationBootstrap, więc Nest wywoła
 * `run()` po tym, jak wszystkie moduły się podniosą i Prisma połączy
 * się z bazą. Operacje są idempotentne.
 */
@Global()
@Module({
  providers: [SeedService],
  exports: [SeedService],
})
export class SeedModule {}
