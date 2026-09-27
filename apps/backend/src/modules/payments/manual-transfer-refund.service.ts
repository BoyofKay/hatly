import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentStatus } from './payment-status.enum';
import { FinancialEventService } from '../finance/financial-event.service';
import { FinancialEventDirection, FinancialEventType } from '../finance/financial-event-type.enum';
import { FinancialEvent } from '../finance/entities/financial-event.entity';
import { PendingRefundStatus } from './pending-refund-status.enum';
import { Order } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/order-status.enum';

/**
 * CONFIRMED (Phase F, decision 9): "the original Payment remains
 * PAID... do NOT mutate the original Payment into another status...
 * the refund is a separate financial event/record." This service
 * never calls PaymentStateMachineService or writes to the Payment row
 * at all — it only reads it (to confirm it's actually PAID) and
 * creates a FinancialEvent.
 *
 * "Do not assume the external bank/wallet transfer itself can be
 * automatically verified unless a real integration exists" — no such
 * integration exists in this codebase, so this is, correctly, a
 * manually-recorded action by an Admin, exactly like the original
 * PAID verification itself.
 *
 * TECHNICAL CHOICE, flagged: idempotency key is per-payment
 * (`manual-transfer-refund:{paymentId}`), meaning only one refund
 * event can be recorded per payment through this exact mechanism —
 * a reasonable default for "one payment, one refund," not a business
 * rule about whether partial/multiple refunds are ever allowed
 * (not addressed either way in the approved decisions).
 */
@Injectable()
export class ManualTransferRefundService {
  constructor(
    @InjectRepository(Payment) private readonly paymentsRepository: Repository<Payment>,
    private readonly financialEventService: FinancialEventService,
  ) {}

  /**
   * Atomic Manual Transfer Refund on Order Cancellation (Chunk B2).
   * `manager` is optional and purely additive — CONFIRMED, the
   * existing no-manager call shape (used everywhere today, e.g. the
   * standalone Admin-initiated refund action) behaves exactly as
   * before. When provided (e.g. from inside
   * `OrderStateMachineService.transition()`'s own locked cancellation
   * transaction), BOTH the Payment lookup and the FinancialEvent write
   * go through that SAME manager — never the injected repository,
   * never a second transaction — so this call can finally participate
   * in another service's transaction instead of always committing
   * independently (the exact gap Chunk B1 built the prerequisite for).
   */
  async recordRefund(
    params: {
      paymentId: string;
      amountMinor: number;
      reason?: string;
      actorUserId: string;
    },
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(Payment) : this.paymentsRepository;
    const payment = await repo.findOne({ where: { id: params.paymentId } });
    if (!payment) {
      throw new NotFoundException('Payment not found.');
    }
    if (payment.status !== PaymentStatus.PAID) {
      throw new BadRequestException({
        message: 'Only a payment already marked PAID can be refunded.',
        details: { code: 'PAYMENT_NOT_PAID' },
      });
    }

    await this.financialEventService.record(
      {
        type: FinancialEventType.MANUAL_TRANSFER_REFUND_RECORDED,
        direction: FinancialEventDirection.PAYABLE,
        idempotencyKey: `manual-transfer-refund:${params.paymentId}`,
        amountMinor: params.amountMinor,
        orderId: payment.orderId,
        paymentId: payment.id,
        actorUserId: params.actorUserId,
        reason:
          params.reason ?? 'Manual Transfer refund — Hatly transfers this amount back to the customer externally.',
      },
      manager,
    );
    // Deliberately no write to `payment` itself — PAID stays PAID.
  }

