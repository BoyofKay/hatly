import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { OrderVendorSegment } from './order-vendor-segment.entity';
import { PricingUnit } from '../../products/pricing-unit.enum';

/**
 * PHASE 3 STEP 3 CHANGE: `orderId` -> `orderVendorSegmentId`. Still
 * snapshots at order-creation time — unchanged principle from Phase 1
 * (`productNameSnapshot`/`unitPriceMinor` frozen so a later catalog
 * change never rewrites order history). `productId`,
 * `productNameSnapshot`, and `unitPriceMinor` are now NULLABLE for an
 * AD_HOC_SERVICE item, which has none of them.
 *
 * `freeTextDescriptionSnapshot`/`imageUrlsSnapshot` are new, and named
 * "Snapshot" for the same reason as OrderVendorSegment's snapshot
 * fields — per the approved requirement that once an order exists,
 * its ad-hoc place name/request/images must be frozen copies, never a
 * live read of the (mutable, and possibly since-cleared) Cart/CartItem
 * they came from. Nothing writes these yet — no order creation exists
 * yet (Step 4) — this is the schema contract for when it does.
 */
@Entity({ name: 'order_items' })
export class OrderItem extends BaseEntity {
  @ManyToOne(() => OrderVendorSegment, (segment) => segment.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_vendor_segment_id' })
  orderVendorSegment: OrderVendorSegment;

  @Column({ name: 'order_vendor_segment_id' })
  orderVendorSegmentId: string;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null;

  @Column({ name: 'product_name_snapshot', type: 'varchar', length: 200, nullable: true })
  productNameSnapshot?: string | null;

  @Column({ name: 'product_name_ar_snapshot', type: 'varchar', length: 200, nullable: true })
  productNameArSnapshot?: string | null;

  /**
   * PHASE G addition (Customer Order History & Order Details, decision
   * B). Frozen copy of Product.imageUrl at order-creation time — same
   * "never a live read of a mutable catalog row" principle as
   * `productNameSnapshot`. Null for an AD_HOC_SERVICE item and for any
   * catalog item whose Product had no image set at order time.
   */
  @Column({ name: 'product_image_url_snapshot', type: 'varchar', nullable: true })
  productImageUrlSnapshot?: string | null;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ name: 'unit_price_minor', type: 'bigint', nullable: true })
  unitPriceMinor?: number | null;

  @Column({ name: 'options_snapshot', type: 'jsonb', default: [] })
  optionsSnapshot: Array<{ name: string; valueName: string; priceDeltaMinor: number }>;

  @Column({ type: 'varchar', nullable: true })
  notes?: string | null;

  /** AD_HOC_SERVICE items only — frozen copy of the customer's free-text request. */
  @Column({ name: 'free_text_description_snapshot', type: 'varchar', nullable: true })
  freeTextDescriptionSnapshot?: string | null;

  /** AD_HOC_SERVICE items only — frozen copy of the Hatly-upload-produced image URLs. */
  @Column({ name: 'image_urls_snapshot', type: 'jsonb', nullable: true })
  imageUrlsSnapshot?: string[] | null;

  /**
   * PHASE 3 STEP 4 addition — a denormalized CACHE of the driver's
   * recorded actual purchase amount for an AD_HOC_SERVICE item, for
   * fast reads (e.g. showing the customer their order total without
   * joining AdHocPurchaseRecord every time). `AdHocPurchaseRecord` —
   * see its own entity — is the historical source of truth; this
   * column is never written except by copying a value that already
   * exists there (see AdHocPurchaseRecordService.record()). Null
   * until a driver records a purchase for this item.
   */
  @Column({ name: 'actual_amount_minor', type: 'bigint', nullable: true })
  actualAmountMinor?: number | null;

  /**
   * PHASE G addition (Weighted Products). Frozen copy of the
   * Product's pricingUnit at order-creation time — same "never a live
   * read of a mutable catalog row" principle as
   * `productNameSnapshot`/`unitPriceMinor`. Null for an
   * AD_HOC_SERVICE item (no Product at all). Drives every
   * weight-specific rule below (which is a WEIGHT item, which isn't).
   */
  @Column({ name: 'pricing_unit_snapshot', type: 'varchar', length: 10, nullable: true })
  pricingUnitSnapshot?: PricingUnit | null;

  /**
   * WEIGHT items only — the customer's requested amount at order
   * creation, frozen. CONFIRMED: never overloaded onto `quantity`.
   * Integer grams, never floating-point kilograms. Preserved even
   * after `actualWeightGrams` is recorded — "do not destroy the
   * requested value when actual weight is entered."
   */
  @Column({ name: 'requested_weight_grams', type: 'int', nullable: true })
  requestedWeightGrams?: number | null;

  /**
   * WEIGHT items only. The historical source of truth for this value
   * is `OrderItemWeightRecord` (first authorized Vendor/Driver to
   * record wins, permanently — see that entity's own comment); this
   * column is only ever a read-optimization CACHE of that value,
   * exactly mirroring `actualAmountMinor`'s own relationship to
   * `AdHocPurchaseRecord`. CONFIRMED: ADMIN has no role in weight or
   * weighted-price entry/correction at all — there is no correction
   * path anywhere, so once set, this cache never changes again.
   */
  @Column({ name: 'actual_weight_grams', type: 'int', nullable: true })
  actualWeightGrams?: number | null;

  /**
   * WEIGHT items only. Frozen at order creation:
   * round(unitPriceMinor * requestedWeightGrams / 1000) — the
   * estimated amount the customer saw at checkout. Never mutated after
   * creation; used only to compute the delta applied to
   * segment/order totals once `finalAmountMinor` becomes known (see
   * OrderItemWeightRecordService).
   */
  @Column({ name: 'estimated_amount_minor', type: 'bigint', nullable: true })
  estimatedAmountMinor?: number | null;

  /**
   * WEIGHT items only. round(unitPriceMinor * actualWeightGrams /
   * 1000) — set together with `actualWeightGrams`, by the same
   * record/correction. This is the FINAL amount used for the
   * customer's actual payable/collected amount and for any financial
   * event that depends on this item's price (see
   * OrderFinancialEventsService, which reads the segment's already-
   * adjusted `subtotalMinor`, never this column directly).
   */
  @Column({ name: 'final_amount_minor', type: 'bigint', nullable: true })
  finalAmountMinor?: number | null;

  /**
   * PHASE G addition (Offers & Promotions). CONFIRMED: WEIGHT items are
   * never eligible — these five columns are only ever populated for a
   * PIECE catalog item. `appliedOfferId` deliberately has NO FK
   * constraint — mirrors `productId`'s own convention exactly: the
   * order must remain fully readable after the Offer is later
   * disabled/deleted/changed, never re-deriving the discount from a
   * live Offer row. The historical source of truth for a redemption is
   * `OfferConsumption` (see that entity's own comment); these columns
   * are a read-optimization cache of the SAME winning offer already
   * recorded there — never a second, competing decision.
   */
  @Column({ name: 'applied_offer_id', type: 'uuid', nullable: true })
  appliedOfferId?: string | null;

  /**
   * How many of this item's `quantity` units actually received the
   * Offer — CONFIRMED "excess falls back to normal price," so this can
   * be less than `quantity` (e.g. 3 discounted out of 5 ordered).
   */
  @Column({ name: 'offer_discounted_quantity', type: 'int', nullable: true })
  offerDiscountedQuantity?: number | null;

  /** Snapshot of the winning Offer's discountType at redemption — never re-read from the live Offer row. */
  @Column({ name: 'offer_discount_type_snapshot', type: 'varchar', length: 10, nullable: true })
  offerDiscountTypeSnapshot?: 'PERCENTAGE' | 'FIXED' | null;

  /** Snapshot of the winning Offer's discountValue (basis points or minor units, per discountTypeSnapshot) at redemption. */
  @Column({ name: 'offer_discount_value_snapshot', type: 'int', nullable: true })
  offerDiscountValueSnapshot?: number | null;

  /**
   * Total discount applied to this item = offerDiscountedQuantity x
   * per-unit discount. CONFIRMED (Offer funding — Hatly-funded):
   * `unitPriceMinor` above is NEVER reduced by this — it remains the
   * full nominal/original price, which is also the Vendor commission
   * basis (see OrderFinancialEventsService, genuinely unchanged by
   * this feature). The customer's actual payable amount for this item
   * is `unitPriceMinor * quantity - offerDiscountAmountMinor`,
   * computed wherever customer-facing totals are built (never stored
   * as a separate, competing "payable amount" column).
   */
  @Column({ name: 'offer_discount_amount_minor', type: 'bigint', nullable: true })
  offerDiscountAmountMinor?: number | null;

  /**
   * Offers - Final System. FLASH_SALE's real historical "special
   * price" cache - CONFIRMED needed: offerDiscountTypeSnapshot/
   * offerDiscountValueSnapshot above are now SUBTOTAL_DISCOUNT-only
   * (Offer.discountType/discountValue are null for FLASH_SALE offers
   * after the mechanism split), so without this column a FLASH_SALE
   * item's cache would silently lose its special-price information
   * even though a real discount applied. OfferConsumption.
   * specialPriceMinorSnapshot remains the historical SOURCE of truth;
   * this is only ever a copy of that same value, same relationship as
   * actualAmountMinor -> AdHocPurchaseRecord.
   */
  @Column({ name: 'offer_special_price_minor_snapshot', type: 'bigint', nullable: true })
  offerSpecialPriceMinorSnapshot?: number | null;

  /** Offers - Final System. Which mechanism applied to this item, if any - null when appliedOfferId is null. */
  @Column({ name: 'offer_mechanism_snapshot', type: 'varchar', length: 20, nullable: true })
  offerMechanismSnapshot?: string | null;
}
