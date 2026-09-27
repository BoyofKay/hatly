/**
 * CONFIRMED business decision (Offers & Promotions): exactly two
 * discount types, each Offer uses exactly one. `Offer.discountValue`'s
 * meaning depends on this: basis points (0–10000) for PERCENTAGE,
 * integer minor currency units for FIXED. Never a third mechanism
 * (e.g. fixed promotional price) in this version.
 */
export enum DiscountType {
  PERCENTAGE = 'PERCENTAGE',
  FIXED = 'FIXED',
}
