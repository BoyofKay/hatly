import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CodPaymentProvider } from './providers/cod-payment.provider';
import { Payment } from './entities/payment.entity';
import { PaymentStateMachineService } from './payment-state-machine.service';
import { ManualTransferService } from './manual-transfer.service';
import { AdminManualTransferService } from './admin-manual-transfer.service';
import { ManualTransferRefundService } from './manual-transfer-refund.service';
import { ManualTransferController } from './manual-transfer.controller';
import { AdminManualTransferController } from './admin-manual-transfer.controller';
import { BusinessConfigModule } from '../business-config/business-config.module';
import { FinanceModule } from '../finance/finance.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';

/**
 * PHASE F addition: imports FinanceModule for FinancialEventService
 * (ManualTransferRefundService's only new dependency) — one-directional,
 * no cycle: FinanceModule needs nothing from PaymentsModule (it already
 * registers the Payment entity directly in its own forFeature).
 *
 * Consolidated customer-commerce milestone: imports LoyaltyModule too,
 * for the SAME reason — `ManualTransferRefundService` now also injects
 * `LoyaltyService` for post-DELIVERED refund reversal (see that
 * service's own doc comment). One-directional, no cycle: neither
 * `LoyaltyModule` nor its own imports (`WalletModule`,
 * `BusinessConfigModule`) import `PaymentsModule` (confirmed by
 * inspection).
 */
@Module({
  imports: [TypeOrmModule.forFeature([Payment]), BusinessConfigModule, FinanceModule, LoyaltyModule],
  controllers: [ManualTransferController, AdminManualTransferController],
  providers: [
    CodPaymentProvider,
    PaymentStateMachineService,
    ManualTransferService,
    AdminManualTransferService,
    ManualTransferRefundService,
  ],
  exports: [CodPaymentProvider, ManualTransferRefundService],
})
export class PaymentsModule {}
