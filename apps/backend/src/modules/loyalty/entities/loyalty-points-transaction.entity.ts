import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { User } from '../../users/entities/user.entity';
import { Order } from '../../orders/entities/order.entity';
import { LoyaltyTransactionType } from '../loyalty-transaction-type.enum';

/**
 * Loyalty Ledger Foundation (Chunk A). Mirrors the exact append-only
 * discipline already proven by `EmployeeLoan`/`EmployeeLoanRepayment`
 * in this codebase: a customer's points balance is NEVER a stored
 * field anywhere (not on `User`, not cached here) — it is always
 * derived by summing `pointsDelta` across every transaction for that
 * customer (see `LoyaltyService.getBalance`). No update or delete
 * business operation exists for this entity — a correction is always
 * a new, separate compensating row (e.g. a `+500 EARNING` mistake is
 * corrected by a `-500 EARNING_REVERSED` row, never by editing or
 * removing the original).
 *
 * `customerId` references `User` directly, not a separate `Customer`
 * entity — this codebase has none (confirmed: `OfferConsumption.
 * customerId` does the exact same thing).
 *
 * `orderId` is deliberately nullable — CONFIRMED per the approved
 * design: some future transactions (e.g. `ADMIN_ADJUSTMENT`) will
 * never originate from an Order at all. No FK constraint is added
 * (matching `OfferConsumption.orderId`'s own unconstrained
 * convention in this codebase), and no columns are added to `Order`
 * in this chunk — none are "strictly required by the foundation."
 *
 * `pointsDelta` is `int` (not `bigint`) — a deliberate, considered
 * deviation from `EmployeeLoanRepayment.amountMinor`'s bigint column.
 * Points are a small integer count (never fractional, never anywhere
 * near a monetary minor-unit's realistic magnitude), so `int`'s
 * ~2.1 billion range is already absurdly more than any real
 * customer/lifetime total could ever reach, and — critically —
 * `pg`/TypeORM reliably return an `int` column as a genuine JS
 * `number`, unlike `bigint`, which this codebase has NO global type
 * parser configured for (confirmed by inspection) and which would
 * otherwise risk silent string-concatenation bugs during balance
 * summation. This is a safety choice, not a convention violation.
 */
@Entity({ name: 'loyalty_points_transactions' })
export class LoyaltyPointsTransaction extends BaseEntity {
  @ManyToOne(() => User)
  @JoinColumn({ name: 'customer_id' })
  customer: User;

  @Index()
  @Column({ name: 'customer_id' })
  customerId: string;

  /** Signed. Positive = points earned/credited. Negative = points reversed/redeemed/expired. Never zero (not meaningful as a ledger entry). */
  @Column({ name: 'points_delta', type: 'int' })
  pointsDelta: number;

  @Column({ type: 'varchar', length: 30 })
  type: LoyaltyTransactionType;

  /** Nullable — see this entity's own top comment. No FK constraint (matches OfferConsumption.orderId's unconstrained convention). */
  @ManyToOne(() => Order, { nullable: true })
  @JoinColumn({ name: 'order_id' })
  order?: Order | null;

  @Index()
  @Column({ type: 'uuid', name: 'order_id', nullable: true })
  orderId?: string | null;

  /** Required for ADMIN_ADJUSTMENT (enforced at the service layer, not a DB constraint, matching this codebase's existing preference for service-level business validation with a clear error over a generic DB failure). Optional for other types. */
  @Column({ type: 'varchar', nullable: true })
  reason?: string | null;

  /** The Admin actor for ADMIN_ADJUSTMENT rows. Null for system-generated rows (EARNING, EARNING_REVERSED, etc.), since those have no human actor. */
  @Column({ type: 'uuid', name: 'created_by_user_id', nullable: true })
  createdByUserId?: string | null;

  /**
   * Points -> Wallet Conversion (Chunk D). Nullable — only set for
   * REDEMPTION rows created by the conversion operation; every
   * existing EARNING/ADMIN_ADJUSTMENT row leaves this null. Unique
   * when present (see the migration's partial index) — the same key
   * a REDEMPTION row shares with its paired WalletTransaction
   * LOYALTY_REDEMPTION row, enforcing cross-ledger idempotency
   * independently on both sides.
   */
  @Column({ name: 'idempotency_key', type: 'varchar', length: 255, nullable: true })
  idempotencyKey?: string | null;
}
