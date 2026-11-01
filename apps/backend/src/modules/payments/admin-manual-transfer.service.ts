import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RefundPayout } from './entities/refund-payout.entity';
import { Payment } from './entities/payment.entity';
import { PaymentStatus } from './payment-status.enum';
import { PaymentStateMachineService } from './payment-state-machine.service';
import { Role } from '../../common/enums/role.enum';

/**
 * Admin-facing side of Manual Transfer. Confirmed: "only an authorized
 * Admin may mark a payment PAID or REJECTED" and "a terminal decision
 * is never silently overwritten or reversed." Both are enforced by
 * PaymentStateMachineService's own transition table (PAID/REJECTED
 * have no outgoing rule at all) — this service adds nothing on top of
 * that beyond a clearer error message for the already-terminal case.
 */
@Injectable()
export class AdminManualTransferService {
  constructor(
    @InjectRepository(Payment) private readonly paymentsRepository: Repository<Payment>,
    private readonly paymentStateMachine: PaymentStateMachineService,
    private readonly dataSource: DataSource,
  ) {}

  async listUnderReview(): Promise<Payment[]> {
    return this.paymentsRepository.find({
      where: { status: PaymentStatus.UNDER_REVIEW },
      order: { claimedAt: 'ASC' },
    });
  }

  async approve(paymentId: string, adminUserId: string): Promise<Payment> {
    await this.assertUnderReview(paymentId);
    return this.paymentStateMachine.transition({
      paymentId,
      to: PaymentStatus.PAID,
      actorRole: Role.ADMIN,
      verifiedByUserId: adminUserId,
    });
  }

  async reject(paymentId: string, adminUserId: string, reason?: string): Promise<Payment> {
    await this.assertUnderReview(paymentId);
    return this.paymentStateMachine.transition({
      paymentId,
      to: PaymentStatus.REJECTED,
      actorRole: Role.ADMIN,
      verifiedByUserId: adminUserId,
      rejectionReason: reason,
    });
  }

  private async assertUnderReview(paymentId: string): Promise<void> {
    const payment = await this.paymentsRepository.findOne({ where: { id: paymentId } });
    if (!payment) {
      throw new NotFoundException('Payment not found.');
    }
    if (payment.status !== PaymentStatus.UNDER_REVIEW) {
      throw new ConflictException(
        `This payment is already ${payment.status} — a terminal decision is never overwritten.`,
      );
    }
  }

  /**
   * Manual Transfer refund obligations (the REFUND ledger events) and whether operations have really SENT the money. A recorded refund is
   * "owed back"; only the payout marker says it was returned. Newest first; `sent=false` lists what operations still have to send.
   */
  async listRefunds(filter: { sent?: boolean }): Promise<
    Array<{ eventId: string; orderId: string | null; orderNumber: string | null; paymentId: string | null; amountMinor: number; recordedAt: string; sentAt: string | null; sentByUserId: string | null; note: string | null }>
  > {
    const rows = await this.dataSource.query(
      `SELECT e.id, e.order_id, o.order_number, e.payment_id, e.amount_minor, e.created_at, p.sent_at, p.sent_by_user_id, p.note
         FROM financial_events e
         LEFT JOIN orders o ON o.id = e.order_id
         LEFT JOIN refund_payouts p ON p.financial_event_id = e.id
        WHERE e.type = 'MANUAL_TRANSFER_REFUND_RECORDED'
          AND ($1::boolean IS NULL OR (p.id IS NOT NULL) = $1::boolean)
        ORDER BY e.created_at DESC
        LIMIT 200`,
      [filter.sent ?? null],
    );
    return rows.map((r: any) => ({
      eventId: r.id,
      orderId: r.order_id ?? null,
      orderNumber: r.order_number ?? null,
      paymentId: r.payment_id ?? null,
      amountMinor: Number(r.amount_minor ?? 0),
      recordedAt: new Date(r.created_at).toISOString(),
      sentAt: r.sent_at ? new Date(r.sent_at).toISOString() : null,
      sentByUserId: r.sent_by_user_id ?? null,
      note: r.note ?? null,
    }));
  }

  /** Marks a recorded refund as actually sent. Once only: a second mark is a conflict, never a second record. */
  async markRefundSent(eventId: string, adminUserId: string, note?: string): Promise<{ eventId: string; sentAt: string }> {
    const event = await this.dataSource.query(`SELECT id FROM financial_events WHERE id = $1 AND type = 'MANUAL_TRANSFER_REFUND_RECORDED'`, [eventId]);
    if (event.length === 0) throw new NotFoundException('Refund record not found.');
    const repo = this.dataSource.getRepository(RefundPayout);
    const existing = await repo.findOne({ where: { financialEventId: eventId } });
    if (existing) {
      throw new ConflictException({ message: 'This refund is already marked as sent.', details: { code: 'REFUND_ALREADY_SENT' } });
    }
    try {
      const saved = await repo.save(repo.create({ financialEventId: eventId, sentByUserId: adminUserId, note: note?.trim() || null }));
      return { eventId, sentAt: saved.sentAt.toISOString() };
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException({ message: 'This refund is already marked as sent.', details: { code: 'REFUND_ALREADY_SENT' } });
      }
      throw error;
    }
  }
}
