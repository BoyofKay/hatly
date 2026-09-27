import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Order } from './entities/order.entity';
import { WalletService } from '../wallet/wallet.service';
import { WalletTransactionType } from '../wallet/wallet-transaction-type.enum';

/**
 * Wallet-paid money goes back to the WALLET (never to another source). What the customer paid from the wallet is
 * `Order.walletAmountMinor` (server-decided and debited at creation); what is owed back is
 *
 *   refund = walletAmount − max(0, amountNowOwed) − alreadyRefundedToThisOrder
 *
 * clamped at 0 — the wallet keeps paying for the part of the order that still stands (wallet is consumed first), and only
 * the excess is credited back. Every credit is an append-only `ORDER_REFUND` ledger row with an idempotency key, on the
 * caller's transaction and under the customer's wallet lock, so repeats and races can never credit twice.
 */
@Injectable()
export class OrderWalletRefundService {
  constructor(private readonly walletService: WalletService) {}

  /** Credits back what the wallet paid beyond `owedAfterMinor`. Returns the amount newly credited (0 = nothing due). */
  async refundExcess(
    manager: EntityManager,
    params: { order: Order; owedAfterMinor: number; idempotencyKey: string; reason: string; actorUserId?: string | null },
  ): Promise<number> {
    const walletPaid = Number(params.order.walletAmountMinor ?? 0);
    if (walletPaid <= 0) return 0;

    await this.walletService.lockCustomerWallet(params.order.customerId, manager);
    const alreadyRefunded = await this.walletService.getRefundedForOrderMinor(params.order.id, manager);
    const dueMinor = walletPaid - Math.max(0, params.owedAfterMinor) - alreadyRefunded;
    if (dueMinor <= 0) return 0;

    await this.walletService.recordTransaction(
      {
        customerId: params.order.customerId,
        amountDeltaMinor: dueMinor,
        type: WalletTransactionType.ORDER_REFUND,
        idempotencyKey: params.idempotencyKey,
        orderId: params.order.id,
        reason: params.reason,
        createdByUserId: params.actorUserId ?? null,
      },
      manager,
    );
    return dueMinor;
  }

  /** What the wallet still effectively pays for an order after any refunds — the basis of the cash/electronic amount still due. */
  async effectiveWalletPaidMinor(manager: EntityManager, order: Order): Promise<number> {
    const walletPaid = Number(order.walletAmountMinor ?? 0);
    if (walletPaid <= 0) return 0;
    return walletPaid - (await this.walletService.getRefundedForOrderMinor(order.id, manager));
  }
}
