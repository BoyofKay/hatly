import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { OrderStatusEvent } from './entities/order-status-event.entity';

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
