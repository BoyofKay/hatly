import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { User } from '../../users/entities/user.entity';
import { OrderItem } from '../../orders/entities/order-item.entity';
import { VendorBranch } from '../../vendors/entities/vendor-branch.entity';

/**
 * CONFIRMED business decision (Ratings): a Product rating references
 * the actual `OrderItem` the customer purchased/received, never an
 * arbitrary catalog Product. One row per (customer, orderItem) —
 * unique index in the migration. Immutable by construction — no
 * update/delete method exists, same discipline as `VendorRating`.
 *
 * `productId` deliberately has NO REFERENCES constraint — mirrors
 * `OrderItem.productId`'s own existing convention exactly (see that
 * column's own comment): "a later catalog change never rewrites order
 * history." This rating must remain historically understandable even
 * after the live Product is soft-deleted or its name/price/category
 * changes — it never depends on a live join to `products` to remain
 * valid. `vendorBranchId` is a denormalized snapshot (from the
 * OrderItem's segment, at rating time) for the same efficient-query
 * reason as `VendorRating.vendorBranchId` — never a second source of
 * truth for the item's real vendor.
 */
@Entity({ name: 'product_ratings' })
export class ProductRating extends BaseEntity {
  @ManyToOne(() => User)
  @JoinColumn({ name: 'customer_id' })
  customer: User;

  @Column({ name: 'customer_id' })
  customerId: string;

  @ManyToOne(() => OrderItem)
  @JoinColumn({ name: 'order_item_id' })
  orderItem: OrderItem;

  @Index({ unique: true })
  @Column({ name: 'order_item_id' })
  orderItemId: string;

  /** Snapshot of OrderItem.productId at rating time — no FK, see this file's own comment. */
  @Column({ type: 'uuid', name: 'product_id', nullable: true })
  productId?: string | null;

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
