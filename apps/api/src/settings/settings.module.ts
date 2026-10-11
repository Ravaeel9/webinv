import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * Ustawienia systemowe.
 *
 * Moduł eksportuje `SettingsService`, bo `SeedModule` potrzebuje go
 * przy starcie kontenera: seed musi zapytać o stan trybu demo, żeby
 * wiedzieć, czy ma wypełniać bazę.
 */
@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}