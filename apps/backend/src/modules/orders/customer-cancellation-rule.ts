import { OrderStatus } from './order-status.enum';
import { OrderVendorSegmentStatus } from './order-vendor-segment-status.enum';

/**
 * PD-005 (refined, PD-006): a customer may cancel their whole order only while it is PENDING or CONFIRMED AND every still-active
 * vendor segment is before PREPARING. The order status alone is not enough: it only advances once every vendor is ready, so a
 * vendor can already be preparing its segment while the order is still PENDING — and from that moment the customer can no longer
 * cancel. Cancelling only one vendor's segment is not a customer action at all.
 */
export const CUSTOMER_CANCELLABLE_ORDER_STATUSES: OrderStatus[] = [OrderStatus.PENDING, OrderStatus.CONFIRMED];

const SEGMENT_STATUSES_BLOCKING_CUSTOMER_CANCELLATION: string[] = [
  OrderVendorSegmentStatus.PREPARING,
  OrderVendorSegmentStatus.READY_FOR_PICKUP,
  OrderVendorSegmentStatus.PICKED_UP,
];

export type CustomerCancellationBlock = 'ORDER_STATUS' | 'VENDOR_SEGMENT_PREPARING';

/** null = the customer may cancel now. */
export function customerCancellationBlock(orderStatus: OrderStatus, segmentStatuses: string[]): CustomerCancellationBlock | null {
  if (!CUSTOMER_CANCELLABLE_ORDER_STATUSES.includes(orderStatus)) return 'ORDER_STATUS';
  const active = segmentStatuses.filter((s) => s !== OrderVendorSegmentStatus.CANCELLED);
  return active.some((s) => SEGMENT_STATUSES_BLOCKING_CUSTOMER_CANCELLATION.includes(s)) ? 'VENDOR_SEGMENT_PREPARING' : null;
}
