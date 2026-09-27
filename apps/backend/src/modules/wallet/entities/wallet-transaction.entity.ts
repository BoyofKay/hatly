import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { User } from '../../users/entities/user.entity';
import { Order } from '../../orders/entities/order.entity';
import { WalletTransactionType } from '../wallet-transaction-type.enum';

/**
 * Customer Wallet Ledger Foundation (Chunk B). Same append-only
 * discipline as Chunk A's `LoyaltyPointsTransaction` and this
 * codebase's existing `EmployeeLoan`/`OfferConsumption`: a customer's
 * Wallet balance is NEVER a stored field anywhere — always derived by
 * summing `amountDeltaMinor` for that customer (see
 * `WalletService.getBalance`). No update/delete business operation
 * exists for this entity — a correction is always a new, separate
 * compensating row (e.g. a wrongly-applied +5000 is corrected by a
 * -5000 `ADJUSTMENT` row, never by editing/removing the original).
 *
 * `amountDeltaMinor` is `bigint` — CONFIRMED deliberately, unlike
 * Chunk A's `pointsDelta` (`int`): money genuinely needs bigint range
 * (large cumulative balances, large order totals), and every other
 * `*Minor` monetary column in this codebase (`Offer.budgetCapMinor`,
 * `OrderItem.offerDiscountAmountMinor`, `EmployeeLoan.
 * borrowedAmountMinor`, etc.) is `bigint` too — this is the
 * established convention for money specifically, and Chunk A's `int`
 * choice was a POINTS-specific deviation, not a general one to carry
 * over here. Balance derivation (`WalletService.getBalance`) uses the
 * exact same direct JS-side summation already used everywhere else in
 * this codebase for bigint `*Minor` columns (e.g.
 * `EmployeeLoanService.getStatus()`, `OfferConsumptionService`'s own
 * cache updates) — consistent with the established pattern, not a new
 * one invented for Wallet alone.
 *
 * `customerId` references `User` directly — no separate `Customer`
 * entity exists in this codebase (same convention Chunk A already
 * follows). `orderId`/`createdByUserId` are nullable, unconstrained
 * (no FK) — matching `OfferConsumption.orderId`'s own precedent
 * exactly, since some transactions (ADMIN_CREDIT, ADJUSTMENT) will
 * never reference an Order at all.
 *
 * `idempotencyKey` is UNIQUE at the DB level — the actual, final
 * double-write guard (never only an application-level check), same
 * discipline as `OfferConsumption`'s own partial unique indexes.
 */
@Entity({ name: 'wallet_transactions' })
export class WalletTransaction extends BaseEntity {
  @ManyToOne(() => User)
  @JoinColumn({ name: 'customer_id' })
  customer: User;

  @Index()
  @Column({ name: 'customer_id' })
  customerId: string;

  /** Signed. Positive = money credited to the Wallet. Negative = money debited. Never zero. */
  @Column({ name: 'amount_delta_minor', type: 'bigint' })
  amountDeltaMinor: number;

  @Column({ type: 'varchar', length: 30 })
  type: WalletTransactionType;

  /** Nullable, unconstrained — see this entity's own top comment. */
  @ManyToOne(() => Order, { nullable: true })
  @JoinColumn({ name: 'order_id' })
  order?: Order | null;

  @Index()
  @Column({ type: 'uuid', name: 'order_id', nullable: true })
  orderId?: string | null;

  /** Required for ADMIN_CREDIT/ADJUSTMENT (enforced at the service layer — see WalletService). Optional for other types. */
  @Column({ type: 'varchar', nullable: true })
  reason?: string | null;

  /** The human actor for ADMIN_CREDIT/ADJUSTMENT rows. Null for system-generated rows (ORDER_PAYMENT, ORDER_REFUND, etc.). */
  @Column({ type: 'uuid', name: 'created_by_user_id', nullable: true })
  createdByUserId?: string | null;

  /**
   * The final, DB-enforced double-write guard — CONFIRMED mandatory
   * on every row, unique at the database level (see the migration).
   * A future caller (checkout debit, refund, Admin credit,
   * Points->Wallet conversion) always derives this from something
   * stable about the triggering operation (e.g. an Order id + a fixed
   * suffix) so a retried request naturally collides on this
   * constraint rather than creating a second transaction.
   */
  @Index({ unique: true })
  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey: string;
}
