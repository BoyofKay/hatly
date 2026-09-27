import { Module } from '@nestjs/common';
import { DeliveryFeeCalculationService } from './delivery-fee-calculation.service';
import { LocationModule } from '../location/location.module';
import { BusinessConfigModule } from '../business-config/business-config.module';

@Module({
  imports: [LocationModule, BusinessConfigModule],
  providers: [DeliveryFeeCalculationService],
  exports: [DeliveryFeeCalculationService],
})
export class DeliveryFeeCalculationModule {}
