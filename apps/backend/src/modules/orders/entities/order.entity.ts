import { AddressMode } from '../../addresses/address-mode';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { OrderStatus } from '../order-status.enum';
import { User } from '../../users/entities/user.entity';
import { OrderVendorSegment } from './order-vendor-segment.entity';
import { FulfillmentType } from '../../cart/fulfillment-type.enum';
import { OrderPaymentMethod } from '../order-payment-method';
import { ElectronicPaymentMethod } from '../../payments/electronic-payment-method.enum';

/**
 * PHASE 3 STEP 3 CHANGE: `vendorBranchId` is REMOVED (was singular,
 * NOT NULL) — replaced by `segments` (1–3 `OrderVendorSegment` rows,
 * mirroring `Cart`/`CartVendorGroup`). Safe to change outright: no
 * code has ever created a real Order row (order creation is Step 4,
 * still not built), so there's no data to migrate.
 *
 * `status`/`OrderStatus` are UNCHANGED — deliberately not touched
 * this step. See order-vendor-segment.entity.ts's own doc comment and
 * the Step 3 report for why reconciling order-level vs. segment-level
 * status is Step 4's job, not this schema step's.
 *
 * `fulfillmentType`/`orderNote` mirror the same new Cart fields.
 */
/**
 * The Delivery Zone exactly as it was when the order was placed (PD-009). Frozen: renaming / re-pricing / deactivating the zone
 * later never changes it. The fee that zone contributed is frozen separately in the delivery breakdown.
 */
export interface DeliveryZoneSnapshot {
  id: string;
  name: string;
  nameAr: string;
  city: string;
  cityAr: string;
  governorate: string;
  governorateAr: string;
}

/**
 * The immutable delivery address of an order: the map pin (when there is one) is authoritative; the structured details are
 * what the customer typed; `formattedAddress` is only the map provider's suggestion. PD-009: the pin is optional — an address
 * without one is located by its Delivery Zone (`deliveryZone`, frozen). Never edited after the order exists.
 */
export interface DeliveryAddressSnapshot {
  /** How the address was identified (GPS or MANUAL); absent on legacy addresses and on orders placed before the two methods. */
  mode?: AddressMode;
  label?: string;
  line1: string;
  latitude?: number;
  longitude?: number;
  deliveryZoneId?: string;
  deliveryZone?: DeliveryZoneSnapshot;
  instructions?: string;
  governorate?: string;
  city?: string;
  street?: string;
  buildingNumber?: string;
  floor?: string;
  apartment?: string;
  landmark?: string;
  formattedAddress?: string;
}

@Entity({ name: 'orders' })
export class Order extends BaseEntity {
  @ManyToOne(() => User)
  @JoinColumn({ name: 'customer_id' })
  customer: User;

  @Column({ name: 'customer_id' })
  customerId: string;

  /**
   * The customer-facing, immutable order reference (`HT-100234`) — never the UUID. Generated once, from `order_number_seq`
   * (see the `OrderNumber` migration and `OrderCreationService.nextOrderNumber`), and never reassigned or reused.
   */
  @Index({ unique: true })
  @Column({ name: 'order_number', type: 'varchar', length: 20 })
  orderNumber: string;

