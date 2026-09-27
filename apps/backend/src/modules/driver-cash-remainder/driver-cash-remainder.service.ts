import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DriverCashRemainder } from './entities/driver-cash-remainder.entity';
import { DriverCashRemainderStatus } from './driver-cash-remainder-status.enum';
import { Order } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/order-status.enum';
import { DriverAuthorizationService } from '../delivery/driver-authorization.service';
import { WalletService } from '../wallet/wallet.service';
import { WalletTransactionType } from '../wallet/wallet-transaction-type.enum';
import { RequestContextService } from '../../common/request-context/request-context.service';
import { logBusinessEvent } from '../../common/logging/log-business-event';
import { BusinessEvent } from '../../common/logging/business-events';

/**
 * Admin-mediated Driver Cash Remainder (Chunk E). The Driver only
 * ever creates a PENDING_REVIEW claim (`submit`) — CONFIRMED, no code
 * path in this service lets a Driver create or influence a
 * WalletTransaction directly. Only `approve` (Admin-only, gated by
 * `MANAGE_CUSTOMER_WALLET` at the controller) ever calls
 * `WalletService.recordTransaction`.
 */
@Injectable()
export class DriverCashRemainderService {
  private readonly logger = new Logger(DriverCashRemainderService.name);

  constructor(
    @InjectRepository(DriverCashRemainder)
    private readonly remaindersRepository: Repository<DriverCashRemainder>,
    private readonly driverAuthorizationService: DriverAuthorizationService,
    private readonly dataSource: DataSource,
    private readonly walletService: WalletService,
    private readonly requestContextService: RequestContextService,
  ) {}

  /**
   * Driver submission. `cashReceivedMinor` is what the Driver actually
   * received — the remainder is ALWAYS derived as `cashReceivedMinor
   * - order.totalMinor`, never submitted as an independent,
   * standalone claim — CONFIRMED, this is what "use the existing
   * Order amount due, do not invent a new pricing calculation" means
   * in practice: there is no separate "remainder" number for a Driver
   * to get wrong or misreport independently of the two real numbers
   * (what they received, what was actually due).
   *
   * Ownership: `assertOwnsDelivery` (already-existing, already-tested
   * Driver/Delivery ownership check — same one `DriverOrderActionsService`
   * itself uses) throws NotFoundException if the Delivery isn't this
   * Driver's own — CONFIRMED, a Driver can never submit for another
   * Driver's delivery. Customer identity comes ONLY from
   * `delivery.order.customerId` — never a client-supplied field (the
   * DTO has no customerId field at all).
   *
   * Idempotency: the DB's unique index on `driver_cash_remainders.
   * order_id` (see the migration) is the real protection — a second
   * submission attempt for the same Order is caught here (Postgres
   * `23505`) and the EXISTING row is returned instead of creating a
   * duplicate or throwing a confusing raw DB error.
   */
  async submit(params: {
    driverUserId: string;
    deliveryId: string;
    cashReceivedMinor: number;
  }): Promise<DriverCashRemainder> {
    if (!Number.isInteger(params.cashReceivedMinor) || params.cashReceivedMinor <= 0) {
      throw new BadRequestException({
        message: 'cashReceivedMinor must be a positive integer.',
        details: { code: 'INVALID_CASH_RECEIVED' },
      });
    }

    const driver = await this.driverAuthorizationService.getDriverForUser(params.driverUserId);
    const delivery = await this.driverAuthorizationService.assertOwnsDelivery(driver.id, params.deliveryId);

    const order = await this.dataSource.getRepository(Order).findOne({ where: { id: delivery.orderId } });
    if (!order) {
      throw new NotFoundException('Order not found.');
    }
    if (order.paymentMethod !== 'COD' && order.paymentMethod !== 'PAY_AT_DELIVERY') {
      throw new BadRequestException({
        message: 'A cash remainder can only be recorded for a cash-paid Order.',
        details: { code: 'NOT_A_CASH_ORDER' },
      });
    }
    // Cash can only have changed hands at the customer's door: the driver is on the way to (or has
    // completed) the hand-over. Accepting a remainder for an order still at the vendor, or one that
    // failed/was cancelled, let an approved "remainder" credit the customer's wallet for cash that
    // was never collected (Group 8 finding).
    if (order.status !== OrderStatus.ON_THE_WAY && order.status !== OrderStatus.DELIVERED) {
      throw new BadRequestException({
        message: 'A cash remainder can only be recorded once the driver is on the way to, or has completed, the delivery.',
        details: { code: 'ORDER_NOT_AT_HANDOVER', status: order.status },
      });
    }

    // What the driver collects is what is still due AFTER the wallet (PD-006); older orders carry no wallet, so it falls back to the total.
    const amountDueMinor = order.amountDueMinor ?? order.totalMinor ?? order.subtotalMinor;
    const remainderAmountMinor = params.cashReceivedMinor - amountDueMinor;
    if (remainderAmountMinor <= 0) {
      throw new BadRequestException({
        message: 'The cash received does not exceed the amount due — there is no remainder to record.',
        details: { code: 'NO_REMAINDER', amountDueMinor, cashReceivedMinor: params.cashReceivedMinor },
      });
    }

    try {
      const saved = await this.remaindersRepository.save(
        this.remaindersRepository.create({
          orderId: order.id,
          deliveryId: delivery.id,
          driverId: driver.id,
          customerId: order.customerId,
          remainderAmountMinor,
          status: DriverCashRemainderStatus.PENDING_REVIEW,
          submittedAt: new Date(),
        }),
      );
      // A plain `repo.save()` call, its own committed unit of work —
      // safe to log immediately, no ambient transaction to wait on.
      logBusinessEvent(this.logger, 'log', BusinessEvent.DRIVER_CASH_REMAINDER_SUBMITTED, () => this.requestContextService.getCorrelationId(), {
        remainderId: saved.id,
        orderId: order.id,
        driverId: driver.id,
        remainderAmountMinor,
      });
      return saved;
    } catch (error: any) {
      if (error?.code === '23505') {
        // Already submitted for this Order — CONFIRMED benign,
        // idempotent: return the existing claim rather than a raw DB
        // error or a silent duplicate.
        const existing = await this.remaindersRepository.findOne({ where: { orderId: order.id } });
        if (existing) {
          logBusinessEvent(
            this.logger,
            'warn',
            BusinessEvent.DRIVER_CASH_REMAINDER_DUPLICATE_SUBMISSION,
            () => this.requestContextService.getCorrelationId(),
            { remainderId: existing.id, orderId: order.id, driverId: driver.id },
          );
          return existing;
        }
      }
      throw error;
    }
  }

