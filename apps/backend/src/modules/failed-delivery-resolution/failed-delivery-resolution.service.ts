import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FailedDeliveryResolution } from './entities/failed-delivery-resolution.entity';
import { FailedDeliveryOutcome } from './failed-delivery-outcome.enum';
import { Order } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/order-status.enum';
import { Payment } from '../payments/entities/payment.entity';
import { PaymentStatus } from '../payments/payment-status.enum';
import { Delivery } from '../delivery/entities/delivery.entity';
import { Driver } from '../delivery/entities/driver.entity';
import { User } from '../users/entities/user.entity';
import { ManualTransferRefundService } from '../payments/manual-transfer-refund.service';
import { FinancialEventService } from '../finance/financial-event.service';
import { FinancialEventType } from '../finance/financial-event-type.enum';
import { WalletService } from '../wallet/wallet.service';
import { RequestContextService } from '../../common/request-context/request-context.service';
import { logBusinessEvent } from '../../common/logging/log-business-event';
import { BusinessEvent } from '../../common/logging/business-events';

export interface FailedDeliveryRefundResult {
  orderId: string;
  resolutionId: string;
  refundAmountMinor: number;
  /** Null when the order was paid only from the wallet (no Manual Transfer payment exists). */
  paymentId: string | null;
  /** How the refund was split: external (Manual Transfer) FIRST, wallet second. The two add up to refundAmountMinor. */
  transferRefundedMinor: number;
  walletRefundedMinor: number;
  status: 'REFUNDED' | 'ALREADY_REFUNDED';
}

export interface FailedDeliveryQueueItem {
  orderId: string;
  failedAt: Date | null;
  failureReason: string | null;
  customerId: string;
  customerName: string | null;
  driverId: string | null;
  driverName: string | null;
  totalMinor: number | null;
  paymentMethod: string;
  paymentStatus: string | null;
  createdAt: Date;
}

/**
 * Failed Delivery Resolution (Chunk 2b). CONFIRMED scope: this service
 * ONLY reads Orders/Payments/Users for the queue projection, and
 * creates exactly one `FailedDeliveryResolution` row per resolve
 * call. It NEVER creates a `WalletTransaction`, NEVER creates a
 * `FinancialEvent`, NEVER calls `ManualTransferRefundService`, NEVER
 * writes to `Payment` or `Order.status` — the refund EXECUTION for a
 * `REFUND_CUSTOMER` outcome is explicitly Chunk 2c's job, not this
 * one's. This is a decision-recording service only.
 *
 * No update/delete method exists here, deliberately — once created, a
 * resolution is permanent, matching the exact terminal-decision
 * discipline `DriverCashRemainder`/`AdHocPurchaseRecord` already
 * establish in this codebase.
 */
@Injectable()
export class FailedDeliveryResolutionService {
  private readonly logger = new Logger(FailedDeliveryResolutionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly manualTransferRefundService: ManualTransferRefundService,
    private readonly financialEventService: FinancialEventService,
    private readonly requestContextService: RequestContextService,
    private readonly walletService: WalletService,
  ) {}

