/**
 * CONFIRMED business decision (Phase G — Weighted Products). A
 * Product is priced either PIECE (existing integer `quantity`
 * semantics, unchanged) or WEIGHT (priced per kilogram, ordered by
 * integer GRAMS — never floating-point kilograms, never overloading
 * the `quantity` column). See CartItem/OrderItem's own comments for
 * exactly which columns apply to which unit.
 */
export enum PricingUnit {
  PIECE = 'PIECE',
  WEIGHT = 'WEIGHT',
}
