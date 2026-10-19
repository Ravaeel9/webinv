/**
 * Integracja GLPI — trasy panelowe.
 *
 * Cały kontroler pod `settings:write` (tylko super administrator),
 * jak reszta ustawień systemowych. Błąd `GlpiBlad` tłumaczymy na 502:
 * problem jest po stronie GLPI (sieć, poświadczenia), nie w danych
 * formularza — a komunikat po polsku idzie dalej do administratora.
 */
import { BadGatewayException, Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { GlpiBlad } from './glpi-client';
import { GlpiService } from './glpi.service';
import { ImportGlpiDto, UstawieniaGlpiDto } from './dto/glpi.dto';
import {
  ClientIp,
  CurrentUser,
  RequirePermission,
  type AuthUser,
} from '../auth/decorators';

@Controller('api/glpi')
export class GlpiController {
  constructor(private readonly glpi: GlpiService) {}

  /** Stan konfiguracji — bez sekretów, z flagami ich obecności. */
  @Get('settings')
  @RequirePermission('settings:write')
  async getUstawienia() {
    return this.glpi.getUstawienia();
  }

  @Put('settings')
  @RequirePermission('settings:write')
  @HttpCode(200)
  async zapiszUstawienia(
    @Body() dto: UstawieniaGlpiDto,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    return this.glpi.zapiszUstawienia(dto, actor, ip);
  }

  /** Test połączenia — obie historie autoryzacji naraz. */
  @Post('test')
  @RequirePermission('settings:write')
  @HttpCode(200)
  async testujPolaczenie() {
    try {
      return await this.glpi.testujPolaczenie();
    } catch (blad) {
      if (blad instanceof GlpiBlad) {
        throw new BadGatewayException(blad.message);
      }
      throw blad;
    }
  }

  /** Podgląd importu — pobiera z GLPI, klasyfikuje, nic nie zapisuje. */
  @Post('import/preview')
  @RequirePermission('settings:write')
  @HttpCode(200)
  async podglad(@Body() dto: ImportGlpiDto) {
    try {
      return await this.glpi.podglad(dto.sections);
    } catch (blad) {
      if (blad instanceof GlpiBlad) {
        throw new BadGatewayException(blad.message);
      }
      throw blad;
    }
  }

  /** Zapis importu — rewaliduje payload, tworzy wyłącznie nowe rekordy. */
  @Post('import/apply')
  @RequirePermission('settings:write')
  @HttpCode(200)
  async wykonaj(
    @Body() dto: ImportGlpiDto,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    try {
      return await this.glpi.wykonaj(dto, actor, ip);
    } catch (blad) {
      if (blad instanceof GlpiBlad) {
        throw new BadGatewayException(blad.message);
      }
      throw blad;
    }
  }
}
