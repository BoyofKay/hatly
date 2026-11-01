import { FulfillmentType } from '../cart/fulfillment-type.enum';
import { OrderStatus } from '../orders/order-status.enum';
import { CUSTOMER_NOTIFICATION_FALLBACK_TEXT, CustomerNotificationType, notificationTypeForStatus, recordOrderNotification } from './customer-notification-events';

describe('notificationTypeForStatus — only genuine customer-facing lifecycle events', () => {
  it.each([
    [OrderStatus.CONFIRMED, CustomerNotificationType.ORDER_CONFIRMED],
    [OrderStatus.PREPARING, CustomerNotificationType.ORDER_PREPARING],
    [OrderStatus.ON_THE_WAY, CustomerNotificationType.ORDER_ON_THE_WAY],
    [OrderStatus.DELIVERED, CustomerNotificationType.ORDER_DELIVERED],
    [OrderStatus.COLLECTED, CustomerNotificationType.ORDER_COLLECTED],
    [OrderStatus.CANCELLED, CustomerNotificationType.ORDER_CANCELLED],
    [OrderStatus.FAILED_DELIVERY, CustomerNotificationType.ORDER_FAILED_DELIVERY],
  ])('%s → %s (either fulfilment)', (status, type) => {
    expect(notificationTypeForStatus(status, FulfillmentType.DELIVERY)).toBe(type);
    expect(notificationTypeForStatus(status, FulfillmentType.PICKUP)).toBe(type);
  });

  it('READY_FOR_PICKUP is customer-facing only for a PICKUP order (for a delivery it just means "waiting for the driver")', () => {
    expect(notificationTypeForStatus(OrderStatus.READY_FOR_PICKUP, FulfillmentType.PICKUP)).toBe(CustomerNotificationType.ORDER_READY_FOR_PICKUP);
    expect(notificationTypeForStatus(OrderStatus.READY_FOR_PICKUP, FulfillmentType.DELIVERY)).toBeNull();
  });

  it('driver hand-off statuses and PENDING (covered by ORDER_PLACED at creation) create nothing', () => {
    for (const status of [OrderStatus.PENDING, OrderStatus.ASSIGNED_TO_DRIVER, OrderStatus.PICKED_UP]) {
      expect(notificationTypeForStatus(status, FulfillmentType.DELIVERY)).toBeNull();
    }
  });

  it('every type has an English fallback text', () => {
    for (const type of Object.values(CustomerNotificationType)) {
      expect(CUSTOMER_NOTIFICATION_FALLBACK_TEXT[type].title.length).toBeGreaterThan(0);
      expect(CUSTOMER_NOTIFICATION_FALLBACK_TEXT[type].body.length).toBeGreaterThan(0);
    }
  });
});

describe('recordOrderNotification', () => {
  const order = { id: 'o1', customerId: 'c1', orderNumber: 'HT-1' };
  const managerWith = (query: jest.Mock) => ({ transaction: async (fn: (m: unknown) => unknown) => fn({ query }) }) as any;

  it('reports whether a NEW row was written (ON CONFLICT DO NOTHING returns no row on a repeat)', async () => {
    expect(await recordOrderNotification(managerWith(jest.fn().mockResolvedValue([{ id: 'n1' }])), order, CustomerNotificationType.ORDER_CONFIRMED)).toBe(true);
    expect(await recordOrderNotification(managerWith(jest.fn().mockResolvedValue([])), order, CustomerNotificationType.ORDER_CONFIRMED)).toBe(false);
  });

  it('never throws: a database failure is logged and reported as "not written"', async () => {
    const failing = managerWith(jest.fn().mockRejectedValue(new Error('boom')));
    await expect(recordOrderNotification(failing, order, CustomerNotificationType.ORDER_CONFIRMED)).resolves.toBe(false);
  });

  it('writes the caller-derived owner, order, type and frozen number — nothing else', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 'n1' }]);
    await recordOrderNotification(managerWith(query), order, CustomerNotificationType.ORDER_DELIVERED);
    expect(query.mock.calls[0][1]).toEqual(['c1', 'o1', 'ORDER_DELIVERED', 'HT-1']);
    // Lifecycle notifications stay unique on (order, type); the conflict target now names the partial index that covers rows without an event key.
    expect(query.mock.calls[0][0]).toContain('ON CONFLICT ("order_id", "type") WHERE "event_key" IS NULL DO NOTHING');
  });

  it('an event-level notification is unique on (order, type, event key), so a second case notifies once more but a replay does not', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 'n1' }]);
    await recordOrderNotification(managerWith(query), order, CustomerNotificationType.ORDER_ITEM_UNAVAILABLE, 'exception:e2');
    expect(query.mock.calls[0][1]).toEqual(['c1', 'o1', 'ORDER_ITEM_UNAVAILABLE', 'HT-1', 'exception:e2']);
    expect(query.mock.calls[0][0]).toContain('ON CONFLICT ("order_id", "type", "event_key") WHERE "event_key" IS NOT NULL DO NOTHING');
  });
});
