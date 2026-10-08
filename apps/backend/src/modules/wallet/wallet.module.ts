import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { WalletService } from './wallet.service';
import { CustomerWalletController } from './customer-wallet.controller';

/**
 * Customer Wallet. `WalletService` is exported so other modules
 * (checkout, order refund) can keep injecting it without knowing
 * anything about this controller — same one-directional-dependency
 * shape as `LoyaltyModule`. Deliberately a separate module from
 * Loyalty — CONFIRMED, the two ledgers are never merged.
 *
 * `CustomerWalletController` (Profile) is the first public endpoint on
 * this ledger — balance + paginated transaction history, read-only,
 * Role.CUSTOMER-gated, ownership from the authenticated session only.
 */
@Module({
  imports: [TypeOrmModule.forFeature([WalletTransaction])],
  controllers: [CustomerWalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
