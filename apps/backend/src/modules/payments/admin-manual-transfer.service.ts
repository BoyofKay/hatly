import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
}
