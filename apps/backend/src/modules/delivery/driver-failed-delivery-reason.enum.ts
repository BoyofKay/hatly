/**
 * Driver Core + Dispatch Foundation milestone. A controlled vocabulary for WHY a driver could not complete a
 * delivery — deliberately separate from `FailedDeliveryOutcome` (failed-delivery-resolution module), which is
 * the ADMIN's later financial decision (refund or not), never the driver's own report. `Order.failureReason`
 * itself stays a plain string column (unchanged, no migration) — this enum only constrains what a DRIVER may
 * put in it; an Admin-initiated FAILED_DELIVERY transition (`allowedRoles` already includes `Role.ADMIN`,
 * untouched) is unaffected and keeps its existing free-text behavior.
 *
 * Still optional (matches the existing, already-tested "Driver FAILED_DELIVERY without a failure reason
 * preserves the existing optional behavior" contract) — this only rejects a driver-supplied reason that is
 * NOT one of these values; omitting it entirely remains allowed.
 */
export enum DriverFailedDeliveryReason {
  CUSTOMER_UNREACHABLE = 'CUSTOMER_UNREACHABLE',
  CUSTOMER_REFUSED = 'CUSTOMER_REFUSED',
  ADDRESS_NOT_FOUND = 'ADDRESS_NOT_FOUND',
  UNSAFE_LOCATION = 'UNSAFE_LOCATION',
  VEHICLE_ISSUE = 'VEHICLE_ISSUE',
  OTHER = 'OTHER',
}
