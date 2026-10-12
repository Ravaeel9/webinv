import { Module } from '@nestjs/common';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { IpamModule } from '../ipam/ipam.module';

@Module({
  // `remove()` zdejmuje przypisania IP i odblokowuje adresy przez
  // `IpamService`. Moduł IPAM musi być więc zaimportowany tutaj — inaczej
  // Nest nie byłby w stanie wstrzyknąć serwisu.
  imports: [IpamModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}