import { Injectable } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { OrderStatusEvent } from './entities/order-status-event.entity';

export interface OrderTimelineEntry {
  status: string;
  at: Date;
  actorRole: string | null;
}

/** The order's status history, oldest first — the ONE definition of a timeline, shared by the customer and admin views. */
export async function loadOrderTimeline(repository: Pick<Repository<OrderStatusEvent>, 'find'>, orderId: string): Promise<OrderTimelineEntry[]> {
  const events = await repository.find({ where: { orderId }, order: { createdAt: 'ASC' } });
  return events.map((e) => ({ status: e.toStatus, at: e.createdAt, actorRole: e.actorRole ?? null }));
}

/**
 * Appends one `order_status_events` row per status change, on the caller's transaction, so the customer timeline can never
 * disagree with the order status it describes.
 */
@Injectable()
export class OrderStatusHistoryService {
  async record(
    manager: EntityManager,
    params: { orderId: string; from: string | null; to: string; actorRole?: string | null; actorUserId?: string | null },
  ): Promise<void> {
    await manager.getRepository(OrderStatusEvent).insert({
      orderId: params.orderId,
      fromStatus: params.from,
      toStatus: params.to,
      actorRole: params.actorRole ?? null,
      actorUserId: params.actorUserId ?? null,
    });
  }
}