  /** Idempotency key of the ONE whole-payment refund (order cancelled / admin-recorded) — unchanged since Phase F. */
  /**
   * WALLET + MANUAL TRANSFER (PD-001): the wallet pays FIRST, the transfer pays the rest, and refunds go the other way — EXTERNAL
   * PAYMENT FIRST, wallet second. What the transfer still has to cover once `owedAfterMinor` (the WHOLE order's amount still owed)
   * stands is therefore `owedAfter − wallet`, never `owedAfter`: comparing the transfer against the whole order total would
   * under-refund the customer by the wallet amount. The wallet amount is the order's own frozen `walletAmountMinor` (never
   * client-supplied), so this is independent of any wallet refund already made; the wallet side is
   * `OrderWalletRefundService.refundExcess` (`wallet − owedAfter`), which only starts paying out once this reaches 0.
   * With no wallet it is exactly `owedAfter` — the previous behaviour.
   */
  static externalOwedAfter(owedAfterMinor: number, walletPaidMinor: number): number {
    return Math.max(0, Math.max(0, owedAfterMinor) - Math.max(0, walletPaidMinor));
  }

  private async walletPaidMinor(orderId: string, manager: EntityManager): Promise<number> {
    const order = await manager.getRepository(Order).findOne({ where: { id: orderId } });
    return Number(order?.walletAmountMinor ?? 0);
  }

  static wholePaymentKey(paymentId: string): string {
    return `manual-transfer-refund:${paymentId}`;
  }

  /** Idempotency key of the refund created when a pending refund entitlement is converted at payment approval (PD-004). */
  static pendingConversionKey(paymentId: string): string {
    return `manual-transfer-refund:${paymentId}:pending-conversion`;
  }

  /** Idempotency key of the refund caused by cancelling ONE vendor segment. */
  static segmentKey(paymentId: string, segmentId: string): string {
    return `manual-transfer-refund:${paymentId}:segment:${segmentId}`;
  }

  /**
   * Everything already recorded as refunded for this payment, across every refund event (whole-payment and
   * per-segment). Runs on the caller's transaction, so it sees that transaction's own earlier writes.
   */
  async getRefundedAmountMinor(paymentId: string, manager: EntityManager): Promise<number> {
    const events = await manager.getRepository(FinancialEvent).find({
      where: { paymentId, type: FinancialEventType.MANUAL_TRANSFER_REFUND_RECORDED },
    });
    return events.reduce((sum, e) => sum + Number(e.amountMinor ?? 0), 0);
  }

  /**
   * Partial vendor cancellation. The refund is SERVER-derived, never supplied by a caller:
   *
   *   refund = (amount the customer PAID) - (amount now OWED) - (already refunded)
   *
   * `paid` is `Payment.amountMinor` (frozen when the transfer was verified PAID), `owed` is the recomputed
   * `Order.totalMinor`, and `already refunded` is the sum of the refund events recorded for this payment. Only a PAID
   * Manual Transfer payment can be refunded; for anything else (COD / PAY_AT_DELIVERY have no Payment row at all, or
   * the transfer is not verified yet) nothing is recorded and 0 is returned.
   *
   * Idempotent per (payment, segment) via the financial-event key, and computed under a row lock on the payment so
   * two concurrent cancellations can never both refund the same money. Must run on the caller's transaction.
   * Returns the amount newly recorded (0 when nothing is due).
   */
  async recordRefundForReducedTotal(
    params: { orderId: string; owedAfterMinor: number; segmentId: string; actorUserId: string; reason: string },
    manager: EntityManager,
  ): Promise<number> {
    const payment = await manager
      .getRepository(Payment)
      .createQueryBuilder('payment')
      .where('payment.order_id = :orderId', { orderId: params.orderId })
      .setLock('pessimistic_write')
      .getOne();
    if (!payment || payment.status !== PaymentStatus.PAID || payment.amountMinor == null) {
      return 0;
    }

    const paidMinor = Number(payment.amountMinor);
    const alreadyRefundedMinor = await this.getRefundedAmountMinor(payment.id, manager);
    const externalOwedMinor = ManualTransferRefundService.externalOwedAfter(
      params.owedAfterMinor,
      await this.walletPaidMinor(payment.orderId, manager),
    );
    const dueMinor = paidMinor - externalOwedMinor - alreadyRefundedMinor;
    if (dueMinor <= 0) {
      return 0;
    }

    const key = ManualTransferRefundService.segmentKey(payment.id, params.segmentId);
    const existing = await manager.getRepository(FinancialEvent).findOne({ where: { idempotencyKey: key } });
    if (existing) {
      return 0; // this segment's refund was already recorded — never twice
    }

    await this.financialEventService.record(
      {
        type: FinancialEventType.MANUAL_TRANSFER_REFUND_RECORDED,
        direction: FinancialEventDirection.PAYABLE,
        idempotencyKey: key,
        amountMinor: dueMinor,
        orderId: payment.orderId,
        orderVendorSegmentId: params.segmentId,
        paymentId: payment.id,
        actorUserId: params.actorUserId,
        reason: params.reason,
      },
      manager,
    );
    return dueMinor;
  }

