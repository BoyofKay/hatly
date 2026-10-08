import { OrderStatus } from '../orders/order-status.enum';

/**
 * A customer rates the vendor and its products once they actually received the order: DELIVERED, or — for a pickup
 * order — COLLECTED (U2, its pickup counterpart). Driver ratings stay DELIVERED-only: a pickup order has no driver.
 */
export const RATEABLE_ORDER_STATUSES: OrderStatus[] = [OrderStatus.DELIVERED, OrderStatus.COLLECTED];
