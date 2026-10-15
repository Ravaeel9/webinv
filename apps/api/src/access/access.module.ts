import { Module } from '@nestjs/common';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { ACCESS_PORT } from './access.port';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Moduł macierzy uprawnień i katalogu osób.
 *
 * `ACCESS_PORT` to token, pod którym podajemy `PrismaService`: serwis
 * deklaruje port jako interfejs (żeby dał się testować bez bazy), a
 * `useExisting` łączy go z prawdziwym klientem bez duplikowania jego
 * połączenia. `AuditModule` jest potrzebne, bo każda zmiana macierzy
 * i katalogu osób zostawia ślad w dzienniku zdarzeń.
 */
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [AccessController],
  providers: [
    { provide: ACCESS_PORT, useExisting: PrismaService },
    AccessService,
  ],
  exports: [AccessService],
})
export class AccessModule {}