  /**
   * Whole-order cancellation. Refunds whatever of the paid amount has NOT already been refunded by earlier
   * per-segment refunds — i.e. the full paid amount when there were none (exactly the previous behaviour), and only
   * the remainder otherwise, so a partly-refunded payment is never refunded twice. Same key as before
   * (`manual-transfer-refund:{paymentId}`), so it stays idempotent with the admin-recorded refund.
   */
  async recordRemainingRefund(
    params: { paymentId: string; actorUserId: string; reason: string },
    manager: EntityManager,
  ): Promise<number> {
    const payment = await manager.getRepository(Payment).findOne({ where: { id: params.paymentId } });
    if (!payment) throw new NotFoundException('Payment not found.');
    if (payment.status !== PaymentStatus.PAID || payment.amountMinor == null) return 0;

    const remainingMinor = Number(payment.amountMinor) - (await this.getRefundedAmountMinor(payment.id, manager));
    if (remainingMinor <= 0) return 0;

    await this.recordRefund(
      { paymentId: payment.id, amountMinor: remainingMinor, actorUserId: params.actorUserId, reason: params.reason },
      manager,
    );
    return remainingMinor;
  }

  /** A transfer nobody has verified yet: it may still be approved (→ refund) or rejected (→ nothing). */
  private static isUnverified(status: PaymentStatus): boolean {
    return (
      status === PaymentStatus.PENDING ||
      status === PaymentStatus.CUSTOMER_CLAIMED_TRANSFER ||
      status === PaymentStatus.UNDER_REVIEW
    );
  }

  /**
   * PD-004. Called from a vendor-segment cancellation, whatever the payment's state:
   *  - PAID          → the existing immediate refund of (paid − owed − already refunded), per segment;
   *  - unverified    → NO refund event (the transfer may still be rejected and the money never received); instead the
   *                    customer's pending refund entitlement is re-derived from the amount NOW owed;
   *  - REJECTED / no payment row (COD, PAY_AT_DELIVERY) → nothing.
   * Runs on the caller's transaction, under the payment row lock.
   */
  async reconcileReducedTotal(
    params: { orderId: string; owedAfterMinor: number; segmentId: string; actorUserId: string; reason: string },
    manager: EntityManager,
  ): Promise<{ refundedMinor: number; pendingRefundMinor: number }> {
    const payment = await this.lockPaymentByOrderId(params.orderId, manager);
    if (!payment) return { refundedMinor: 0, pendingRefundMinor: 0 };

    if (payment.status === PaymentStatus.PAID) {
      return { refundedMinor: await this.recordRefundForReducedTotal(params, manager), pendingRefundMinor: 0 };
    }
    if (ManualTransferRefundService.isUnverified(payment.status)) {
      return { refundedMinor: 0, pendingRefundMinor: await this.setPendingRefund(payment, params.owedAfterMinor, manager) };
    }
    return { refundedMinor: 0, pendingRefundMinor: 0 };
  }

  /** PD-004. The whole order was cancelled (nothing is owed any more) while the transfer is unverified: entitlement = the whole amount. */
  async recordPendingRefundForCancelledOrder(orderId: string, manager: EntityManager): Promise<number> {
    const payment = await this.lockPaymentByOrderId(orderId, manager);
    if (!payment || !ManualTransferRefundService.isUnverified(payment.status)) return 0;
    return this.setPendingRefund(payment, 0, manager);
  }

