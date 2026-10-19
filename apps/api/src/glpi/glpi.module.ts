/**
 * Moduł integracji GLPI.
 *
 * `GlpiService` dostaje cztery rzeczy przez konstruktor: port bazy
 * (token `GLPI_PORT` pod którym stoi `PrismaService` — `GlpiPort` to
 * interfejs, więc sam typ nie wystarczy Nestowi), dziennik (`AuditService`,
 * moduł globalny), sekret sesji (do szyfrowania poświadczeń) i funkcję
 * HTTP (`fetch`). Dwa ostatnie wstrzykiwane przez tokeny tekstowe, co
 * pozwala testom podać własną sieć i atrapę bazy zamiast podnosić serwer.
 */
import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { sessionConfig } from '../config/configuration';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { GlpiController } from './glpi.controller';
import { GlpiService, SEKRET_SESJI, HTTP_GLPI } from './glpi.service';
import { GLPI_PORT } from './glpi.port';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [GlpiController],
  providers: [
    { provide: GLPI_PORT, useExisting: PrismaService },
    GlpiService,
    {
      provide: SEKRET_SESJI,
      inject: [sessionConfig.KEY],
      useFactory: (sekret: ConfigType<typeof sessionConfig>) => sekret.secret,
    },
    {
      provide: HTTP_GLPI,
      useFactory: () => fetch,
    },
  ],
})
export class GlpiModule {}
