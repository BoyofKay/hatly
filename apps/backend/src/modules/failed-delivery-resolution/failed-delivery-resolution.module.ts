import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FailedDeliveryResolution } from './entities/failed-delivery-resolution.entity';
import { FailedDeliveryResolutionService } from './failed-delivery-resolution.service';
import { FailedDeliveryResolutionController } from './failed-delivery-resolution.controller';
import { PaymentsModule } from '../payments/payments.module';
import { FinanceModule } from '../finance/finance.module';
import { WalletModule } from '../wallet/wallet.module';

/**
 * Failed Delivery Resolution (Chunk 2b). Uses `DataSource` directly
 * (via `this.dataSource.manager`/`this.dataSource.transaction`) for
 * Order/Payment/Delivery/Driver/User reads rather than injecting each
 * repository separately — those entities are already registered
 * elsewhere in the app (Orders/Payments/Delivery/Users modules), and
 * `DataSource` gives read access to all of them without this module
 * needing to import those modules just for entity registration.
 * `TypeOrmModule.forFeature([FailedDeliveryResolution])` registers
 * only the one entity this module actually owns.
 */
@Module({
  imports: [TypeOrmModule.forFeature([FailedDeliveryResolution]), PaymentsModule, FinanceModule, WalletModule],
  controllers: [FailedDeliveryResolutionController],
  providers: [FailedDeliveryResolutionService],
})
export class FailedDeliveryResolutionModule {}
