import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoyaltyPointsTransaction } from './entities/loyalty-points-transaction.entity';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyController } from './loyalty.controller';
import { BusinessConfigModule } from '../business-config/business-config.module';
import { WalletModule } from '../wallet/wallet.module';

/**
 * Loyalty Ledger Foundation (Chunk A) + Loyalty Earning (Chunk C) +
 * Points -> Wallet Conversion (Chunk D). `LoyaltyController` is new
 * this chunk — the first customer-facing endpoint in this module
 * (Chunks A/C needed none). `WalletModule` imported so
 * `LoyaltyService` can inject `WalletService` for the conversion's
 * cross-ledger write — no circular risk, `WalletModule` is a leaf
 * module with no dependency back on this one (confirmed by
 * inspection).
 */
@Module({
  imports: [TypeOrmModule.forFeature([LoyaltyPointsTransaction]), BusinessConfigModule, WalletModule],
  controllers: [LoyaltyController],
  providers: [LoyaltyService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
