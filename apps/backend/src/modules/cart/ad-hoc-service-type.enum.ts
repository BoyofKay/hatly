/**
 * Only meaningful when CartVendorGroup.groupType === AD_HOC_SERVICE.
 * Confirmed business distinction:
 *
 * BUY_FROM_PLACE ("هاتلي من مكان"): customer describes what they want;
 * pickup location is usually NOT supplied (they only care about the
 * item) — falls back to a configured default pickup location
 * (BusinessConfigKey.HATLY_SERVICE_DEFAULT_PICKUP_LOCATION) unless the
 * customer explicitly supplies/overrides one (see
 * CartVendorGroup.adHocPickupLatitude/Longitude).
 *
 * DELIVER_TO_PLACE ("وصلي لمكان"): customer supplies a destination; if
 * they don't, it falls back to a SEPARATE configured default
 * destination (BusinessConfigKey.HATLY_SERVICE_DEFAULT_DESTINATION_LOCATION).
 * The starting point for this type is the customer's own delivery
 * location (already captured normally at checkout) — no separate
 * default pickup is needed for this type.
 *
 * Confirmed: a cart may contain at most ONE AD_HOC_SERVICE group
 * regardless of which type it is — see CartService's group-cap logic.
 */
export enum AdHocServiceType {
  BUY_FROM_PLACE = 'BUY_FROM_PLACE',
  DELIVER_TO_PLACE = 'DELIVER_TO_PLACE',
}
