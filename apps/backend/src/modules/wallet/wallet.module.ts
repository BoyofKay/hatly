import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { WalletService } from './wallet.service';

/**
 * Customer Wallet Ledger Foundation (Chunk B). No controller —
 * CONFIRMED, no public/Admin endpoint exists yet (checkout debit,
 * refund, Admin credit are all later chunks). `WalletService` is
 * exported so a future chunk can inject it without this module
 * needing to know anything about Orders/Loyalty — same
 * one-directional-dependency shape as `LoyaltyModule`. Deliberately a
 * separate module from Loyalty — CONFIRMED, the two ledgers are never
 * merged.
 */
@Module({
  imports: [TypeOrmModule.forFeature([WalletTransaction])],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
