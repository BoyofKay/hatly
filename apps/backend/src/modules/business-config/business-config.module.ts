import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessConfig } from './entities/business-config.entity';
import { VehicleType } from './entities/vehicle-type.entity';
import { HatlyServicePricingConfig } from './entities/hatly-service-pricing-config.entity';
import { BusinessConfigService } from './business-config.service';
import { VehicleTypesService } from './vehicle-types.service';
import { HatlyServicePricingService } from './hatly-service-pricing.service';
import { BusinessConfigController } from './business-config.controller';
import { VehicleTypesController } from './vehicle-types.controller';
import { HatlyServicePricingController } from './hatly-service-pricing.controller';
import { SupportContactController } from './support-contact.controller';

@Module({
  imports: [TypeOrmModule.forFeature([BusinessConfig, VehicleType, HatlyServicePricingConfig])],
  controllers: [BusinessConfigController, VehicleTypesController, HatlyServicePricingController, SupportContactController],
  providers: [BusinessConfigService, VehicleTypesService, HatlyServicePricingService],
  // Exported so the future Dispatch module can inject
  // BusinessConfigService (for isAutomaticDispatchEnabled()) and
  // VehicleTypesService without this module needing to change.
  exports: [BusinessConfigService, VehicleTypesService, HatlyServicePricingService],
})
export class BusinessConfigModule {}
