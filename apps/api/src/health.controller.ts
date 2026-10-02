import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/decorators';
import { PrismaService } from './prisma/prisma.service';

const startedAt = Date.now();

/**
 * Trzymamy prefiks `api` jak w pozostałych kontrolerach. Dzięki temu
 * healthcheck jest dostępny także przez nginx (`/api/health`) — samo `/health`
 * nginx przepuszczałby do SPA.
 */
@Controller('api')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Publiczny healthcheck dla Dockera i monitoringu.
   * Sprawdza tylko żywotność procesu — nie odpytuje bazy,
   * żeby restart kontenera API nie zależał od krótkiej awarii Postgresu.
   */
  @Public()
  @Get('health')
  health() {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness — do tego samego celu, ale z kontrolą bazy.
   * Używane przez `make ps` i diagnostykę.
   */
  @Public()
  @Get('health/ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', database: 'up' };
    } catch (err) {
      return {
        status: 'degraded',
        database: 'down',
        error: err instanceof Error ? err.message : 'nieznany błąd',
      };
    }
  }
}