  @Index()
  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.PENDING })
  status: OrderStatus;

  @Column({ name: 'fulfillment_type', type: 'varchar', length: 20, default: FulfillmentType.DELIVERY })
  fulfillmentType: FulfillmentType;

  @Column({ name: 'order_note', type: 'varchar', nullable: true })
  orderNote?: string | null;

  // Deliberately no driverId column here: which driver is assigned is
  // Delivery's job (see delivery.entity.ts). Duplicating it on Order
  // as well would give the same fact two places to go stale
  // independently — e.g. a reassignment updating Delivery.driverId but
  // an Order.driverId write failing/racing separately. Callers that
  // need "which driver is on this order" join through Delivery.

  @Column({ name: 'delivery_address_snapshot', type: 'jsonb', nullable: true })
  deliveryAddressSnapshot: DeliveryAddressSnapshot | null;

  // Monetary fields in minor units (piasters) — see common/utils/money.ts.
  //
  // PHASE 3 STEP 4 CHANGE: `deliveryFeeMinor`/`totalMinor` became
  // NULLABLE (were NOT NULL). Two independent reasons a total can be
  // unknown at order-creation time, applying the same "never fake a
  // number" principle consistently to both:
  //   1. No delivery-fee formula/MapProvider distance calculation
  //      exists yet (both still stubs from Phase 1) — so
  //      `deliveryFeeMinor` is null on every order created right now,
  //      catalog-only or not, until a future fee-calculation phase
  //      resolves it. This is a real, surfaced consequence, not
  //      hidden behind a fabricated 0.
  //   2. An AD_HOC_SERVICE segment's final price is unknown until a
  //      driver records the actual purchase amount (see
  //      AdHocPurchaseRecord) — `hasPendingAdHocPricing` makes this
  //      explicit rather than relying on inferring it from nulls
  //      elsewhere.
  // `subtotalMinor` stays NOT NULL — always computable at creation
  // time from CATALOG segments alone (0 if there are none), same
  // "ad-hoc contributes nothing numeric" rule as CartView.
  @Column({ name: 'subtotal_minor', type: 'bigint' })
  subtotalMinor: number;

  @Column({ name: 'delivery_fee_minor', type: 'bigint', nullable: true })
  deliveryFeeMinor?: number | null;

  @Column({ name: 'discount_minor', type: 'bigint', default: 0 })
  discountMinor: number;

  @Column({ name: 'total_minor', type: 'bigint', nullable: true })
  totalMinor?: number | null;

  /**
   * True if any segment's final price is not yet known (i.e. the
   * order contains at least one AD_HOC_SERVICE segment — every such
   * segment is unpriced at creation, since no formula exists to price
   * one upfront). Explicit and queryable on its own, rather than
   * making a client infer "is this order fully priced" from which
   * columns happen to be null.
   */
  @Column({ name: 'has_pending_ad_hoc_pricing', type: 'boolean', default: false })
  hasPendingAdHocPricing: boolean;

  /**
   * PHASE 3 DELIVERY-FEE addition. Frozen copy of exactly how
   * `deliveryFeeMinor` was computed (vendor sequence, leg distances,
   * the BusinessConfig values used at that moment) — see
   * DeliveryFeeCalculationService's DeliveryFeeBreakdown for the exact
   * shape. Null for PICKUP orders (fee is a flat 0, nothing to break
   * down) and for AD_HOC_SERVICE orders (this formula never applies
   * to them at all). Exists so a later change to the pricing
   * parameters never retroactively changes what a historical order's
   * fee was actually based on — same principle as every other frozen
   * snapshot in this codebase.
   */
  @Column({ name: 'delivery_fee_breakdown_snapshot', type: 'jsonb', nullable: true })
  deliveryFeeBreakdownSnapshot?: unknown | null;

  /**
   * PHASE G addition (Weighted Products, decision 13): `PAY_AT_DELIVERY`
   * — the electronic-payment path for an order whose final amount
   * isn't known until actual weight is recorded. CONFIRMED: this is
   * NOT the prepaid MANUAL_TRANSFER flow (no PENDING -> CLAIMED ->
   * UNDER_REVIEW -> PAID state machine applies to it) and it does NOT
   * integrate a real payment gateway (none selected/approved yet) —
   * exactly like COD, no `Payment` row is created for it (see
   * OrderCreationService); the customer pays Hatly's configured
   * destination electronically while the driver is present, based on
   * the FINAL amount, once known. The exact collection-confirmation
   * mechanism remains an explicitly open item — see the Weighted
   * Products report.
   */
  @Column({ name: 'payment_method', type: 'varchar', length: 20, default: 'COD' })
  paymentMethod: OrderPaymentMethod;

  /** The electronic method the customer chose (INSTAPAY, VODAFONE_CASH, …) — set for MANUAL_TRANSFER and PAY_AT_DELIVERY, null otherwise. */
  @Column({ name: 'electronic_payment_method', type: 'varchar', length: 20, nullable: true })
  electronicPaymentMethod?: ElectronicPaymentMethod | null;

  /** Amount of the order paid from the Hatly wallet, decided by the server at creation and debited in the same transaction. */
  @Column({ name: 'wallet_amount_minor', type: 'bigint', default: 0 })
  walletAmountMinor: number;

  /** What remains to be paid through `paymentMethod` after the wallet (total − wallet); null while the total is unknown. */
  @Column({ name: 'amount_due_minor', type: 'bigint', nullable: true })
  amountDueMinor?: number | null;

  /** Frozen coupon applied at creation ({ code, offerId, offerName, vendorBranchId, segmentId, discountMinor }); null when none. */
  /** Hatly promotions (2026-11-27): the item-promotion part of discount_minor (Hatly-funded). */
  @Column({ name: 'promotion_discount_minor', type: 'bigint', default: 0, transformer: { to: (v: number) => v, from: (v: string | null) => (v == null ? 0 : Number(v)) } })
  promotionDiscountMinor: number;

  /** Delivery-fee promotion already taken off delivery_fee_minor (which is what the customer pays). */
  @Column({ name: 'delivery_fee_discount_minor', type: 'bigint', default: 0, transformer: { to: (v: number) => v, from: (v: string | null) => (v == null ? 0 : Number(v)) } })
  deliveryFeeDiscountMinor: number;

  /** Who pays that fee discount: HATLY (the driver still earns on the full fee) or DRIVER (he earns on the reduced fee). */
  @Column({ name: 'delivery_fee_discount_bearer', type: 'varchar', length: 8, nullable: true })
  deliveryFeeDiscountBearer: 'HATLY' | 'DRIVER' | null;

  @Column({ name: 'promotion_snapshot', type: 'jsonb', nullable: true })
  promotionSnapshot: Record<string, unknown> | null;

  /** When the order's attachments (request photos, voice notes, proof photo) were removed by the 90-day retention (owner 2026-11-28). */
  @Column({ name: 'attachments_purged_at', type: 'timestamptz', nullable: true })
  attachmentsPurgedAt?: Date | null;

  /** A note Operations writes for the driver (owner decision 2026-11-27) — shown in the driver app next to the customer's note. */
  @Column({ name: 'operations_note_for_driver', type: 'varchar', length: 1000, nullable: true })
  operationsNoteForDriver?: string | null;

  @Column({ name: 'coupon_snapshot', type: 'jsonb', nullable: true })
  couponSnapshot?: {
    code: string;
    offerId: string;
    offerName: string;
    vendorBranchId: string;
    orderVendorSegmentId: string | null;
    discountMinor: number;
  } | null;

  /** The delivery quote the customer confirmed, frozen with the order — later config changes never alter it. */
  @Column({ name: 'checkout_quote_snapshot', type: 'jsonb', nullable: true })
  checkoutQuoteSnapshot?: unknown | null;

  /** Total travel time of the frozen quote (vendor legs + last mile), seconds; null when the map provider gave no estimate. */
  @Column({ name: 'estimated_travel_seconds', type: 'int', nullable: true })
  estimatedTravelSeconds?: number | null;

  @Column({ name: 'cancellation_reason', type: 'varchar', nullable: true })
  cancellationReason?: string | null;

  @Column({ name: 'cancelled_by_role', type: 'varchar', nullable: true })
  cancelledByRole?: string | null;

  /** Failed Delivery Metadata. Why the delivery failed, as reported by the Driver/Admin who triggered the transition. Null until (and unless) FAILED_DELIVERY is reached. */
  @Column({ name: 'failure_reason', type: 'varchar', nullable: true })
  failureReason?: string | null;

  /** The actual transition-execution time, not a client-supplied value. Null until (and unless) FAILED_DELIVERY is reached. */
  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt?: Date | null;

  @OneToMany(() => OrderVendorSegment, (segment) => segment.order, { cascade: true })
  segments: OrderVendorSegment[];
}
