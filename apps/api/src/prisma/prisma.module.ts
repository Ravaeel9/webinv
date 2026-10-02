import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Globalny, bo klient bazy jest potrzebny w praktycznie każdym module
 * (aplikacje, użytkownicy, audyt, sesje, seed) i nie chcemy go
 * reeksportować z każdego z nich.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
