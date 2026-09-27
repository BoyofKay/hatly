import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { Order } from '../../orders/entities/order.entity';
import { User } from '../../users/entities/user.entity';
import { FailedDeliveryOutcome } from '../failed-delivery-outcome.enum';

/**
 * Failed Delivery Resolution (Chunk 2b). A single, terminal Admin
 * decision for one FAILED_DELIVERY Order — CONFIRMED: exactly one
 * record per Order (unique `order_id`), no update/delete method
 * exists anywhere in `FailedDeliveryResolutionService`, matching the
 * exact terminal-decision discipline already established by
 * `DriverCashRemainder`/`AdHocPurchaseRecord` in this codebase.
 *
 * `refundAmountMinor` is deliberately never auto-derived from
 * `Payment.amountMinor`/`Order.totalMinor`/any Custom Request amount
 * — it is always the Admin's own explicit entry, validated only for
 * internal consistency with `outcome` (never validated against any
 * other field — that belongs to the future refund-execution chunk).
 *
 * This entity records a DECISION only. It has no relationship to
 * WalletTransaction/FinancialEvent/Payment and creates none of them —
 * see `FailedDeliveryResolutionService`'s own comment for the exact
 * scope boundary.
 *
 * `resolvedByUserId` is the only actor field — CONFIRMED deliberately,
 * this is a single-actor action (unlike `DriverCashRemainder`'s
 * genuine two-actor submit-then-approve split), so
 * `reviewedBy`/`approvedBy`/`createdBy` would all be redundant with
 * this one field.
 */
@Entity({ name: 'failed_delivery_resolutions' })
export class FailedDeliveryResolution extends BaseEntity {
  @ManyToOne(() => Order)
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Index({ unique: true })
  @Column({ name: 'order_id' })
  orderId: string;

  @Column({ type: 'varchar', length: 30 })
  outcome: FailedDeliveryOutcome;

  /** Required (positive integer) iff `outcome === REFUND_CUSTOMER`; NULL iff `outcome === RESOLVED_NO_REFUND` — enforced by both the service layer and a DB CHECK constraint (see the migration). */
  @Column({ name: 'refund_amount_minor', type: 'bigint', nullable: true })
  refundAmountMinor?: number | null;

  @Column({ name: 'driver_review_needed', type: 'boolean', default: false })
  driverReviewNeeded: boolean;

  @Column({ name: 'driver_review_notes', type: 'varchar', nullable: true })
  driverReviewNotes?: string | null;

  @Column({ type: 'varchar', nullable: true })
  notes?: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'resolved_by_user_id' })
  resolvedByUser: User;

  @Column({ name: 'resolved_by_user_id' })
  resolvedByUserId: string;

  @Column({ name: 'resolved_at', type: 'timestamptz' })
  resolvedAt: Date;
}
