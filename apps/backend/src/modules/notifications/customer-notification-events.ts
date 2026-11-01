import { Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { FulfillmentType } from '../cart/fulfillment-type.enum';
import { OrderStatus } from '../orders/order-status.enum';

/**
 * The customer-visible order lifecycle events. Every one maps to something that REALLY happens to the order today (creation, or
 * an existing OrderStatus transition) — no operational status was added to populate this list. Transitions a customer cannot act
 * on or care about (ASSIGNED_TO_DRIVER, PICKED_UP, READY_FOR_PICKUP of a DELIVERY order — the driver hand-off) create nothing.
 */
export enum CustomerNotificationType {
  ORDER_PLACED = 'ORDER_PLACED',
  ORDER_CONFIRMED = 'ORDER_CONFIRMED',
  ORDER_PREPARING = 'ORDER_PREPARING',
  ORDER_READY_FOR_PICKUP = 'ORDER_READY_FOR_PICKUP',
  ORDER_ON_THE_WAY = 'ORDER_ON_THE_WAY',
  ORDER_DELIVERED = 'ORDER_DELIVERED',
  ORDER_COLLECTED = 'ORDER_COLLECTED',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
  /** One vendor's part of a multi-vendor order was rejected; the rest of the order continues (the whole order is NOT cancelled). */
  ORDER_PART_CANCELLED = 'ORDER_PART_CANCELLED',
  ORDER_FAILED_DELIVERY = 'ORDER_FAILED_DELIVERY',
  /** A product of the order turned out to be unavailable (PD-016): the customer chooses to continue without it or to cancel the order. */
  ORDER_ITEM_UNAVAILABLE = 'ORDER_ITEM_UNAVAILABLE',
}

/** English fallback for clients that do not know a type; the Customer app renders its own localized wording. */
export const CUSTOMER_NOTIFICATION_FALLBACK_TEXT: Record<CustomerNotificationType, { title: string; body: string }> = {
  [CustomerNotificationType.ORDER_PLACED]: { title: 'Order received', body: 'We received your order.' },
  [CustomerNotificationType.ORDER_CONFIRMED]: { title: 'Order confirmed', body: 'Your order has been confirmed.' },
  [CustomerNotificationType.ORDER_PREPARING]: { title: 'Preparing your order', body: 'Your order is being prepared.' },
  [CustomerNotificationType.ORDER_READY_FOR_PICKUP]: { title: 'Ready for pickup', body: 'Your order is ready to collect.' },
  [CustomerNotificationType.ORDER_ON_THE_WAY]: { title: 'Order on the way', body: 'Your order is on the way.' },
  [CustomerNotificationType.ORDER_DELIVERED]: { title: 'Order delivered', body: 'Your order has been delivered.' },
  [CustomerNotificationType.ORDER_COLLECTED]: { title: 'Order collected', body: 'You collected your order.' },
  [CustomerNotificationType.ORDER_PART_CANCELLED]: { title: 'Part of your order was cancelled', body: 'A vendor could not prepare their part of your order. The rest of your order continues.' },
  [CustomerNotificationType.ORDER_CANCELLED]: { title: 'Order cancelled', body: 'Your order has been cancelled.' },
  [CustomerNotificationType.ORDER_FAILED_DELIVERY]: { title: 'Delivery failed', body: 'We were unable to deliver your order.' },
  [CustomerNotificationType.ORDER_ITEM_UNAVAILABLE]: { title: 'An item in your order is unavailable', body: 'Open your order to continue without it or to cancel the order.' },
};

/** The notification (if any) that reaching [status] means for the customer. */
export function notificationTypeForStatus(status: OrderStatus, fulfillmentType: FulfillmentType): CustomerNotificationType | null {
  switch (status) {
    case OrderStatus.CONFIRMED:
      return CustomerNotificationType.ORDER_CONFIRMED;
    case OrderStatus.PREPARING:
      return CustomerNotificationType.ORDER_PREPARING;
    case OrderStatus.READY_FOR_PICKUP:
      // For a delivery order "ready" only means "waiting for the driver" — not something to tell the customer.
      return fulfillmentType === FulfillmentType.PICKUP ? CustomerNotificationType.ORDER_READY_FOR_PICKUP : null;
    case OrderStatus.ON_THE_WAY:
      return CustomerNotificationType.ORDER_ON_THE_WAY;
    case OrderStatus.DELIVERED:
      return CustomerNotificationType.ORDER_DELIVERED;
    case OrderStatus.COLLECTED:
      return CustomerNotificationType.ORDER_COLLECTED;
    case OrderStatus.CANCELLED:
      return CustomerNotificationType.ORDER_CANCELLED;
    case OrderStatus.FAILED_DELIVERY:
      return CustomerNotificationType.ORDER_FAILED_DELIVERY;
    default:
      return null;
  }
}

const logger = new Logger('CustomerNotifications');

/**
 * Writes the notification for an order event using the CALLER'S transaction, so "the event happened" and "the customer is told"
 * commit or roll back together and can never disagree.
 *
 * Safe by construction:
 *  - idempotent: lifecycle notifications are unique on `(order_id, type)`; a notification that belongs to one event passes an `eventKey`
 *    and is unique on `(order_id, type, event_key)` — so a second CASE of the same kind on one order still notifies the customer, while a
 *    retry, a replayed event or two concurrent writers of the same event produce exactly one row (`ON CONFLICT DO NOTHING`);
 *  - isolated: it runs in a SAVEPOINT, so a failure here (logged, never thrown) cannot abort or roll back the order's own
 *    transaction.
 * Returns whether a new row was written.
 */
export async function recordOrderNotification(
  manager: EntityManager,
  order: { id: string; customerId: string; orderNumber: string },
  type: CustomerNotificationType,
  eventKey?: string,
): Promise<boolean> {
  try {
    return await manager.transaction(async (savepoint) => {
      const rows: Array<{ id: string }> = await savepoint.query(
        eventKey
          ? `INSERT INTO "customer_notifications" ("customer_id", "order_id", "type", "order_number", "event_key")
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT ("order_id", "type", "event_key") WHERE "event_key" IS NOT NULL DO NOTHING
             RETURNING "id"`
          : `INSERT INTO "customer_notifications" ("customer_id", "order_id", "type", "order_number")
             VALUES ($1, $2, $3, $4)
             ON CONFLICT ("order_id", "type") WHERE "event_key" IS NULL DO NOTHING
             RETURNING "id"`,
        eventKey ? [order.customerId, order.id, type, order.orderNumber, eventKey] : [order.customerId, order.id, type, order.orderNumber],
      );
      return rows.length > 0;
    });
  } catch (error) {
    logger.error(`Could not record ${type} notification for order ${order.id}: ${(error as Error).message}`);
    return false;
  }
}
