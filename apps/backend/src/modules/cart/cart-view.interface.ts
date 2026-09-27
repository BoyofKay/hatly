import { CartGroupType } from './cart-group-type.enum';
import { FulfillmentType } from './fulfillment-type.enum';
import { PricingUnit } from '../products/pricing-unit.enum';

/**
 * Shapes the cart endpoints actually return. Still not the raw
 * TypeORM entities — every catalog price here is server-computed
 * fresh on every request, unchanged principle from Phase 2D.
 *
 * PHASE 3 STEP 3 CHANGE: restructured around groups. A CATALOG item's
 * `unitPriceMinor`/`lineTotalMinor` are always numbers; an
 * AD_HOC_SERVICE item's are always `null` — explicitly representing
 * "not priced," never a fabricated 0 or placeholder amount (per the
 * approved clarification). Same for `CartGroupView.subtotalMinor`.
 */

export interface SelectedOptionValueView {
  id: string;
  name: string;
  nameAr: string | null;
  priceDeltaMinor: number;
}

export interface CartItemView {
  id: string;
  productId: string | null;
  productName: string | null;
  productNameAr: string | null;
  productImageUrl: string | null;
  quantity: number;
  /** PHASE G addition (Weighted Products). Null for a PIECE item and for an AD_HOC_SERVICE item. */
  pricingUnit: PricingUnit | null;
  /** WEIGHT items only — the customer's requested amount, in integer grams. Never overloaded onto `quantity`. */
  requestedWeightGrams: number | null;
  /**
   * Tracked Inventory Order-Time Enforcement. Live product state, not
   * a snapshot — mirrors `Product.inventoryMode`/`Product.quantity`
   * exactly, read fresh on every cart request (this whole interface
   * is already never cached, per this file's own top comment). Null
   * for an AD_HOC_SERVICE item. Used ONLY as a Cart UX guard
   * (max "+" quantity) — the backend remains the sole authoritative
   * check at Order creation regardless of this value.
   */
  inventoryMode: 'OPEN' | 'TRACKED' | null;
  availableQuantity: number | null;
  notes: string | null;
  selectedOptionValues: SelectedOptionValueView[];
  /** Null for an AD_HOC_SERVICE item — no formula exists to price it. For a WEIGHT item, this is the price PER KILOGRAM. */
  unitPriceMinor: number | null;
  lineTotalMinor: number | null;
  /** False if a catalog product has since become unavailable/deleted. Always true for an ad-hoc item (nothing to become unavailable). */
  isAvailable: boolean;
  /** AD_HOC_SERVICE items only. */
  freeTextDescription: string | null;
  /** AD_HOC_SERVICE items only — always Hatly-upload-produced URLs (see uploads module), never arbitrary external links. */
  imageUrls: string[];
  /**
   * PHASE G addition (Offers & Promotions). BEST-EFFORT PREVIEW ONLY —
   * checks targeting/validity/perOrderLimit but deliberately NOT
   * lifetime/allocation/budget limits (those require locked,
   * authoritative state — see OfferConsumptionService's own comment).
   * Order creation independently re-validates everything and is
   * authoritative; this preview may show a discount that ends up
   * reduced (never increased) once the order is actually placed. Null
   * for a WEIGHT item, an AD_HOC_SERVICE item, or when no Offer applies.
   */
  offerId: string | null;
  offerDiscountType: string | null;
  offerDiscountValue: number | null;
  /** How many of `quantity` this preview expects to receive the Offer — see OrderItem.offerDiscountedQuantity's own comment. */
  offerDiscountedQuantity: number | null;
  offerDiscountAmountMinor: number | null;
  /** `lineTotalMinor - offerDiscountAmountMinor` — the amount the customer would actually pay for this line, for display only. */
  payableLineTotalMinor: number | null;
  /**
   * Customer Offers Integration. Unambiguous discriminator — CONFIRMED
   * added because `offerDiscountType`/`offerDiscountValue` above no
   * longer cleanly represent a Flash Sale's real special price after
   * the mechanism split (they're populated with a workaround shape to
   * avoid breaking existing consumers). Null when no Flash Sale
   * applies to this item. SUBTOTAL_DISCOUNT never sets this field on
   * an item — see `CartGroupView.hasSubtotalDiscountOffer` instead,
   * since that mechanism is segment-level, never per-item.
   */
  offerMechanism: 'FLASH_SALE' | null;
  /** FLASH_SALE only — the real replacement price. Null otherwise. */
  specialPriceMinor: number | null;
}

export interface CartGroupView {
  id: string;
  groupType: CartGroupType;
  vendorBranchId: string | null;
  vendorName: string | null;
  adHocPlaceName: string | null;
  /** AD_HOC_SERVICE only — which of the two Hatly Service flows this group represents. */
  adHocServiceType: string | null;
  /** BUY_FROM_PLACE only — the pickup coordinate actually in effect: the customer's own override if supplied, else the configured default (resolved at order-creation time; here it just reflects whatever the customer has set so far, which may still be null pre-checkout). */
  adHocPickupLatitude: number | null;
  adHocPickupLongitude: number | null;
  /** DELIVER_TO_PLACE only — same idea, for the destination. */
  adHocDestinationLatitude: number | null;
  adHocDestinationLongitude: number | null;
  vendorNote: string | null;
  items: CartItemView[];
  /** Null for an AD_HOC_SERVICE group — see the file's own top comment. */
  subtotalMinor: number | null;
  /**
   * Customer Offers Integration. Segment-level, non-authoritative
   * signal: an active SUBTOTAL_DISCOUNT offer currently targets at
   * least one item in this group — CONFIRMED never a computed
   * discount amount (that requires the full eligible-subtotal
   * calculation, which only happens authoritatively at checkout — see
   * planSubtotalDiscountForSegment). Always `false` for an
   * AD_HOC_SERVICE group.
   */
  hasSubtotalDiscountOffer: boolean;
}

export interface CartView {
  id: string;
  fulfillmentType: FulfillmentType;
  orderNote: string | null;
  groups: CartGroupView[];
  /** Sum of CATALOG groups' subtotals only — an AD_HOC_SERVICE group contributes nothing numeric here, never a fabricated value. */
  subtotalMinor: number;
  /** True if any group is AD_HOC_SERVICE (i.e. the cart contains at least one not-yet-priced item). */
  hasUnpricedItems: boolean;
  /** True only when the cart has ≥1 item, every catalog item is available, every catalog group meets its minimum, and nothing is unpriced. Does NOT create an order — see the Phase 2D report. Whether an unpriced cart may eventually check out at all is left to Step 4. */
  readyForCheckout: boolean;
}