  /**
   * Unresolved FAILED_DELIVERY orders — CONFIRMED: `Order.status =
   * FAILED_DELIVERY` AND no matching resolution row. A lightweight
   * projection only — deliberately does NOT reuse/duplicate
   * `AdminOrdersService`'s full detail assembly (segments/items/
   * financial events/etc.) — that remains exclusively behind `GET
   * admin/orders/:id`.
   */
  async listQueue(): Promise<FailedDeliveryQueueItem[]> {
    const manager = this.dataSource.manager;

    const failedOrders = await manager
      .createQueryBuilder(Order, 'order')
      .leftJoin(FailedDeliveryResolution, 'resolution', 'resolution.order_id = order.id')
      .where('order.status = :status', { status: OrderStatus.FAILED_DELIVERY })
      .andWhere('resolution.id IS NULL')
      .getMany();

    if (failedOrders.length === 0) return [];

    const orderIds = failedOrders.map((o) => o.id);
    const payments = await manager
      .createQueryBuilder(Payment, 'payment')
      .where('payment.order_id IN (:...orderIds)', { orderIds })
      .getMany();
    const paymentByOrderId = new Map(payments.map((p) => [p.orderId, p]));

    const customerIds = [...new Set(failedOrders.map((o) => o.customerId))];
    const customers = customerIds.length > 0 ? await manager.createQueryBuilder(User, 'u').where('u.id IN (:...customerIds)', { customerIds }).getMany() : [];
    const customerById = new Map(customers.map((c) => [c.id, c]));

    const deliveries = await manager
      .createQueryBuilder(Delivery, 'delivery')
      .where('delivery.order_id IN (:...orderIds)', { orderIds })
      .getMany();
    const deliveryByOrderId = new Map(deliveries.map((d) => [d.orderId, d]));
    const driverIds = [...new Set(deliveries.map((d) => d.driverId).filter((id): id is string => !!id))];
    const drivers = driverIds.length > 0 ? await manager.createQueryBuilder(Driver, 'driver').where('driver.id IN (:...driverIds)', { driverIds }).getMany() : [];
    const driverById = new Map(drivers.map((d) => [d.id, d]));
    const driverUserIds = [...new Set(drivers.map((d) => d.userId))];
    const driverUsers = driverUserIds.length > 0 ? await manager.createQueryBuilder(User, 'u').where('u.id IN (:...driverUserIds)', { driverUserIds }).getMany() : [];
    const driverUserById = new Map(driverUsers.map((u) => [u.id, u]));

    return failedOrders.map((order) => {
      const payment = paymentByOrderId.get(order.id);
      const customer = customerById.get(order.customerId);
      const delivery = deliveryByOrderId.get(order.id);
      const driver = delivery?.driverId ? driverById.get(delivery.driverId) : undefined;
      const driverUser = driver ? driverUserById.get(driver.userId) : undefined;
      return {
        orderId: order.id,
        failedAt: order.failedAt ?? null,
        failureReason: order.failureReason ?? null,
        customerId: order.customerId,
        customerName: customer?.fullName ?? null,
        driverId: driver?.id ?? null,
        driverName: driverUser?.fullName ?? null,
        totalMinor: order.totalMinor ?? null,
        paymentMethod: order.paymentMethod,
        paymentStatus: payment?.status ?? null,
        createdAt: (order as any).createdAt,
      };
    });
  }

