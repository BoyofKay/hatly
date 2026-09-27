import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { OrderItem } from './order-item.entity';
import { Driver } from '../../delivery/entities/driver.entity';

/**
 * The historical source of truth for "what is the final real amount
 * for this product-less OrderItem" — never a second, competing
 * source alongside `OrderItem.actualAmountMinor` (that column is only
 * ever a read-optimization cache of what's recorded here — see its
 * own doc comment). Originally AD_HOC_SERVICE-only (a Driver's actual
 * purchase); extended (Vendor/Driver Deferred Pricing chunk) to ALSO
 * cover a vendor-scoped Custom Item inside a CATALOG group, priced by
 * either the Vendor or the Driver — see `recordedByRole`. The
 * DRIVER_REIMBURSEMENT_OWED financial event only ever applies to the
 * `'DRIVER'` case (the driver spent real cash); a `'VENDOR'` row never
 * creates one, since the Vendor never advances any money.
 *
 * Immutable by construction, not just convention: there is no update
 * method anywhere in `AdHocPurchaseRecordService`, and a unique index
 * on `order_item_id` (see the migration) makes a second record for
 * the same item a hard DB-level rejection, not just an API-level
 * one — "driver cannot simply overwrite/edit it" is enforced at the
 * lowest level available, matching how this project has enforced
 * other "must not happen twice" rules (e.g. one ACTIVE cart per
 * customer). No correction/edit workflow exists — explicitly out of
 * scope for this step, left as a future extension point.
 *
 * `recordedAt` is deliberately just `BaseEntity.createdAt` — there is
 * no separate column for it, since the row is only ever written once
 * and never updated; a dedicated `recordedAt` would just duplicate
 * `createdAt`'s meaning.
 */
@Entity({ name: 'ad_hoc_purchase_records' })
export class AdHocPurchaseRecord extends BaseEntity {
  @ManyToOne(() => OrderItem)
  @JoinColumn({ name: 'order_item_id' })
  orderItem: OrderItem;

  @Index({ unique: true })
  @Column({ name: 'order_item_id' })
  orderItemId: string;

  @Column({ name: 'amount_minor', type: 'bigint' })
  amountMinor: number;

  @ManyToOne(() => Driver, { nullable: true })
  @JoinColumn({ name: 'recorded_by_driver_id' })
  recordedByDriver?: Driver | null;

  /** Nullable — a Vendor-priced record has no driver at all. See this entity's own top comment. */
  @Column({ type: 'uuid', name: 'recorded_by_driver_id', nullable: true })
  recordedByDriverId?: string | null;

  /**
   * Vendor/Driver Deferred Pricing for Custom CATALOG Items.
   * Discriminates the two recording paths — CONFIRMED never inferred
   * from `recordedByDriverId` being null/non-null alone, since that
   * would be an implicit, fragile rule; this column states it
   * explicitly. Every existing (pre-this-chunk) row was backfilled to
   * `'DRIVER'` by the migration.
   */
  @Column({ name: 'recorded_by_role', type: 'varchar', length: 10 })
  recordedByRole: 'DRIVER' | 'VENDOR';

  /** VENDOR rows only — the authorized Vendor Staff user's id. Null for a DRIVER row. */
  @Column({ name: 'recorded_by_user_id', type: 'uuid', nullable: true })
  recordedByUserId?: string | null;
}
