import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Address } from './entities/address.entity';
import { DeliveryZone } from '../delivery-zones/entities/delivery-zone.entity';
import { AddressesService } from './addresses.service';
import { AddressesController } from './addresses.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Address, DeliveryZone])],
  controllers: [AddressesController],
  providers: [AddressesService],
  // M3c (Launch-Readiness Gap Audit, G-10): exported so AdminCustomersModule can reuse
  // `listForCustomer` for a customer's default-address summary without a duplicate query.
  exports: [AddressesService],
})
export class AddressesModule {}
