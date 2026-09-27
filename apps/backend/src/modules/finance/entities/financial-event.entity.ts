import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { FinancialEventDirection, FinancialEventType } from '../financial-event-type.enum';

/**
 * CONFIRMED (Phase F): "The financial system must be immutable/
 * event-oriented. Do NOT create a mutable 'balance' as the source of
 * truth." This entity is that source of truth — every financial fact
 * in the system is one row here, and no row is ever updated once
 * written (no update method exists anywhere that touches this table —
 * mirrors AdHocPurchaseRecord's and Payment's own immutability
 * discipline, applied at the general-ledger level this time).
 *
 * A correction is always a NEW event (e.g. a reimbursement referencing
 * an earlier expense), never an edit to the original — "never mutate
 * or erase the original event" (confirmed, cancellation/refund rules).
 *
 * VERIFIED (Phase F handoff review): re-checked every file that
 * imports this entity — the only write path anywhere is
 * FinancialEventService.record()'s single `.save(.create(...))` call,
 * always constructing a brand-new row; no `.update()`/`.remove()`/
 * second `.save()` of an existing row exists anywhere. Immutability is
 * therefore genuinely enforced today, at the application/service
 * layer. A DB-level guarantee (e.g. a trigger rejecting UPDATE/DELETE
 * on this table) is a reasonable future hardening step, not introduced
 * here — no code path currently needs it to be safe.
 *
 * Fields deliberately generic/nullable where a given event type
 * doesn't need them (e.g. `rateSnapshot` is only meaningful for
 * commission events) — one table for every event type, not nine
 * near-identical tables, matching this project's established
 * "Payment.method covers three shapes in one entity" precedent.
 *
 * `idempotencyKey` is the DB-level "this can only happen once"
 * guarantee (unique index, see the migration) — e.g.
 * "vendor-commission:{segmentId}" so a retried pickup transition can
 * never double-recognize the same commission. Mirrors
 * AdHocPurchaseRecord's unique-index-on-order_item_id pattern exactly.
 */
@Entity({ name: 'financial_events' })
@Index(['orderId'])
@Index(['type'])
export class FinancialEvent extends BaseEntity {
  @Column({ type: 'varchar', length: 60 })
  type: FinancialEventType;

  @Column({ type: 'varchar', length: 20 })
  direction: FinancialEventDirection;

  /** Null for a purely INFORMATIONAL event (e.g. a cancellation context note). */
  @Column({ name: 'amount_minor', type: 'bigint', nullable: true })
  amountMinor?: number | null;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId?: string | null;

  @Column({ name: 'order_vendor_segment_id', type: 'uuid', nullable: true })
  orderVendorSegmentId?: string | null;

  @Column({ name: 'delivery_id', type: 'uuid', nullable: true })
  deliveryId?: string | null;

  @Column({ name: 'payment_id', type: 'uuid', nullable: true })
  paymentId?: string | null;

  @Column({ name: 'vendor_branch_id', type: 'uuid', nullable: true })
  vendorBranchId?: string | null;

  @Column({ name: 'driver_id', type: 'uuid', nullable: true })
  driverId?: string | null;

  /**
   * The commission/multiplier rate that applied when this event was
   * recognized, frozen forever — "later Dashboard changes must NEVER
   * alter historical financial events." E.g. `{ commissionRateBasisPoints: 1000 }`
   * or `{ hatlyServiceMultiplier: 250 }`. Null for event types with no
   * applicable rate (e.g. a refund record).
   */
  @Column({ name: 'rate_snapshot', type: 'jsonb', nullable: true })
  rateSnapshot?: unknown | null;

  /** A link to another FinancialEvent this one references (e.g. a refund referencing the original PAID confirmation's context, or a cancellation-reimbursement referencing the original expense event). */
  @Column({ name: 'related_event_id', type: 'uuid', nullable: true })
  relatedEventId?: string | null;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  reason?: string | null;

  /** DB-level "only once" guarantee — see this file's own doc comment. */
  @Index({ unique: true })
  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey: string;
}
