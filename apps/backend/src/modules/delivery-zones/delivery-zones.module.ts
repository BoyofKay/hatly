import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeliveryZone } from './entities/delivery-zone.entity';
import { ServiceArea } from '../service-areas/entities/service-area.entity';
import { DeliveryZonesService } from './delivery-zones.service';
import { AdminDeliveryZonesController } from './admin-delivery-zones.controller';
import { DeliveryZonesController } from './delivery-zones.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DeliveryZone, ServiceArea])],
  controllers: [AdminDeliveryZonesController, DeliveryZonesController],
  providers: [DeliveryZonesService],
  exports: [DeliveryZonesService, TypeOrmModule],
})
export class DeliveryZonesModule {}
