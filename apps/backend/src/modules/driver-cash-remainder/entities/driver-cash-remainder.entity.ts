import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { Order } from '../../orders/entities/order.entity';
import { Delivery } from '../../delivery/entities/delivery.entity';
import { Driver } from '../../delivery/entities/driver.entity';
import { DriverCashRemainderStatus } from '../driver-cash-remainder-status.enum';

/**
 * Admin-mediated Driver Cash Remainder (Chunk E). A Driver's CLAIM
 * that a customer overpaid in cash — CONFIRMED, this record alone
 * never credits the Wallet. Only Admin approval (see
 * DriverCashRemainderService.approve) creates the actual
 * WalletTransaction, in a separate table this entity has no direct
 * relation to. The resulting WalletTransaction's idempotencyKey is
 * derived deterministically from THIS row's own `id`
 * (`driver-cash-remainder:<id>`) at approval time — no separate
 * idempotency column is needed on this entity itself, since the id
 * already exists by the time approval ever runs.
 *
 * `customerId` is stored here (denormalized from `Order`) purely for
 * efficient/auditable querying — CONFIRMED never the source of truth
 * for "who gets credited"; `approve()` re-derives the customer fresh
 * from the `Order` itself, never trusting this column, so a Driver
 * could never redirect a credit by tampering with a field they don't
 * even have write access to after creation.
 *
 * No update/delete business operation exists once APPROVED or
 * REJECTED — CONFIRMED append-only for terminal states, matching
 * every other ledger-adjacent entity in this codebase. A
 * `PENDING_REVIEW` row is the only mutable state, and only
 * `approve`/`reject` may transition it, exactly once each.
 */
@Entity({ name: 'driver_cash_remainders' })
export class DriverCashRemainder extends BaseEntity {
  @ManyToOne(() => Order)
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Index()
  @Column({ name: 'order_id' })
  orderId: string;

  @ManyToOne(() => Delivery)
  @JoinColumn({ name: 'delivery_id' })
  delivery: Delivery;

  @Column({ name: 'delivery_id' })
  deliveryId: string;

  @ManyToOne(() => Driver)
  @JoinColumn({ name: 'driver_id' })
  driver: Driver;

  @Index()
  @Column({ name: 'driver_id' })
  driverId: string;

  /** Denormalized from Order for querying only — see this entity's own top comment. NEVER the source of truth at approval time. */
  @Column({ type: 'uuid', name: 'customer_id' })
  customerId: string;

  /** Always positive integer minor units. */
  @Column({ name: 'remainder_amount_minor', type: 'bigint' })
  remainderAmountMinor: number;

  @Column({ type: 'varchar', length: 20, default: DriverCashRemainderStatus.PENDING_REVIEW })
  status: DriverCashRemainderStatus;

  @Column({ name: 'submitted_at', type: 'timestamptz' })
  submittedAt: Date;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt?: Date | null;

  @Column({ type: 'uuid', name: 'reviewed_by_user_id', nullable: true })
  reviewedByUserId?: string | null;

  @Column({ name: 'rejection_reason', type: 'varchar', nullable: true })
  rejectionReason?: string | null;
}
