import { EntityManager } from 'typeorm';
import { OrderVendorSegment } from './entities/order-vendor-segment.entity';
import { Order } from './entities/order.entity';

/**
 * Vendor/Driver Deferred Pricing for Custom CATALOG Items. Extracted
 * from `OrderItemWeightRecordService`'s own private `applyDelta` —
 * CONFIRMED the same logic, not a copy: that service now calls this
 * exact function instead of its own former private method, so the
 * "apply a financial correction from one item up through segment and
 * order totals" rule is defined in exactly one place for both the
 * weight-finalization case and this chunk's custom-item-pricing case.
 *
 * Never touches `Order.deliveryFeeMinor` (unrelated to any per-item
 * amount change) or `Order.hasPendingAdHocPricing` (a different,
 * unrelated concept — callers recalculate that separately). If
 * `order.totalMinor` isn't known yet, it stays null — never a
 * fabricated partial total.
 */
export async function applyOrderItemAmountDelta(
  manager: EntityManager,
  segment: OrderVendorSegment,
  order: Order,
  delta: number,
): Promise<void> {
  if (delta === 0) return;

  segment.subtotalMinor = (segment.subtotalMinor ?? 0) + delta;
  await manager.save(OrderVendorSegment, segment);

  order.subtotalMinor = order.subtotalMinor + delta;
  if (order.totalMinor != null) {
    order.totalMinor = order.totalMinor + delta;
  }
  await manager.save(Order, order);
}
