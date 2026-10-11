import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Put,
} from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { SettingsService } from './settings.service';
import {
  ClientIp,
  CurrentUser,
  RequirePermission,
  type AuthUser,
} from '../auth/decorators';

class SetDemoModeDto {
  @IsBoolean({ message: 'Tryb demo musi być true albo false.' })
  enabled!: boolean;
}

/**
 * Tryb demonstracyjny i dane demonstracyjne.
 *
 * Cały kontroler pod `settings:write`, które ma **tylko**
 * `SUPER_ADMIN`. `ADMIN` ma `app:write`, czyli może usunąć aplikację
 * pojedynczo — nie powinien jednak dostać przycisku kasującego 30
 * rekordów naraz.
 */
@Controller('api/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Stan trybu demo i liczba rekordów demonstracyjnych w bazie. */
  @Get('demo')
  @RequirePermission('settings:write')
  async getDemo() {
    return this.settings.getDemoMode();
  }

  @Put('demo')
  @RequirePermission('settings:write')
  @HttpCode(200)
  async setDemo(@Body() dto: SetDemoModeDto) {
    await this.settings.setDemoMode(dto.enabled);
    return this.settings.getDemoMode();
  }

  /** Kasuje dane demonstracyjne — na zawsze, nie soft delete. */
  @Delete('demo/data')
  @RequirePermission('settings:write')
  @HttpCode(200)
  async deleteDemoData(
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    return this.settings.deleteDemoData(actor, ip);
  }
}