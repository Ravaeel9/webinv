import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Wstrzyknięta instancja klienta Prisma.
 *
 * Prisma 7: klient nie łączy się z bazą sam — przekazujemy mu driver
 * adapter (`@prisma/adapter-pg`) z adresem bazy ze środowiska. Domyślnie
 * logujemy tylko błędy — pełne zapytania z parametrami ujawniałyby dane
 * osobowe i zaśmiecały logi produkcyjne.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL as string,
      }),
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
