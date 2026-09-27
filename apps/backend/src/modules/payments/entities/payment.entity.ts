import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { Order } from '../../orders/entities/order.entity';
import { User } from '../../users/entities/user.entity';
import { PaymentStatus } from '../payment-status.enum';
import { PendingRefundStatus } from '../pending-refund-status.enum';
import { ElectronicPaymentMethod } from '../electronic-payment-method.enum';

/**
 * A durable, auditable record of one order's payment. Confirmed: "a
 * customer claim is NOT equivalent to a successful payment" and "the
 * database/Admin verification is the source of truth" — this row IS
 * that source of truth, never the WhatsApp conversation.
 *
 * Only `MANUAL_TRANSFER` orders create a row today — COD stays
 * exactly as it was (no Payment row, per the confirmed "COD remains
 * unchanged" instruction), and ONLINE is rejected outright at order
 * creation (see OrderCreationService) until a real gateway is
 * selected. `method` still covers all three values so a future
 * gateway integration can reuse this same entity without a schema
 * change, per "preserve the existing PaymentProvider abstraction...
 * pluggable later."
 *
 * `amountMinor` mirrors `Order.totalMinor` at the moment this row was
 * created — nullable for the same reason `Order.totalMinor` itself
 * can be null (e.g. delivery-fee pricing not yet configured); never
 * fabricated if the real total isn't known yet.
 */
@Entity({ name: 'payments' })
export class Payment extends BaseEntity {
  @ManyToOne(() => Order)
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Index()
  @Column({ name: 'order_id' })
  orderId: string;

  @Column({ type: 'varchar', length: 20 })
  method: 'COD' | 'ONLINE' | 'MANUAL_TRANSFER';

  @Index()
  @Column({ type: 'varchar', length: 30, default: PaymentStatus.PENDING })
  status: PaymentStatus;

  @Column({ name: 'amount_minor', type: 'bigint', nullable: true })
  amountMinor?: number | null;

  /** The electronic method the customer chose for this transfer (INSTAPAY, VODAFONE_CASH, …). */
  @Column({ name: 'electronic_method', type: 'varchar', length: 20, nullable: true })
  electronicMethod?: ElectronicPaymentMethod | null;

  @Column({ name: 'claimed_at', type: 'timestamptz', nullable: true })
  claimedAt?: Date | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'verified_by_user_id' })
  verifiedBy?: User | null;

  @Column({ type: 'uuid', name: 'verified_by_user_id', nullable: true })
  verifiedByUserId?: string | null;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt?: Date | null;

  @Column({ name: 'rejection_reason', type: 'varchar', nullable: true })
  rejectionReason?: string | null;

  /**
   * PD-004 — the customer's pending refund entitlement while this transfer is not yet verified. An explicit persisted
   * state (never inferred): see PendingRefundStatus. `amountMinor` above stays what the customer was asked to pay (the
   * paid basis); `pendingRefundMinor` is `max(0, amountMinor - amount currently owed)`, re-derived on every cancellation.
   */
  @Column({ name: 'pending_refund_minor', type: 'bigint', default: 0 })
  pendingRefundMinor: number;

  @Column({ name: 'pending_refund_status', type: 'varchar', length: 12, default: PendingRefundStatus.NONE })
  pendingRefundStatus: PendingRefundStatus;

  /** When the entitlement was resolved (CONVERTED or VOIDED). */
  @Column({ name: 'pending_refund_resolved_at', type: 'timestamptz', nullable: true })
  pendingRefundResolvedAt?: Date | null;
}
