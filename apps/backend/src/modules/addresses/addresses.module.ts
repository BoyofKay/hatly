import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Address } from './entities/address.entity';
import { DeliveryZone } from '../delivery-zones/entities/delivery-zone.entity';
import { AddressesService } from './addresses.service';
import { AddressesController } from './addresses.controller';
import { ServiceArea } from '../service-areas/entities/service-area.entity';
import { ServiceAreasModule } from '../service-areas/service-areas.module';
import { DeliveryFeeCalculationModule } from '../delivery-fee/delivery-fee-calculation.module';
import { BusinessConfigModule } from '../business-config/business-config.module';

@Module({
  imports: [TypeOrmModule.forFeature([Address, DeliveryZone, ServiceArea]), ServiceAreasModule, DeliveryFeeCalculationModule, BusinessConfigModule],
  controllers: [AddressesController],
  providers: [AddressesService],
  // M3c (Launch-Readiness Gap Audit, G-10): exported so AdminCustomersModule can reuse
  // `listForCustomer` for a customer's default-address summary without a duplicate query.
  exports: [AddressesService],
})
export class AddressesModule {}