  async listPending(): Promise<DriverCashRemainder[]> {
    return this.remaindersRepository.find({
      where: { status: DriverCashRemainderStatus.PENDING_REVIEW },
      order: { submittedAt: 'ASC' },
    });
  }

  async getOne(id: string): Promise<DriverCashRemainder> {
    const remainder = await this.remaindersRepository.findOne({ where: { id } });
    if (!remainder) {
      throw new NotFoundException('Cash remainder record not found.');
    }
    return remainder;
  }

  /**
   * Admin Order Detail View (Chunk 2a). Read-only — CONFIRMED, no
   * business behavior added. A given Order has at most one remainder
   * (the migration's unique index on `order_id` already guarantees
   * this), but this returns an array to stay consistent with "no
   * record exists" being an empty list rather than a special case.
   */
  async findByOrderId(orderId: string): Promise<DriverCashRemainder[]> {
    return this.remaindersRepository.find({ where: { orderId } });
  }

  /**
   * Admin approval. ONE transaction: re-verify PENDING_REVIEW (inside
   * the lock, so a concurrent second approval attempt cannot both
   * proceed), create the WalletTransaction, mark APPROVED — all
   * together or none of it, per the approved atomicity requirement.
   *
   * Idempotency: the WalletTransaction's `idempotencyKey` is
   * `driver-cash-remainder:<remainder.id>` — deterministic, so a
   * retried approval naturally collides on the ALREADY-EXISTING
   * unique WalletTransaction (Chunk B) rather than crediting twice.
   * That collision is caught here and treated as a benign no-op
   * (the remainder is already APPROVED by then in the normal case,
   * so the pending check above would already have stopped a genuine
   * retry before reaching the Wallet write at all — this catch is
   * defense in depth for the narrow window where two concurrent
   * approval requests both pass the pending check before either
   * commits).
   */
  async approve(remainderId: string, adminUserId: string): Promise<DriverCashRemainder> {
    let walletConflictDetected = false;

    const approved = await this.dataSource.transaction(async (manager) => {
      const remainder = await manager.findOne(DriverCashRemainder, {
        where: { id: remainderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!remainder) {
        throw new NotFoundException('Cash remainder record not found.');
      }
      if (remainder.status !== DriverCashRemainderStatus.PENDING_REVIEW) {
        throw new BadRequestException({
          message: `This cash remainder is already ${remainder.status.toLowerCase()} and cannot be approved again.`,
          details: { code: 'REMAINDER_NOT_PENDING', status: remainder.status },
        });
      }

      const idempotencyKey = `driver-cash-remainder:${remainder.id}`;
      try {
        await this.walletService.recordTransaction(
          {
            customerId: remainder.customerId,
            amountDeltaMinor: remainder.remainderAmountMinor,
            type: WalletTransactionType.DRIVER_CASH_REMAINDER,
            orderId: remainder.orderId,
            createdByUserId: adminUserId,
            reason: `Approved Driver cash remainder of ${remainder.remainderAmountMinor} minor units for order ${remainder.orderId}.`,
            idempotencyKey,
          },
          manager,
        );
      } catch (error: any) {
        if (error?.code !== '23505') throw error;
        // See this method's own comment — benign concurrent-retry no-op.
        // Captured in a local flag, not logged here: this branch runs
        // mid-transaction, and the REAL outcome (whether this whole
        // approval ultimately commits) is only known once the
        // transaction below resolves — logged post-commit, together
        // with the rest of this event, same discipline as everywhere
        // else in this group.
        walletConflictDetected = true;
      }

      remainder.status = DriverCashRemainderStatus.APPROVED;
      remainder.reviewedAt = new Date();
      remainder.reviewedByUserId = adminUserId;
      return manager.save(remainder);
    });

    // Business-event log (Group 4). Post-commit only — see this
    // method's own transaction above. Covers both the normal case (a
    // new WalletTransaction credit was created) and the narrow
    // concurrent-retry case (the wallet write collided with an
    // already-existing one and was skipped) via `walletConflictDetected`.
    logBusinessEvent(this.logger, 'log', BusinessEvent.DRIVER_CASH_REMAINDER_APPROVED, () => this.requestContextService.getCorrelationId(), {
      remainderId: approved.id,
      orderId: approved.orderId,
      customerId: approved.customerId,
      driverId: approved.driverId,
      amountMinor: approved.remainderAmountMinor,
      adminUserId,
      walletIdempotencyConflict: walletConflictDetected,
    });
    if (!walletConflictDetected) {
      logBusinessEvent(this.logger, 'log', BusinessEvent.WALLET_CREDIT, () => this.requestContextService.getCorrelationId(), {
        customerId: approved.customerId,
        amountDeltaMinor: approved.remainderAmountMinor,
        type: WalletTransactionType.DRIVER_CASH_REMAINDER,
        orderId: approved.orderId,
      });
    }

    return approved;
  }

  /** Admin rejection. Terminal in V1 — no reopening path exists. */
  async reject(remainderId: string, adminUserId: string, reason: string): Promise<DriverCashRemainder> {
    if (!reason) {
      throw new BadRequestException({
        message: 'A rejection reason is required.',
        details: { code: 'REJECTION_REASON_REQUIRED' },
      });
    }
    const rejected = await this.dataSource.transaction(async (manager) => {
      const remainder = await manager.findOne(DriverCashRemainder, {
        where: { id: remainderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!remainder) {
        throw new NotFoundException('Cash remainder record not found.');
      }
      if (remainder.status !== DriverCashRemainderStatus.PENDING_REVIEW) {
        throw new BadRequestException({
          message: `This cash remainder is already ${remainder.status.toLowerCase()} and cannot be rejected.`,
          details: { code: 'REMAINDER_NOT_PENDING', status: remainder.status },
        });
      }
      remainder.status = DriverCashRemainderStatus.REJECTED;
      remainder.reviewedAt = new Date();
      remainder.reviewedByUserId = adminUserId;
      remainder.rejectionReason = reason;
      return manager.save(remainder);
    });

    logBusinessEvent(this.logger, 'log', BusinessEvent.DRIVER_CASH_REMAINDER_REJECTED, () => this.requestContextService.getCorrelationId(), {
      remainderId: rejected.id,
      orderId: rejected.orderId,
      driverId: rejected.driverId,
      adminUserId,
    });

    return rejected;
  }
}
