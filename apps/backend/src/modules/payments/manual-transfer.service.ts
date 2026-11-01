import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { StaffAlertsService } from '../notifications/staff-alerts.service';
import { Permission } from '../permissions/permission.enum';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentStatus } from './payment-status.enum';
import { PaymentStateMachineService } from './payment-state-machine.service';
import { BusinessConfigService } from '../business-config/business-config.service';
import { Role } from '../../common/enums/role.enum';

/**
 * Customer-facing side of Manual Transfer. Confirmed: "the WhatsApp
 * button is a communication/support mechanism, NOT the source of
 * truth for payment status" — this service (and the Payment row it
 * manages) is that source of truth; nothing here trusts a WhatsApp
 * message or screenshot.
 */
@Injectable()
export class ManualTransferService {
  constructor(
    @InjectRepository(Payment) private readonly paymentsRepository: Repository<Payment>,
    private readonly paymentStateMachine: PaymentStateMachineService,
    private readonly businessConfigService: BusinessConfigService,
    // Staff inbox (Operations notification centre). Optional so unit tests that build this service by hand keep working unchanged.
    @Optional() private readonly staffAlerts?: StaffAlertsService,
  ) {}

  /**
   * Fails closed (throws) if either config value is unset — matches
   * OrderCreationService's own decision not to offer MANUAL_TRANSFER
   * until both are configured.
   */
  async getConfig(): Promise<{
    destination: { label: string; phoneOrAccountNumber: string; accountName?: string };
    whatsappNumber: string;
  }> {
    const [destination, whatsappNumber] = await Promise.all([
      this.businessConfigService.getManualTransferDestination(),
      this.businessConfigService.getCustomerServiceWhatsappNumber(),
    ]);
    return { destination, whatsappNumber };
  }

  /**
   * Idempotent: repeat calls after the first successful claim simply
   * return the current state rather than erroring — "idempotent,
   * never a duplicate claim or a confusing error." Internally performs
   * BOTH confirmed transitions (PENDING -> CUSTOMER_CLAIMED_TRANSFER,
   * then automatically -> UNDER_REVIEW) within this one call — the
   * customer never triggers the second step directly, satisfying
   * "automatic, not a separate Admin action."
   *
   * Reliability & Adversarial Testing milestone fix: the guard above
   * only protects SEQUENTIAL replay — it reads the payment WITHOUT a
   * lock, so under true concurrency (the same customer double-tapping
   * "I sent the transfer") several calls can all observe PENDING before
   * any of them commits, and all proceed past the guard. Each one's own
   * `transition()` call is individually safe (row-locked, never
   * corrupts data), but a call that reaches the row lock while a
   * DIFFERENT concurrent call is between its own two steps (status is
   * now CUSTOMER_CLAIMED_TRANSFER, not yet UNDER_REVIEW) got a raw
   * `ConflictException` — a confusing error for an operation that, by
   * the time the client sees the response, has ALREADY succeeded via
   * the other caller. Reproduced deterministically under real
   * concurrency (see the e2e suite's own test). A `ConflictException`
   * from either step here means exactly that: something else already
   * moved this payment past the state this call expected — the same
   * "benign, expected replay" outcome the guard above already returns
   * for, so it's treated identically: re-read the (now further along)
   * row and return it, never surfaced as an error to the client.
   */
  async claimTransfer(customerId: string, orderId: string): Promise<Payment> {
    const payment = await this.paymentsRepository.findOne({
      where: { orderId },
      relations: { order: true },
    });
    if (!payment || payment.order.customerId !== customerId) {
      // Same "don't leak which case" pattern used throughout this
      // codebase for ownership checks.
      throw new NotFoundException('Payment not found.');
    }

    if (payment.status !== PaymentStatus.PENDING) {
      return payment; // already claimed (or beyond) — idempotent, no error
    }

    try {
      await this.paymentStateMachine.transition({
        paymentId: payment.id,
        to: PaymentStatus.CUSTOMER_CLAIMED_TRANSFER,
        actorRole: Role.CUSTOMER,
      });

      // Automatic — the confirmed rule that this is not a separate Admin
      // action, only ever system-driven, using the same "system actor"
      // convention (Role.ADMIN) already established by OrderReadinessService.
      const reviewed = await this.paymentStateMachine.transition({
        paymentId: payment.id,
        to: PaymentStatus.UNDER_REVIEW,
        actorRole: Role.ADMIN,
      });
      // The staff who verify transfers are told it is waiting for them (one row per payment; never blocks the customer's claim).
      if (this.staffAlerts) {
        const manager = this.paymentsRepository.manager;
        await this.staffAlerts.alert(manager, {
          eventKey: `transfer-review:${payment.id}`, category: 'OPS_TRANSFER_TO_VERIFY', requiredAction: 'VERIFY_TRANSFER',
          recipients: await this.staffAlerts.recipientsHolding(manager, [Permission.VERIFY_MANUAL_PAYMENTS]),
          orderId: payment.orderId, orderNumber: payment.order.orderNumber,
        });
      }
      return reviewed;
    } catch (error) {
      if (error instanceof ConflictException) {
        // A concurrent call already advanced this payment past the state
        // this attempt expected — re-read the current, authoritative row
        // rather than surfacing the race as an error.
        const current = await this.paymentsRepository.findOne({ where: { id: payment.id } });
        if (current) return current;
      }
      throw error;
    }
  }
}
