import { OpsAlertsService } from '../notifications/ops-alerts.service';
import { StaffAlertsService } from '../notifications/staff-alerts.service';
import { notifyVendorsOfNewOrder } from '../orders/vendor-new-order-alerts';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { Order } from '../orders/entities/order.entity';
import { ManualTransferRefundService } from './manual-transfer-refund.service';
import { reanchorPreparationTiming } from '../orders/order-preparation-timing';
import { PaymentStatus } from './payment-status.enum';
import { Role } from '../../common/enums/role.enum';
import { RequestContextService } from '../../common/request-context/request-context.service';
import { logBusinessEvent } from '../../common/logging/log-business-event';
import { BusinessEvent } from '../../common/logging/business-events';

type TransitionRule = { from: PaymentStatus; to: PaymentStatus; allowedRoles: Role[] };

/**
 * Mirrors OrderStateMachineService/OrderVendorSegmentStateMachineService's
 * exact pattern (explicit transition table, DB row lock, role check) —
 * the same architecture already established twice in this codebase,
 * not a new design.
 *
 * CUSTOMER_CLAIMED_TRANSFER -> UNDER_REVIEW is listed here as its own
 * transition, gated to Role.ADMIN — the same "system actor" convention
 * OrderReadinessService already uses for its own automatic,
 * system-driven advancement. ManualTransferService calls both
 * transitions back-to-back within one claim() call (see its own doc
 * comment) — the customer never triggers this second step directly,
 * satisfying "an automatic state transition, not a separate Admin
 * action" exactly.
 *
 * PAID and REJECTED are terminal: no rule exists with either as
 * `from`, so any further attempt fails this table's own lookup with a
 * clear rejection — never silently overwritten, per the confirmed
 * "do not silently overwrite or reverse a terminal payment state."
 */
const TRANSITIONS: TransitionRule[] = [
  { from: PaymentStatus.PENDING, to: PaymentStatus.CUSTOMER_CLAIMED_TRANSFER, allowedRoles: [Role.CUSTOMER] },
  { from: PaymentStatus.CUSTOMER_CLAIMED_TRANSFER, to: PaymentStatus.UNDER_REVIEW, allowedRoles: [Role.ADMIN] },
  { from: PaymentStatus.UNDER_REVIEW, to: PaymentStatus.PAID, allowedRoles: [Role.ADMIN, Role.SUPER_ADMIN] },
  { from: PaymentStatus.UNDER_REVIEW, to: PaymentStatus.REJECTED, allowedRoles: [Role.ADMIN, Role.SUPER_ADMIN] },
];

@Injectable()
export class PaymentStateMachineService {
  private readonly logger = new Logger(PaymentStateMachineService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly requestContextService: RequestContextService,
    private readonly manualTransferRefundService: ManualTransferRefundService,
    // Staff inbox. Optional so unit tests that build this service by hand keep working unchanged.
    @Optional() private readonly staffAlerts?: StaffAlertsService,
    // Operations alerts (P0 2026-11-08): an InstaPay order becomes "new" for Operations when it reaches the stores. Optional for unit tests.
    @Optional() private readonly opsAlerts?: OpsAlertsService,
  ) {}

  async transition(params: {
    paymentId: string;
    to: PaymentStatus;
    actorRole: Role;
    verifiedByUserId?: string;
    rejectionReason?: string;
  }): Promise<Payment> {
    let fromStatus: PaymentStatus | undefined;

    const updatedPayment = await this.dataSource.transaction(async (manager) => {
      // PD-004: approving a transfer reconciles it against the order's CURRENT amount owed, and a vendor cancellation
      // changes that amount under the ORDER lock. To serialize the two (and never deadlock: cancellation locks order →
      // payment), the order row is locked BEFORE the payment row whenever the payment is being marked PAID.
      if (params.to === PaymentStatus.PAID) {
        const peek = await manager.findOne(Payment, { where: { id: params.paymentId } });
        if (peek) {
          await manager.findOne(Order, { where: { id: peek.orderId }, lock: { mode: 'pessimistic_write' } });
        }
      }

      const payment = await manager.findOne(Payment, {
        where: { id: params.paymentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment) {
        throw new NotFoundException('Payment not found.');
      }

      const rule = TRANSITIONS.find((t) => t.from === payment.status && t.to === params.to);
      if (!rule) {
        throw new ConflictException(
          `Cannot transition payment from ${payment.status} to ${params.to} — it may already be in a terminal state.`,
        );
      }
      if (!rule.allowedRoles.includes(params.actorRole)) {
        throw new BadRequestException(`Role ${params.actorRole} is not allowed to perform this transition.`);
      }

      fromStatus = payment.status;
      payment.status = params.to;
      if (params.to === PaymentStatus.CUSTOMER_CLAIMED_TRANSFER) {
        payment.claimedAt = new Date();
      }
      if (params.to === PaymentStatus.PAID || params.to === PaymentStatus.REJECTED) {
        payment.verifiedByUserId = params.verifiedByUserId ?? null;
        payment.verifiedAt = new Date();
        if (params.to === PaymentStatus.REJECTED) {
          payment.rejectionReason = params.rejectionReason ?? null;
        }
      }

      const saved = await manager.save(payment);

      // PD-004, inside the SAME transaction as the status change (never a separate step that could be lost):
      // PAID → convert a pending refund entitlement into the one real refund event; REJECTED → void it, pay nothing.
      if (params.to === PaymentStatus.PAID) {
        await this.manualTransferRefundService.convertPendingRefund(saved, params.verifiedByUserId ?? null, manager);
        // Operational ETA (never financial): preparation could not genuinely have started before this moment — see
        // `paymentBlocksFulfilment`/`OrderPaymentGateService` — so every still-open segment's estimate starts counting from
        // NOW, not from whenever the order was originally created.
        await reanchorPreparationTiming(manager, saved.orderId);
        // R2: the vendor sees (and is told about) an InstaPay / Vodafone Cash order only from this moment — same transaction.
        if (this.staffAlerts) {
          const order = await manager.findOne(Order, { where: { id: saved.orderId } });
          if (order && order.paymentMethod === 'MANUAL_TRANSFER' && order.status !== 'CANCELLED') {
            await notifyVendorsOfNewOrder(manager, this.staffAlerts, order);
          }
        }
        if (this.opsAlerts) {
          const order = await manager.findOne(Order, { where: { id: saved.orderId } });
          if (order && order.paymentMethod === 'MANUAL_TRANSFER' && order.status !== 'CANCELLED') await this.opsAlerts.raiseNewOrder(manager, order);
        }
      } else if (params.to === PaymentStatus.REJECTED) {
        await this.manualTransferRefundService.voidPendingRefund(saved, manager);
      }
      return saved;
    });

    // Business-event log (Group 4). Post-commit only — this method
    // owns its own transaction, so reaching this line means the status
    // change (and, for PAID/REJECTED, the verifiedByUserId/verifiedAt)
    // is already durable. The single chokepoint for every `Payment.
    // status` write, so the single place this event is ever emitted.
    logBusinessEvent(this.logger, 'log', BusinessEvent.PAYMENT_STATE_TRANSITION, () => this.requestContextService.getCorrelationId(), {
      paymentId: updatedPayment.id,
      orderId: updatedPayment.orderId,
      from: fromStatus,
      to: params.to,
      actorRole: params.actorRole,
      verifiedByUserId: params.verifiedByUserId ?? null,
    });

    return updatedPayment;
  }
}
