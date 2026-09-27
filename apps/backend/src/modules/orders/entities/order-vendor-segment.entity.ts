import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { Order } from './order.entity';
import { VendorBranch } from '../../vendors/entities/vendor-branch.entity';
import { CartGroupType } from '../../cart/cart-group-type.enum';
import { AdHocServiceType } from '../../cart/ad-hoc-service-type.enum';
import { OrderVendorSegmentStatus } from '../order-vendor-segment-status.enum';
import { OrderItem } from './order-item.entity';

/**
 * One vendor's slice of an order — mirrors CartVendorGroup, but this
 * is a schema-only addition in Phase 3 Step 3: nothing yet creates a
 * real Order/OrderVendorSegment row (order creation is Step 4, still
 * not built). `Order.status`/`OrderStateMachineService` are
 * deliberately UNTOUCHED this step — see the Step 3 report for why
 * reconciling order-level vs. segment-level status is left to Step 4.
 *
 * `subtotalMinor` is NULLABLE — null for an AD_HOC_SERVICE segment,
 * since no pricing formula exists for ad-hoc items yet (see
 * HatlyServicePricingConfig, Phase 2 — still just a placeholder). A
 * CATALOG segment's subtotal is never null.
 *
 * `adHocPlaceNameSnapshot`/`vendorNoteSnapshot` are named "Snapshot"
 * deliberately, unlike CartVendorGroup's `adHocPlaceName`/`vendorNote`
 * — per the approved requirement that order-time data must be frozen,
 * never re-read from the (mutable, post-order) Cart. Nothing writes
 * these yet; the naming itself documents the intended contract for
 * whoever builds Step 4's order-creation flow.
 */
@Entity({ name: 'order_vendor_segments' })
export class OrderVendorSegment extends BaseEntity {
  @ManyToOne(() => Order, (order) => order.segments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Index()
  @Column({ name: 'order_id' })
  orderId: string;

  @Column({ name: 'group_type', type: 'varchar', length: 20 })
  groupType: CartGroupType;

  @ManyToOne(() => VendorBranch, { nullable: true })
  @JoinColumn({ name: 'vendor_branch_id' })
  vendorBranch?: VendorBranch | null;

  @Column({ type: 'uuid', name: 'vendor_branch_id', nullable: true })
  vendorBranchId?: string | null;

  @Column({ name: 'ad_hoc_place_name_snapshot', type: 'varchar', nullable: true })
  adHocPlaceNameSnapshot?: string | null;

  @Column({ name: 'ad_hoc_service_type_snapshot', type: 'varchar', length: 20, nullable: true })
  adHocServiceTypeSnapshot?: AdHocServiceType | null;

  /**
   * Frozen copy of whichever coordinate was ACTUALLY used at order
   * creation — the customer's own override if they supplied one, or
   * the BusinessConfig default otherwise. Which one it was is not
   * separately recorded here (both resolve to the same "this is the
   * real pickup point used for this order" fact); if that distinction
   * ever matters for support/audit, it's derivable by comparing this
   * snapshot against CartVendorGroup's original customer-supplied
   * value while the cart still existed — not preserved indefinitely,
   * same as every other snapshot in this codebase.
   */
  @Column({ name: 'ad_hoc_pickup_latitude_snapshot', type: 'double precision', nullable: true })
  adHocPickupLatitudeSnapshot?: number | null;

  @Column({ name: 'ad_hoc_pickup_longitude_snapshot', type: 'double precision', nullable: true })
  adHocPickupLongitudeSnapshot?: number | null;

  @Column({ name: 'ad_hoc_destination_latitude_snapshot', type: 'double precision', nullable: true })
  adHocDestinationLatitudeSnapshot?: number | null;

  @Column({ name: 'ad_hoc_destination_longitude_snapshot', type: 'double precision', nullable: true })
  adHocDestinationLongitudeSnapshot?: number | null;

  @Column({ name: 'vendor_note_snapshot', type: 'varchar', nullable: true })
  vendorNoteSnapshot?: string | null;

  @Index()
  @Column({ type: 'varchar', length: 20, default: OrderVendorSegmentStatus.PENDING })
  status: OrderVendorSegmentStatus;

  @Column({ name: 'subtotal_minor', type: 'bigint', nullable: true })
  subtotalMinor?: number | null;

  /**
   * PHASE 3 STEP 4 addition — schema/dependency only, per the approved
   * scope. Nothing populates this yet (the vendor-side "confirm +
   * estimate prep time" workflow doesn't exist), and nothing reads it
   * yet (Dispatch doesn't exist). Reserved for the future Dispatch
   * engine's lead-time eligibility window (see BusinessConfigKey's
   * dispatch lead-time entry) — explicitly NOT implemented here.
   */
  @Column({ name: 'expected_ready_at', type: 'timestamptz', nullable: true })
  expectedReadyAt?: Date | null;

  @OneToMany(() => OrderItem, (item) => item.orderVendorSegment, { cascade: true })
  items: OrderItem[];

  /**
   * Offers - Final System. SUBTOTAL_DISCOUNT applies to a whole
   * segment, never a single item (CONFIRMED: "do not mix discounted
   * quantity logic with eligible subtotal logic") - these five columns
   * are this segment's equivalent of OrderItem's appliedOfferId/
   * offerDiscount* columns. `appliedOfferId` deliberately has NO FK
   * constraint, mirroring that same convention exactly - the order
   * must remain fully readable after the Offer is later disabled/
   * deleted/changed. OfferConsumption (mechanismSnapshot=
   * SUBTOTAL_DISCOUNT, keyed by orderVendorSegmentId) remains the
   * historical SOURCE of truth; these are a read-optimization cache
   * of the same values, same relationship as every other *Snapshot
   * cache in this codebase.
   */
  @Column({ name: 'applied_offer_id', type: 'uuid', nullable: true })
  appliedOfferId?: string | null;

  @Column({ name: 'offer_discount_type_snapshot', type: 'varchar', length: 10, nullable: true })
  offerDiscountTypeSnapshot?: 'PERCENTAGE' | 'FIXED' | null;

  @Column({ name: 'offer_discount_value_snapshot', type: 'int', nullable: true })
  offerDiscountValueSnapshot?: number | null;

  @Column({ name: 'offer_eligible_subtotal_minor_snapshot', type: 'bigint', nullable: true })
  offerEligibleSubtotalMinorSnapshot?: number | null;

  @Column({ name: 'offer_discount_amount_minor', type: 'bigint', nullable: true })
  offerDiscountAmountMinor?: number | null;

  /** The coupon code that produced this segment's discount, when it came from a coupon rather than an automatic offer. */
  @Column({ name: 'coupon_code_snapshot', type: 'varchar', length: 50, nullable: true })
  couponCodeSnapshot?: string | null;

  /** Frozen display information, so order history never depends on the current vendor/branch record. */
  @Column({ name: 'vendor_name_snapshot', type: 'varchar', length: 150, nullable: true })
  vendorNameSnapshot?: string | null;

  @Column({ name: 'branch_name_snapshot', type: 'varchar', length: 150, nullable: true })
  branchNameSnapshot?: string | null;

  @Column({ name: 'branch_address_snapshot', type: 'varchar', length: 255, nullable: true })
  branchAddressSnapshot?: string | null;

  /** The branch's preparation time when the order was placed (null = the branch had none configured). Operational ETA only. */
  @Column({ name: 'preparation_estimate_minutes', type: 'int', nullable: true })
  preparationEstimateMinutes?: number | null;
}
