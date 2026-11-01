import { EntityManager } from 'typeorm';
import { OrderVendorSegmentEvent } from './entities/order-vendor-segment-event.entity';

/**
 * Appends one row to the segment history. Always called on the caller's transaction manager, so the history row and the transition it
 * describes commit — or roll back — together.
 */
export async function recordSegmentEvent(
  manager: EntityManager,
  params: {
    segmentId: string;
    orderId: string;
    fromStatus: string | null;
    toStatus: string;
    actorUserId?: string | null;
    actorRole?: string | null;
    onBehalfOfVendor?: boolean;
    reason?: string | null;
    correlationRef?: string | null;
  },
): Promise<void> {
  await manager.getRepository(OrderVendorSegmentEvent).insert({
    segmentId: params.segmentId,
    orderId: params.orderId,
    fromStatus: params.fromStatus,
    toStatus: params.toStatus,
    actorUserId: params.actorUserId ?? null,
    actorRole: params.actorRole ?? null,
    onBehalfOfVendor: params.onBehalfOfVendor ?? false,
    reason: params.reason ? params.reason.trim().slice(0, 500) : null,
    correlationRef: params.correlationRef ?? null,
  });
}
