import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { Offer } from './offer.entity';
import { User } from '../../users/entities/user.entity';
import { Order } from '../../orders/entities/order.entity';
import { OrderItem } from '../../orders/entities/order-item.entity';
import { OrderVendorSegment } from '../../orders/entities/order-vendor-segment.entity';
import { DiscountType } from '../discount-type.enum';
import { OfferMechanism } from '../offer-mechanism.enum';

/**
 * The append-only source of truth for Offer redemption — mirrors
 * `OrderItemWeightRecord`/`FinancialEvent`'s exact discipline. No
 * update/delete method exists anywhere for this entity, deliberately
 * — that absence IS the "consumption does not return after
 * cancellation" decision (E/AA), not an oversight. "Units remaining,"
 * "customer lifetime usage," and "total consumed" are always DERIVED
 * from querying these rows (or the Offer's own recomputable cache —
 * see Offer's own comment) — never a separate mutable balance.
 *
 * Offers — Final System (mechanism split). `mechanismSnapshot`
 * discriminates which of the two mutually-exclusive consumption units
 * this row uses — CONFIRMED, exactly one of `orderItemId` /
 * `orderVendorSegmentId` is ever populated (DB CHECK constraint, see
 * the migration):
 *
 * FLASH_SALE: `orderItemId` — unchanged from before this split. Unique
 * ALONE (see the migration's own comment for why `offerId` isn't part
 * of the key): "only ONE Offer may apply to a given OrderItem" is the
 * DB-level idempotency guarantee against a retried order-creation
 * attempt.
 *
 * SUBTOTAL_DISCOUNT: `orderVendorSegmentId` — the natural consumption
 * unit for a whole-segment discount (one Offer applies to an entire
 * VendorBranch segment's eligible subtotal, never to one item alone).
 * Same "at most once" guarantee, scoped to the segment instead.
 *
 * `discountTypeSnapshot`/`discountValueSnapshot`/
 * `originalUnitPriceMinorSnapshot` (SUBTOTAL_DISCOUNT... wait, see
 * below) exist so this row remains fully understandable even after
 * the live Offer changes, is deactivated, or is soft-deleted — same
 * "never depend on the current [thing] to reconstruct an old record"
 * principle as `OrderItem.productNameSnapshot`.
 *
 * Correction to the above: `discountTypeSnapshot`/`discountValueSnapshot`
 * are populated for SUBTOTAL_DISCOUNT rows (the mechanism that
 * actually uses a discount type/value); `originalUnitPriceMinorSnapshot`
 * remains FLASH_SALE-specific (a single item's frozen nominal price);
 * `specialPriceMinorSnapshot` and `eligibleSubtotalMinorSnapshot` are
 * the FLASH_SALE-specific and SUBTOTAL_DISCOUNT-specific additions
 * respectively — all nullable, populated according to
 * `mechanismSnapshot` only.
 */
@Entity({ name: 'offer_consumptions' })
export class OfferConsumption extends BaseEntity {
  @ManyToOne(() => Offer)
  @JoinColumn({ name: 'offer_id' })
  offer: Offer;

  @Index()
  @Column({ name: 'offer_id' })
  offerId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'customer_id' })
  customer: User;

  @Index()
  @Column({ name: 'customer_id' })
  customerId: string;

  @ManyToOne(() => Order)
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Index()
  @Column({ name: 'order_id' })
  orderId: string;

  @Index()
  @Column({ name: 'mechanism_snapshot', type: 'varchar', length: 20 })
  mechanismSnapshot: OfferMechanism;

  /** FLASH_SALE only — see this entity's own top comment. */
  @ManyToOne(() => OrderItem, { nullable: true })
  @JoinColumn({ name: 'order_item_id' })
  orderItem?: OrderItem | null;

  @Column({ type: 'uuid', name: 'order_item_id', nullable: true })
  orderItemId?: string | null;

  /** SUBTOTAL_DISCOUNT only — see this entity's own top comment. */
  @ManyToOne(() => OrderVendorSegment, { nullable: true })
  @JoinColumn({ name: 'order_vendor_segment_id' })
  orderVendorSegment?: OrderVendorSegment | null;

  @Column({ type: 'uuid', name: 'order_vendor_segment_id', nullable: true })
  orderVendorSegmentId?: string | null;

  /** How many of the item's units this redemption covers (FLASH_SALE) — see OrderItem.offerDiscountedQuantity's own comment. Physical quantity, e.g. grams/pieces depending on the product. */
  @Column({ name: 'quantity_consumed', type: 'int' })
  quantityConsumed: number;

  /** Total discount this redemption produced (Hatly-funded — see Offer's own comment; never reduces Vendor commission basis). Always populated, both mechanisms. */
  @Column({ name: 'discount_applied_minor', type: 'bigint' })
  discountAppliedMinor: number;

  /** SUBTOTAL_DISCOUNT only — null for FLASH_SALE. */
  @Column({ name: 'discount_type_snapshot', type: 'varchar', length: 10, nullable: true })
  discountTypeSnapshot?: DiscountType | null;

  /** SUBTOTAL_DISCOUNT only — null for FLASH_SALE. */
  @Column({ name: 'discount_value_snapshot', type: 'int', nullable: true })
  discountValueSnapshot?: number | null;

  /** FLASH_SALE only — the item's frozen nominal unitPriceMinor at the moment of redemption, the basis the special price was compared against. Null for SUBTOTAL_DISCOUNT. */
  @Column({ name: 'original_unit_price_minor_snapshot', type: 'bigint', nullable: true })
  originalUnitPriceMinorSnapshot?: number | null;

  /** FLASH_SALE only. Frozen copy of the Offer's specialPriceMinor at redemption time — CONFIRMED "historical records must retain the effective promotional price." Null for SUBTOTAL_DISCOUNT. */
  @Column({ name: 'special_price_minor_snapshot', type: 'bigint', nullable: true })
  specialPriceMinorSnapshot?: number | null;

  /** SUBTOTAL_DISCOUNT only. Frozen copy of the eligible subtotal the discount was computed against. Null for FLASH_SALE. */
  @Column({ name: 'eligible_subtotal_minor_snapshot', type: 'bigint', nullable: true })
  eligibleSubtotalMinorSnapshot?: number | null;

  /**
   * Offers Final System — Flash Sale cancellation reversal (FINAL
   * approved rule). This row is NEVER deleted or overwritten when its
   * Order is cancelled — CONFIRMED, the historical/audit record
   * (quantityConsumed, discountAppliedMinor, all snapshots above)
   * stays exactly as it was. `isReversed=true` is the ONLY change: it
   * means this row's quantity/discount no longer counts toward the
   * customer's cumulative limit or the Offer's global allocation —
   * every query that sums consumption for those two checks must
   * filter `is_reversed = false` (see
   * OfferConsumptionService.sumCustomerConsumedQuantity and
   * findMatchingActiveOffers's callers of Offer.consumedUnitsCount,
   * which itself is decremented at reversal time — see
   * reverseFlashSaleConsumptionForOrder's own comment). PD-014: SUBTOTAL_DISCOUNT rows (automatic
   * offers and coupons) are reversed the same way when their segment is rejected or their order is cancelled — see
   * reverseSubtotalDiscountConsumptionForOrder; the per-customer limit counts only rows with `is_reversed = false`.
   */
  @Column({ name: 'is_reversed', type: 'boolean', default: false })
  isReversed: boolean;

  @Column({ name: 'reversed_at', type: 'timestamptz', nullable: true })
  reversedAt?: Date | null;
}
