import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriverCashRemainder } from './entities/driver-cash-remainder.entity';
import { DriverCashRemainderService } from './driver-cash-remainder.service';
import { DriverCashRemainderController } from './driver-cash-remainder.controller';
import { AdminCashRemainderController } from './admin-cash-remainder.controller';
import { DeliveryModule } from '../delivery/delivery.module';
import { WalletModule } from '../wallet/wallet.module';

/**
 * Admin-mediated Driver Cash Remainder (Chunk E). Its own top-level
 * module — CONFIRMED, not merged into WalletModule/DeliveryModule,
 * since it genuinely sits between the two (Driver-owned submission,
 * Wallet-owned credit). `DeliveryModule` imported for
 * `DriverAuthorizationService` (now exported from it — the one
 * necessary, minimal export addition this chunk made). `WalletModule`
 * imported for `WalletService`. No circular risk: neither module
 * imports this one back.
 */
@Module({
  imports: [TypeOrmModule.forFeature([DriverCashRemainder]), DeliveryModule, WalletModule],
  controllers: [DriverCashRemainderController, AdminCashRemainderController],
  providers: [DriverCashRemainderService],
  exports: [DriverCashRemainderService],
})
export class DriverCashRemainderModule {}