  /**
   * Creates exactly one FailedDeliveryResolution for an order already
   * in FAILED_DELIVERY. Row-locks the Order for the duration of the
   * check-then-insert sequence; the unique `order_id` index on
   * `FailedDeliveryResolution` remains the actual, final concurrency
   * guard if two Admins somehow still race past the application-level
   * check.
   *
   * ZERO financial side effects — CONFIRMED, this method touches only
   * `Order` (read-only) and `FailedDeliveryResolution` (one insert).
   */
  async resolve(
    orderId: string,
    params: {
      outcome: FailedDeliveryOutcome;
      refundAmountMinor?: number;
      driverReviewNeeded?: boolean;
      driverReviewNotes?: string;
      notes?: string;
    },
    resolvedByUserId: string,
  ): Promise<FailedDeliveryResolution> {
    this.assertRefundAmountConsistency(params.outcome, params.refundAmountMinor);

    const result = await this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(Order, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) {
        throw new NotFoundException('Order not found.');
      }
      if (order.status !== OrderStatus.FAILED_DELIVERY) {
        throw new BadRequestException({
          message: 'Only an Order in FAILED_DELIVERY can be resolved.',
          details: { code: 'ORDER_NOT_FAILED_DELIVERY', status: order.status },
        });
      }

      const existing = await manager.findOne(FailedDeliveryResolution, { where: { orderId } });
      if (existing) {
        throw new ConflictException({
          message: 'This Order has already been resolved.',
          details: { code: 'ALREADY_RESOLVED' },
        });
      }

      return manager.save(
        FailedDeliveryResolution,
        manager.create(FailedDeliveryResolution, {
          orderId,
          outcome: params.outcome,
          refundAmountMinor: params.outcome === FailedDeliveryOutcome.REFUND_CUSTOMER ? params.refundAmountMinor : null,
          driverReviewNeeded: params.driverReviewNeeded ?? false,
          driverReviewNotes: params.driverReviewNotes ?? null,
          notes: params.notes ?? null,
          resolvedByUserId,
          resolvedAt: new Date(),
        }),
      );
    });

    logBusinessEvent(this.logger, 'log', BusinessEvent.FAILED_DELIVERY_RESOLVED, () => this.requestContextService.getCorrelationId(), {
      resolutionId: result.id,
      orderId,
      outcome: result.outcome,
      refundAmountMinor: result.refundAmountMinor ?? null,
      resolvedByUserId,
    });

    return result;
  }

  private assertRefundAmountConsistency(outcome: FailedDeliveryOutcome, refundAmountMinor?: number): void {
    if (outcome === FailedDeliveryOutcome.REFUND_CUSTOMER) {
      if (!Number.isInteger(refundAmountMinor) || (refundAmountMinor as number) <= 0) {
        throw new BadRequestException({
          message: 'refundAmountMinor must be a positive integer when outcome is REFUND_CUSTOMER.',
          details: { code: 'INVALID_REFUND_AMOUNT' },
        });
      }
    } else if (refundAmountMinor != null) {
      throw new BadRequestException({
        message: 'refundAmountMinor must be omitted when outcome is RESOLVED_NO_REFUND.',
        details: { code: 'UNEXPECTED_REFUND_AMOUNT' },
      });
    }
  }

  /**
   * Failed Delivery — Manual Transfer Refund Execution (Chunk 2c).
   * Executes an already-recorded `REFUND_CUSTOMER` decision for a
   * Manual Transfer PAID payment. CONFIRMED scope: this method never
   * changes `Order.status`, never modifies the `FailedDeliveryResolution`
   * row (it stays exactly as Chunk 2b created it, permanently), never
   * touches Wallet/Loyalty/Inventory/AdHocPurchaseRecord/
   * DriverCashRemainder. It only reads those, plus delegates the
   * actual money-movement record to the existing, unchanged
   * `ManualTransferRefundService.recordRefund`.
   *
   * Eligibility (all required): a resolution exists with
   * `outcome === REFUND_CUSTOMER`; a Payment exists for the order;
   * `Payment.method === MANUAL_TRANSFER` (validated HERE — the
   * underlying `recordRefund` does not check method); `Payment.status
   * === PAID`; `0 < refundAmountMinor <= Payment.amountMinor` (the
   * upper-bound cap is additive protection Chunk 2c adds — the
   * underlying service has no such cap itself).
   *
   * Idempotency: before calling `recordRefund`, checks whether a
   * `MANUAL_TRANSFER_REFUND_RECORDED` event already exists for this
   * Payment (via the existing `FinancialEventService.findByOrderId`,
   * filtered by type). If one exists with the SAME amount as the
   * current resolution, returns `ALREADY_REFUNDED` — a safe,
   * idempotent success. If one exists with a DIFFERENT amount (the
   * exact edge case `ManualTransferRefundService`'s own idempotency
   * key would otherwise silently paper over), this is treated as a
   * genuine financial conflict and rejected — CONFIRMED, never
   * silently accepted, per the explicit safety requirement.
   */
  async executeManualTransferRefund(orderId: string, actorUserId: string): Promise<FailedDeliveryRefundResult> {
    const result = await this.dataSource.transaction(async (manager) => {
      // Lock order: ORDER → payment → wallet (the same direction every other refund path takes).
      const order = await manager.findOne(Order, { where: { id: orderId }, lock: { mode: 'pessimistic_write' } });
      if (!order) {
        throw new NotFoundException('Order not found.');
      }

      const resolution = await manager.findOne(FailedDeliveryResolution, { where: { orderId } });
      if (!resolution) {
        throw new NotFoundException('Failed Delivery Resolution not found for this Order.');
      }
      if (resolution.outcome !== FailedDeliveryOutcome.REFUND_CUSTOMER) {
        throw new BadRequestException({
          message: 'This Order’s resolution outcome is not REFUND_CUSTOMER.',
          details: { code: 'RESOLUTION_NOT_REFUND_CUSTOMER' },
        });
      }
      const refundAmountMinor = resolution.refundAmountMinor as number;
      if (!Number.isInteger(refundAmountMinor) || refundAmountMinor <= 0) {
        throw new BadRequestException({
          message: 'The resolution’s refundAmountMinor is invalid.',
          details: { code: 'INVALID_REFUND_AMOUNT' },
        });
      }

      const walletPaidMinor = Number(order.walletAmountMinor ?? 0);
      const payment = await manager
        .getRepository(Payment)
        .createQueryBuilder('payment')
        .where('payment.order_id = :orderId', { orderId })
        .setLock('pessimistic_write')
        .getOne();
      if (!payment && walletPaidMinor <= 0) {
        throw new BadRequestException({
          message: 'No payment exists for this Order — automatic refund is not supported.',
          details: { code: 'NO_MANUAL_TRANSFER_PAYMENT' },
        });
      }
      if (payment && payment.method !== 'MANUAL_TRANSFER' && walletPaidMinor <= 0) {
        throw new BadRequestException({
          message: 'Automatic refund is only supported for Manual Transfer payments.',
          details: { code: 'UNSUPPORTED_PAYMENT_METHOD_FOR_AUTOMATIC_REFUND' },
        });
      }
      // The Manual Transfer component is refundable only once it is PAID. With a wallet component the order can still be
      // refunded from the wallet alone; without one an unpaid transfer keeps rejecting exactly as before.
      const transferRefundable = !!payment && payment.method === 'MANUAL_TRANSFER' && payment.status === PaymentStatus.PAID;
      if (payment && payment.method === 'MANUAL_TRANSFER' && !transferRefundable && walletPaidMinor <= 0) {
        throw new BadRequestException({
          message: 'Only a payment already marked PAID can be refunded.',
          details: { code: 'PAYMENT_NOT_PAID' },
        });
      }

      // PD-002: earlier PARTIAL vendor-cancellation refunds (their events carry per-segment keys) already returned part
      // of the payment — only the rest can still be refunded here, and they are not "the" resolution refund.
      const existingEvents = payment ? await this.financialEventService.findByOrderId(orderId) : [];
      const isSegmentRefund = (e: { idempotencyKey?: string }) =>
        !!payment && (e.idempotencyKey ?? '').startsWith(`${ManualTransferRefundService.wholePaymentKey(payment.id)}:`); // :segment:… or :pending-conversion
      const partialRefundsMinor = payment
        ? existingEvents
            .filter((e) => e.type === FinancialEventType.MANUAL_TRANSFER_REFUND_RECORDED && e.paymentId === payment.id && isSegmentRefund(e))
            .reduce((sum, e) => sum + Number(e.amountMinor ?? 0), 0)
        : 0;

      // Idempotency (Chunk 2c, explicit requirement): never trust a refund's own key blindly if a different amount could be in
      // play — compare against what was ACTUALLY recorded, across BOTH components (transfer + wallet).
      const existingRefundEvent = payment
        ? existingEvents.find(
            (e) => e.type === FinancialEventType.MANUAL_TRANSFER_REFUND_RECORDED && e.paymentId === payment.id && !isSegmentRefund(e),
          )
        : undefined;
      const walletKey = FailedDeliveryResolutionService.walletRefundKey(orderId);
      const existingWalletRefund = walletPaidMinor > 0 ? await this.walletService.findByIdempotencyKey(walletKey, manager) : null;
      if (existingRefundEvent || existingWalletRefund) {
        const transferDone = Number(existingRefundEvent?.amountMinor ?? 0);
        const walletDone = Number(existingWalletRefund?.amountDeltaMinor ?? 0);
        if (transferDone + walletDone === refundAmountMinor) {
          // Reflects an already-committed prior refund — safe to log unconditionally (a read of pre-existing state).
          logBusinessEvent(
            this.logger,
            'warn',
            BusinessEvent.FAILED_DELIVERY_REFUND_ALREADY_RECORDED,
            () => this.requestContextService.getCorrelationId(),
            { orderId, resolutionId: resolution.id, paymentId: payment?.id ?? null, refundAmountMinor },
          );
          return {
            orderId,
            resolutionId: resolution.id,
            refundAmountMinor,
            paymentId: payment?.id ?? null,
            transferRefundedMinor: transferDone,
            walletRefundedMinor: walletDone,
            status: 'ALREADY_REFUNDED' as const,
          };
        }
        throw new ConflictException({
          message: 'A refund for a different amount was already recorded for this payment.',
          details: { code: 'REFUND_AMOUNT_MISMATCH' },
        });
      }

      // WATERFALL — EXTERNAL PAYMENT FIRST, WALLET SECOND — and never more than the customer actually paid: the transfer is
      // capped by what it received minus what was refunded already, the wallet by what it paid minus what came back to it.
      // COD / Pay-at-Delivery amounts were never collected, so they contribute nothing here.
      const transferAvailableMinor = transferRefundable ? Number(payment!.amountMinor ?? 0) - partialRefundsMinor : 0;
      const walletAvailableMinor =
        walletPaidMinor > 0 ? walletPaidMinor - (await this.walletService.getRefundedForOrderMinor(orderId, manager)) : 0;
      if (refundAmountMinor > Math.max(0, transferAvailableMinor) + Math.max(0, walletAvailableMinor)) {
        throw new BadRequestException({
          message: 'The resolution’s refund amount exceeds the amount actually paid.',
          details: { code: 'REFUND_EXCEEDS_PAYMENT_AMOUNT' },
        });
      }
      const transferPartMinor = Math.min(refundAmountMinor, Math.max(0, transferAvailableMinor));
      const walletPartMinor = refundAmountMinor - transferPartMinor;

      if (transferPartMinor > 0) {
        await this.manualTransferRefundService.recordRefund(
          {
            paymentId: payment!.id,
            amountMinor: transferPartMinor,
            actorUserId,
            reason: `Failed Delivery refund — resolution ${resolution.id}.`,
          },
          manager,
        );
      }
      if (walletPartMinor > 0) {
        await this.walletService.refundOrderPayment(manager, {
          customerId: order.customerId,
          orderId,
          walletPaidMinor,
          amountMinor: walletPartMinor,
          idempotencyKey: walletKey,
          reason: `Failed Delivery refund — resolution ${resolution.id} — returned to the wallet.`,
          actorUserId,
        });
      }

      return {
        orderId,
        resolutionId: resolution.id,
        refundAmountMinor,
        paymentId: payment?.id ?? null,
        transferRefundedMinor: transferPartMinor,
        walletRefundedMinor: walletPartMinor,
        status: 'REFUNDED' as const,
      };
    });

    // Business-event log (Group 4). Post-commit only for the genuine "a refund was just recorded" outcome. The ALREADY_REFUNDED
    // case is already logged above (a read of pre-existing state, not gated on this transaction).
    if (result.status === 'REFUNDED') {
      logBusinessEvent(this.logger, 'log', BusinessEvent.FAILED_DELIVERY_REFUND_EXECUTED, () => this.requestContextService.getCorrelationId(), {
        orderId: result.orderId,
        resolutionId: result.resolutionId,
        paymentId: result.paymentId,
        refundAmountMinor: result.refundAmountMinor,
        actorUserId,
        ...(result.walletRefundedMinor > 0 ? { transferRefundedMinor: result.transferRefundedMinor, walletRefundedMinor: result.walletRefundedMinor } : {}),
      });
    }

    return result;
  }

  /** Ledger idempotency key of the wallet component of an order's failed-delivery refund (one per order). */
  static walletRefundKey(orderId: string): string {
    return `order-refund:${orderId}:failed-delivery`;
  }
}
