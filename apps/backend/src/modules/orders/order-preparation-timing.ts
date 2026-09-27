import { EntityManager } from 'typeorm';
import { OrderVendorSegment } from './entities/order-vendor-segment.entity';
import { OrderVendorSegmentStatus } from './order-vendor-segment-status.enum';

/**
 * Re-anchors every one of an order's not-yet-cancelled vendor segments' `expectedReadyAt` to start counting from `from`
 * (default now) instead of whenever the order was originally created.
 *
 * Called exactly once: when a MANUAL_TRANSFER payment is approved (see `PaymentStateMachineService`). Until that moment,
 * `OrderPaymentGateService`/`paymentBlocksFulfilment` refuses every segment's move into `PREPARING`, so none of them can
 * genuinely have started — the estimate stamped at order creation (`OrderCreationService`) would otherwise silently count
 * down through however long payment review took. This never touches money, never invents a number for a segment whose
 * branch configured no preparation time (`preparationEstimateMinutes` null — left untouched, same as at creation), and never
 * revives a segment the vendor already cancelled.
 */
export async function reanchorPreparationTiming(manager: EntityManager, orderId: string, from: Date = new Date()): Promise<void> {
  const segments = await manager.find(OrderVendorSegment, { where: { orderId } });
  for (const segment of segments) {
    if (segment.status === OrderVendorSegmentStatus.CANCELLED) continue;
    if (!segment.preparationEstimateMinutes) continue;
    segment.expectedReadyAt = new Date(from.getTime() + segment.preparationEstimateMinutes * 60_000);
    await manager.save(OrderVendorSegment, segment);
  }
}
