/**
 * Offers — Final System. Exactly two mechanisms, each Offer uses
 * exactly one — CONFIRMED, never mixed, never a third mechanism.
 * SUBTOTAL_DISCOUNT: percentage/fixed off the ELIGIBLE SUBTOTAL of a
 * VendorBranch segment. FLASH_SALE: a fixed special selling price for
 * specific product(s), with cumulative per-customer and global
 * quantity allocation.
 */
export enum OfferMechanism {
  SUBTOTAL_DISCOUNT = 'SUBTOTAL_DISCOUNT',
  FLASH_SALE = 'FLASH_SALE',
}
