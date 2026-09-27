/**
 * Vendor-facing preparation/acceptance lifecycle — per segment, not
 * one global Order status (per the approved multi-vendor requirement:
 * "each vendor remains responsible for its own items and preparation
 * /acceptance"). Deliberately does NOT include ASSIGNED_TO_DRIVER /
 * ON_THE_WAY / DELIVERED — those are order/delivery-level concerns
 * (Order.status, unchanged this phase) once Route/RouteStop exist.
 *
 * PICKED_UP lives here (not on Order) because under a multi-vendor
 * order, each vendor's items are collected independently — there is
 * no single "picked up" moment for the whole order.
 */
export enum OrderVendorSegmentStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  PREPARING = 'PREPARING',
  READY_FOR_PICKUP = 'READY_FOR_PICKUP',
  PICKED_UP = 'PICKED_UP',
  CANCELLED = 'CANCELLED',
}
