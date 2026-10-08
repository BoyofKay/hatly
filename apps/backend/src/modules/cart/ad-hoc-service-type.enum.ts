/**
 * Only meaningful when CartVendorGroup.groupType === AD_HOC_SERVICE.
 * Confirmed business distinction:
 *
 * BUY_FROM_PLACE ("هاتلي من مكان"): the PICKUP is the place the
 * customer chose (CartVendorGroup.adHocPickupLatitude/Longitude) and is
 * REQUIRED at checkout — a request without one is rejected
 * (`BUY_FROM_PLACE_PICKUP_REQUIRED`); it used to fall back to
 * BusinessConfigKey.HATLY_SERVICE_DEFAULT_PICKUP_LOCATION, which sent the
 * courier to Hatly's own office. The destination is always the customer's
 * own delivery address, handled by `HatlyServicePricingService
 * .calculateCharge` and never read from configuration.
 *
 * DELIVER_TO_PLACE ("وصلي لمكان"): the DESTINATION is the place the
 * customer chose and is REQUIRED at checkout (rejected with
 * `DELIVER_TO_PLACE_DESTINATION_REQUIRED` — the earlier default-destination
 * fallback was removed for the same reason). The starting point is the
 * customer's own delivery address.
 *
 * In both types Hatly's own configured locations are never a stand-in for a
 * location or address the customer did not supply.
 *
 * Confirmed: a cart may contain at most ONE AD_HOC_SERVICE group
 * regardless of which type it is — see CartService's group-cap logic.
 */
export enum AdHocServiceType {
  BUY_FROM_PLACE = 'BUY_FROM_PLACE',
  DELIVER_TO_PLACE = 'DELIVER_TO_PLACE',
}
