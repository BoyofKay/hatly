import { OrderStatus } from './order-status.enum';
import { OrderVendorSegmentStatus } from './order-vendor-segment-status.enum';
import { CartGroupType } from '../cart/cart-group-type.enum';

/**
 * PD-005 (refined, PD-006): a customer may cancel their whole order only while it is PENDING or CONFIRMED AND every still-active
 * vendor segment is before PREPARING. The order status alone is not enough: it only advances once every vendor is ready, so a
 * vendor can already be preparing its segment while the order is still PENDING — and from that moment the customer can no longer
 * cancel. Cancelling only one vendor's segment is not a customer action at all.
 *
 * PD-014 (Hatly / Wasally): these service segments have NO vendor — they become READY_FOR_PICKUP on their own once the payment gate
 * passes, so their "ready" is not a vendor preparing anything. Therefore (a) an AD_HOC_SERVICE segment never blocks cancellation of a
 * mixed order, and (b) an order made ONLY of service segments stays customer-cancellable while it is READY_FOR_PICKUP, i.e. until a
 * driver is assigned (ASSIGNED_TO_DRIVER and later are never cancellable by the customer).
 */
export const CUSTOMER_CANCELLABLE_ORDER_STATUSES: OrderStatus[] = [OrderStatus.PENDING, OrderStatus.CONFIRMED];

const SEGMENT_STATUSES_BLOCKING_CUSTOMER_CANCELLATION: string[] = [
  OrderVendorSegmentStatus.PREPARING,
  OrderVendorSegmentStatus.READY_FOR_PICKUP,
  OrderVendorSegmentStatus.PICKED_UP,
];

export type CustomerCancellationBlock = 'ORDER_STATUS' | 'VENDOR_SEGMENT_PREPARING';

/** A segment as the rule sees it. A bare status string means a vendor (CATALOG) segment — the original, pre-PD-014 call shape. */
export type CancellationSegment = string | { status: string; groupType?: string | null };

const statusOf = (s: CancellationSegment): string => (typeof s === 'string' ? s : s.status);
const isServiceSegment = (s: CancellationSegment): boolean => typeof s !== 'string' && s.groupType === CartGroupType.AD_HOC_SERVICE;

/** True when every still-active segment is a Hatly / Wasally service segment (and there is at least one). */
export function isServiceOnlyOrder(segments: CancellationSegment[]): boolean {
  const active = segments.filter((s) => statusOf(s) !== OrderVendorSegmentStatus.CANCELLED);
  return active.length > 0 && active.every(isServiceSegment);
}

/** null = the customer may cancel now. */
export function customerCancellationBlock(orderStatus: OrderStatus, segments: CancellationSegment[]): CustomerCancellationBlock | null {
  const statusAllowed =
    CUSTOMER_CANCELLABLE_ORDER_STATUSES.includes(orderStatus) ||
    (orderStatus === OrderStatus.READY_FOR_PICKUP && isServiceOnlyOrder(segments));
  if (!statusAllowed) return 'ORDER_STATUS';
  const active = segments.filter((s) => statusOf(s) !== OrderVendorSegmentStatus.CANCELLED && !isServiceSegment(s));
  return active.some((s) => SEGMENT_STATUSES_BLOCKING_CUSTOMER_CANCELLATION.includes(statusOf(s))) ? 'VENDOR_SEGMENT_PREPARING' : null;
}
