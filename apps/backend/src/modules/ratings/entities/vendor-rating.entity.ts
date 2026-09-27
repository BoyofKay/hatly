import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { User } from '../../users/entities/user.entity';
import { OrderVendorSegment } from '../../orders/entities/order-vendor-segment.entity';
import { VendorBranch } from '../../vendors/entities/vendor-branch.entity';

/**
 * CONFIRMED business decision (Ratings): a Vendor rating references
 * the specific `OrderVendorSegment`, never the bare `Order` — a
 * Multi-Vendor order's segments are rated completely independently
 * (Vendor A's rating never affects Vendor B/C). One row per
 * (customer, segment) — see the unique index on both columns in the
 * migration; that DB-level constraint, not application logic alone,
 * is what makes duplicate/re-rating impossible.
 *
 * Immutable by construction: no update/delete method exists anywhere
 * for this entity — that absence IS the "no edit, no re-rate, no
 * Admin correction" decision, matching this project's established
 * pattern for `AdHocPurchaseRecord`/`OrderItemWeightRecord`.
 *
 * `vendorBranchId` is a denormalized snapshot of
 * `OrderVendorSegment.vendorBranchId` at rating time — the actual
 * operational vendor identity this codebase already uses everywhere
 * else (commission, auto-accept), never the bare `Vendor`. Exists so
 * a future "average rating for Branch X" query never needs to join
 * back through the segment; it is never treated as a second source of
 * truth for which branch this segment belonged to (the segment itself
 * remains authoritative for that).
 */
@Entity({ name: 'vendor_ratings' })
export class VendorRating extends BaseEntity {
  @ManyToOne(() => User)
  @JoinColumn({ name: 'customer_id' })
  customer: User;

  @Column({ name: 'customer_id' })
  customerId: string;

  @ManyToOne(() => OrderVendorSegment)
  @JoinColumn({ name: 'order_vendor_segment_id' })
  orderVendorSegment: OrderVendorSegment;

  @Index({ unique: true })
  @Column({ name: 'order_vendor_segment_id' })
  orderVendorSegmentId: string;

  @ManyToOne(() => VendorBranch)
  @JoinColumn({ name: 'vendor_branch_id' })
  vendorBranch: VendorBranch;

  @Column({ name: 'vendor_branch_id' })
  vendorBranchId: string;

  /** 1–5, validated at the DTO layer (class-validator) before this row is ever created. */
  @Column({ type: 'smallint' })
  stars: number;

  @Column({ type: 'varchar', nullable: true })
  comment?: string | null;
}
