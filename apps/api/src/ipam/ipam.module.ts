import { Module } from '@nestjs/common';
import { IpamController } from './ipam.controller';
import { IpamService } from './ipam.service';

/**
 * Katalog IPAM — podsieci, adresy i przypisania do aplikacji.
 *
 * Moduł powstał już przy Tasku 7 (przed kontrolerem z Tasku 8), bo
 * `ApplicationsService.remove()` potrzebuje `IpamService` do zdejmowania
 * przypisań IP przy soft delete aplikacji. Eksport jest więc częścią
 * kontraktu, a nie wycieczkiem do jednego konsumenta.
 */
@Module({
  controllers: [IpamController],
  providers: [IpamService],
  exports: [IpamService],
})
export class IpamModule {}
