import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { Cart } from './cart.entity';
import { VendorBranch } from '../../vendors/entities/vendor-branch.entity';
import { CartGroupType } from '../cart-group-type.enum';
import { AdHocServiceType } from '../ad-hoc-service-type.enum';
import { CartItem } from './cart-item.entity';

/**
 * One vendor's slice of a cart — up to 3 per cart (enforced in
 * CartService, not here; a DB CHECK counting sibling rows would need
 * a trigger, and the approved plan puts this check at the service
 * layer, matching how the old single-branch conflict check worked).
 *
 * `vendorBranchId` is nullable ONLY for `AD_HOC_SERVICE` groups
 * (unregistered "Hatly Service" places) — a `CATALOG` group always
 * has one. `vendorNote` is the ONE vendor-level free-text field per
 * group (independent from `Cart.orderNote` and from each
 * `CartItem.notes` — three separate, independent notes, per the
 * approved requirements).
 */
@Entity({ name: 'cart_vendor_groups' })
export class CartVendorGroup extends BaseEntity {
  @ManyToOne(() => Cart, (cart) => cart.groups, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cart_id' })
  cart: Cart;

  @Index()
  @Column({ name: 'cart_id' })
  cartId: string;

  @Column({ name: 'group_type', type: 'varchar', length: 20 })
  groupType: CartGroupType;

  @ManyToOne(() => VendorBranch, { nullable: true })
  @JoinColumn({ name: 'vendor_branch_id' })
  vendorBranch?: VendorBranch | null;

  @Column({ type: 'uuid', name: 'vendor_branch_id', nullable: true })
  vendorBranchId?: string | null;

  /** Customer-entered place name/description — AD_HOC_SERVICE only. */
  @Column({ name: 'ad_hoc_place_name', type: 'varchar', nullable: true })
  adHocPlaceName?: string | null;

  /**
   * AD_HOC_SERVICE only — which of the two Hatly Service flows this
   * group represents. Determines which default-location BusinessConfig
   * key applies when the customer hasn't supplied their own
   * coordinate — see ad-hoc-service-type.enum.ts.
   */
  @Column({ name: 'ad_hoc_service_type', type: 'varchar', length: 20, nullable: true })
  adHocServiceType?: AdHocServiceType | null;

  /**
   * BUY_FROM_PLACE only — set only if the customer explicitly
   * supplied/overrode a pickup location; null means "use the
   * configured default pickup location" (resolved at order-creation
   * time, never guessed here).
   */
  @Column({ name: 'ad_hoc_pickup_latitude', type: 'double precision', nullable: true })
  adHocPickupLatitude?: number | null;

  @Column({ name: 'ad_hoc_pickup_longitude', type: 'double precision', nullable: true })
  adHocPickupLongitude?: number | null;

  /**
   * DELIVER_TO_PLACE only — set only if the customer explicitly
   * supplied a destination; null means "use the configured default
   * destination location." Not used for BUY_FROM_PLACE, whose
   * "destination" is simply the customer's own delivery address,
   * already captured normally at checkout.
   */
  @Column({ name: 'ad_hoc_destination_latitude', type: 'double precision', nullable: true })
  adHocDestinationLatitude?: number | null;

  @Column({ name: 'ad_hoc_destination_longitude', type: 'double precision', nullable: true })
  adHocDestinationLongitude?: number | null;

  @Column({ name: 'vendor_note', type: 'varchar', nullable: true })
  vendorNote?: string | null;

  @OneToMany(() => CartItem, (item) => item.cartVendorGroup, { cascade: true })
  items: CartItem[];
}
