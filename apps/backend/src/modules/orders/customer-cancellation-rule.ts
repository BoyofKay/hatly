import { OrderStatus } from './order-status.enum';
import { OrderVendorSegmentStatus } from './order-vendor-segment-status.enum';
import { CartGroupType } from '../cart/cart-group-type.enum';

/**
 * R3 / R40 (decision register 2026-11-06) — supersedes PD-005/PD-006/PD-014's narrower windows:
 *  - A STORE order (vendor segments, delivery or pickup) may be cancelled by the customer until the goods leave the vendor:
 *    PENDING, CONFIRMED, PREPARING, READY_FOR_PICKUP and ASSIGNED_TO_DRIVER (a driver is assigned but has not picked up).
 *    A vendor having started (or finished) preparing does NOT block it — Hatly bears that preparation cost (Operations record any
 *    vendor compensation by hand; nothing automatic). From PICKED_UP on (or COLLECTED for a pickup order) the customer contacts
 *    Operations instead.
 *  - A HATLY SERVICE (Hatly / Wasally) part may be cancelled until the driver records the purchase (any purchase record on the order's
 *    service items) — after that the customer contacts Operations.
 * Cancelling only one vendor's part is still not a customer action.
 */
export const CUSTOMER_CANCELLABLE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.ASSIGNED_TO_DRIVER,
];

/** ORDER_STATUS: the goods have left the vendor (or the order is finished). SERVICE_PURCHASE_RECORDED: the driver already bought the Hatly Service items. */
export type CustomerCancellationBlock = 'ORDER_STATUS' | 'SERVICE_PURCHASE_RECORDED';

/** A segment as the rule sees it. A bare status string means a vendor (CATALOG) segment — the original, pre-PD-014 call shape. */
export type CancellationSegment = string | { status: string; groupType?: string | null };

const statusOf = (s: CancellationSegment): string => (typeof s === 'string' ? s : s.status);
const isServiceSegment = (s: CancellationSegment): boolean => typeof s !== 'string' && s.groupType === CartGroupType.AD_HOC_SERVICE;

/** True when every still-active segment is a Hatly / Wasally service segment (and there is at least one). */
export function isServiceOnlyOrder(segments: CancellationSegment[]): boolean {
  const active = segments.filter((s) => statusOf(s) !== OrderVendorSegmentStatus.CANCELLED);
  return active.length > 0 && active.every(isServiceSegment);
}

/**
 * null = the customer may cancel now. `servicePurchaseRecorded` = the driver has recorded a purchase for one of the order's Hatly Service
 * items (callers look it up; see servicePurchaseRecordedFor).
 */
export function customerCancellationBlock(
  orderStatus: OrderStatus,
  segments: CancellationSegment[],
  servicePurchaseRecorded = false,
): CustomerCancellationBlock | null {
  if (!CUSTOMER_CANCELLABLE_ORDER_STATUSES.includes(orderStatus)) return 'ORDER_STATUS';
  const hasActiveService = segments.some((s) => statusOf(s) !== OrderVendorSegmentStatus.CANCELLED && isServiceSegment(s));
  if (hasActiveService && servicePurchaseRecorded) return 'SERVICE_PURCHASE_RECORDED';
  return null;
}

/** Order ids (of those given) for which a driver already recorded a Hatly Service purchase. */
export async function servicePurchaseRecordedFor(
  query: (sql: string, params: unknown[]) => Promise<Array<{ order_id: string }>>,
  orderIds: string[],
): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  const rows = await query(
    `SELECT DISTINCT g.order_id FROM ad_hoc_purchase_records r
       JOIN order_items oi ON oi.id = r.order_item_id
       JOIN order_vendor_segments g ON g.id = oi.order_vendor_segment_id
      WHERE g.order_id = ANY($1)`,
    [orderIds],
  );
  return new Set(rows.map((r) => r.order_id));
}
