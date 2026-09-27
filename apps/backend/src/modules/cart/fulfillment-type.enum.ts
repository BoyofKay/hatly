/**
 * DELIVERY or PICKUP for an entire cart/order. PICKUP is only ever
 * valid when there is exactly one CATALOG group and that branch has
 * `pickupEnabled` — enforced in CartService, not by this enum itself.
 * An AD_HOC_SERVICE group can never be part of a PICKUP cart (it has
 * no registered branch to pick up from).
 */
export enum FulfillmentType {
  DELIVERY = 'DELIVERY',
  PICKUP = 'PICKUP',
}