  /**
   * The entitlement is a pure function of (paid basis, amount owed now) — it is RE-DERIVED on every cancellation, never
   * accumulated, so repeating a cancellation or cancelling several segments always leaves exactly the final overpayment.
   * `Payment.amountMinor` (what the customer was asked to pay, and may already have sent) is deliberately left untouched.
   */
  private async setPendingRefund(payment: Payment, owedAfterMinor: number, manager: EntityManager): Promise<number> {
    if (payment.amountMinor == null) return 0;
    // Never more than the transfer itself, and net of what the wallet already covers of the amount still owed.
    const externalOwedMinor = ManualTransferRefundService.externalOwedAfter(
      owedAfterMinor,
      await this.walletPaidMinor(payment.orderId, manager),
    );
    const pendingMinor = Math.max(0, Number(payment.amountMinor) - externalOwedMinor);
    payment.pendingRefundMinor = pendingMinor;
    payment.pendingRefundStatus = pendingMinor > 0 ? PendingRefundStatus.PENDING : PendingRefundStatus.NONE;
    await manager.save(Payment, payment);
    return pendingMinor;
  }

  /**
   * PD-004. The transfer has just been verified PAID (called inside the payment state machine's transaction, with the
   * order and payment rows locked). Reconciles the payment against what is owed NOW and converts a PENDING entitlement
   * into the one real refund event — for exactly `paid − owed − alreadyRefunded`, re-derived from the order (the stored
   * entitlement is never trusted as the amount). Idempotent: the event has a fixed key and the entitlement is terminal.
   */
  async convertPendingRefund(payment: Payment, actorUserId: string | null, manager: EntityManager): Promise<number> {
    if (payment.pendingRefundStatus !== PendingRefundStatus.PENDING || payment.amountMinor == null) return 0;

    const order = await manager.findOne(Order, { where: { id: payment.orderId } });
    if (!order) return 0;
    // A cancelled order owes nothing (its money fields are zeroed, but be explicit); an unknown total is not guessable.
    const owedMinor = order.status === OrderStatus.CANCELLED ? 0 : order.totalMinor == null ? null : Number(order.totalMinor);
    if (owedMinor === null) return 0; // leave the entitlement PENDING rather than invent an amount

    const dueMinor =
      Number(payment.amountMinor) -
      ManualTransferRefundService.externalOwedAfter(owedMinor, Number(order.walletAmountMinor ?? 0)) -
      (await this.getRefundedAmountMinor(payment.id, manager));

    payment.pendingRefundResolvedAt = new Date();
    if (dueMinor <= 0) {
      payment.pendingRefundMinor = 0;
      payment.pendingRefundStatus = PendingRefundStatus.NONE; // the order total came back up — nothing is overpaid
      await manager.save(Payment, payment);
      return 0;
    }

    await this.financialEventService.record(
      {
        type: FinancialEventType.MANUAL_TRANSFER_REFUND_RECORDED,
        direction: FinancialEventDirection.PAYABLE,
        idempotencyKey: ManualTransferRefundService.pendingConversionKey(payment.id),
        amountMinor: dueMinor,
        orderId: payment.orderId,
        paymentId: payment.id,
        actorUserId,
        reason:
          'Manual Transfer verified after a vendor cancellation — Hatly transfers the overpaid amount back to the customer externally.',
      },
      manager,
    );
    payment.pendingRefundMinor = dueMinor;
    payment.pendingRefundStatus = PendingRefundStatus.CONVERTED;
    await manager.save(Payment, payment);
    return dueMinor;
  }

  /** PD-004. The transfer was REJECTED: Hatly never confirmed receipt, so the entitlement is voided and nothing is paid. */
  async voidPendingRefund(payment: Payment, manager: EntityManager): Promise<void> {
    if (payment.pendingRefundStatus !== PendingRefundStatus.PENDING) return;
    payment.pendingRefundStatus = PendingRefundStatus.VOIDED;
    payment.pendingRefundResolvedAt = new Date();
    await manager.save(Payment, payment);
  }

  private lockPaymentByOrderId(orderId: string, manager: EntityManager): Promise<Payment | null> {
    return manager
      .getRepository(Payment)
      .createQueryBuilder('payment')
      .where('payment.order_id = :orderId', { orderId })
      .setLock('pessimistic_write')
      .getOne();
  }
}
