import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { User } from '../../users/entities/user.entity';
import { CartVendorGroup } from './cart-vendor-group.entity';
import { FulfillmentType } from '../fulfillment-type.enum';

export enum CartStatus {
  ACTIVE = 'ACTIVE',
  ORDERED = 'ORDERED',
}

/**
 * One customer's active cart. Singular per customer — a partial
 * unique index on (customer_id) WHERE status='ACTIVE' (see the
 * migration) still enforces "a cart belongs to one customer" as a
 * hard DB constraint, unchanged from Phase 2D.
 *
 * PHASE 3 STEP 3 CHANGE: `vendorBranchId` is REMOVED. A cart's vendor
 * footprint is now the set of its `CartVendorGroup` rows (0–3 of
 * them, enforced in CartService) — see cart-vendor-group.entity.ts.
 * `fulfillmentType` and `orderNote` are new: PICKUP is only valid for
 * a single CATALOG group whose branch allows it (enforced in
 * CartService, not here); `orderNote` is the ONE cart-wide free-text
 * field, independent of each group's own `vendorNote` and each
 * item's own `notes`.
 */
@Entity({ name: 'carts' })
export class Cart extends BaseEntity {
  @ManyToOne(() => User)
  @JoinColumn({ name: 'customer_id' })
  customer: User;

  @Index()
  @Column({ name: 'customer_id' })
  customerId: string;

  @Column({ type: 'enum', enum: CartStatus, default: CartStatus.ACTIVE })
  status: CartStatus;

  @Column({ name: 'fulfillment_type', type: 'varchar', length: 20, default: FulfillmentType.DELIVERY })
  fulfillmentType: FulfillmentType;

  @Column({ name: 'order_note', type: 'varchar', nullable: true })
  orderNote?: string | null;

  @OneToMany(() => CartVendorGroup, (group) => group.cart, { cascade: true })
  groups: CartVendorGroup[];
}
