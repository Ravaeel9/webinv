import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { appConfig, dbConfig, sessionConfig } from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { AuditModule } from './audit/audit.module';
import { UsersModule } from './users/users.module';
import { ApplicationsModule } from './applications/applications.module';
import { IpamModule } from './ipam/ipam.module';
import { AccessModule } from './access/access.module';
import { HealthController } from './health.controller';
import { SeedModule } from './seed/seed.module';
import { SettingsModule } from './settings/settings.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [appConfig, dbConfig, sessionConfig],
    }),

    // Globalny limit zapytań — chroni API przed zalewem
    ThrottlerModule.forRootAsync({
      inject: [appConfig.KEY],
      useFactory: (_app: ConfigType<typeof appConfig>) => [
        {
          name: 'default',
          ttl: 60_000, // 1 minuta
          limit: 300, // 300 żądań na minutę na IP
        },
      ],
    }),

    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    ApplicationsModule,
    // Po `ApplicationsModule` — `remove()` aplikacji woła serwis IPAM,
    // a ten sam import rejestruje tu kontroler z trasami `/api/ipam`.
    IpamModule,
    AccessModule,
    // Przed `SeedModule` — seed pyta `SettingsService` o stan trybu demo.
    SettingsModule,
    SeedModule,
  ],
  controllers: [HealthController],
  providers: [
    // Kolejność ma znaczenia: throttling → autoryzacja
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
