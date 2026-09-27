import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { User } from '../../users/entities/user.entity';
import { Vendor } from '../../vendors/entities/vendor.entity';

/**
 * CONFIRMED business decision (Favorites Chunk 1): Vendor-based only
 * — never Product, never VendorBranch, no favorite history. A
 * `Favorite` row represents a CURRENT relationship, not historical
 * activity — HARD DELETE on unfavorite (see FavoritesService), a
 * deliberate deviation from this project's usual soft-delete
 * convention (BaseEntity still provides `deletedAt` since every
 * entity extends it, but this entity's service layer never uses
 * TypeORM's `.softDelete()`/`.softRemove()` — only `.delete()` — so
 * `deletedAt` on this entity is inert or­phaned column inherited from
 * BaseEntity, not an active mechanism). Re-favoriting the same Vendor
 * after unfavorite works normally because the row is genuinely gone,
 * not soft-deleted.
 *
 * Uses the same relation + raw FK column double-declaration already
 * established by `VendorRating` (see vendor-rating.entity.ts) —
 * `customerId`/`vendorId` are the columns actually queried/indexed;
 * `customer`/`vendor` are the relation objects for when the entity
 * is loaded with joins.
 *
 * Deliberately does NOT add: isActive/availability snapshot (Vendor
 * status is read live, never denormalized here — see
 * FavoritesService.listForCustomer), branchId, productId, ranking
 * fields, or history fields — none of these are part of the V1
 * product decision.
 */
@Entity({ name: 'favorites' })
export class Favorite extends BaseEntity {
  @ManyToOne(() => User)
  @JoinColumn({ name: 'customer_id' })
  customer: User;

  @Column({ name: 'customer_id' })
  customerId: string;

  @ManyToOne(() => Vendor)
  @JoinColumn({ name: 'vendor_id' })
  vendor: Vendor;

  @Column({ name: 'vendor_id' })
  vendorId: string;
}
