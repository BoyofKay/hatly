import { customerCancellationBlock, isServiceOnlyOrder, servicePurchaseRecordedFor } from './customer-cancellation-rule';
import { OrderStatus } from './order-status.enum';

const svc = (status: string) => ({ status, groupType: 'AD_HOC_SERVICE' });
const cat = (status: string) => ({ status, groupType: 'CATALOG' });

describe('customerCancellationBlock — R3: a store order is cancellable until the driver picks the goods up', () => {
  it.each([OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY_FOR_PICKUP, OrderStatus.ASSIGNED_TO_DRIVER])(
    '%s → allowed, even when vendors already started or finished preparing (Hatly bears the preparation cost)',
    (status) => {
      expect(customerCancellationBlock(status, ['PREPARING', 'READY_FOR_PICKUP'])).toBeNull();
      expect(customerCancellationBlock(status, [])).toBeNull();
    },
  );

  it.each([OrderStatus.PICKED_UP, OrderStatus.ON_THE_WAY, OrderStatus.DELIVERED, OrderStatus.COLLECTED, OrderStatus.CANCELLED, OrderStatus.FAILED_DELIVERY])(
    '%s → blocked by the ORDER status (the customer contacts Operations)',
    (status) => {
      expect(customerCancellationBlock(status, ['PENDING'])).toBe('ORDER_STATUS');
    },
  );

  it('a CANCELLED segment never matters', () => {
    expect(customerCancellationBlock(OrderStatus.PENDING, ['CANCELLED', 'PENDING'])).toBeNull();
  });
});

describe('customerCancellationBlock — R40: a Hatly Service part is cancellable until the driver records the purchase', () => {
  it('service-only order, driver assigned, no purchase recorded → allowed', () => {
    expect(customerCancellationBlock(OrderStatus.ASSIGNED_TO_DRIVER, [svc('READY_FOR_PICKUP')], false)).toBeNull();
    expect(customerCancellationBlock(OrderStatus.READY_FOR_PICKUP, [svc('READY_FOR_PICKUP')])).toBeNull();
  });

  it('a recorded purchase blocks with SERVICE_PURCHASE_RECORDED', () => {
    for (const status of [OrderStatus.READY_FOR_PICKUP, OrderStatus.ASSIGNED_TO_DRIVER]) {
      expect(customerCancellationBlock(status, [svc('READY_FOR_PICKUP')], true)).toBe('SERVICE_PURCHASE_RECORDED');
    }
  });

  it('mixed order: a recorded service purchase blocks; without it the vendor part does not', () => {
    expect(customerCancellationBlock(OrderStatus.PREPARING, [cat('PREPARING'), svc('READY_FOR_PICKUP')], true)).toBe('SERVICE_PURCHASE_RECORDED');
    expect(customerCancellationBlock(OrderStatus.PREPARING, [cat('PREPARING'), svc('READY_FOR_PICKUP')], false)).toBeNull();
  });

  it('the purchase flag does not matter once the service part itself is cancelled', () => {
    expect(customerCancellationBlock(OrderStatus.CONFIRMED, [cat('CONFIRMED'), svc('CANCELLED')], true)).toBeNull();
  });

  it('after pickup a service order is blocked by the ORDER status', () => {
    expect(customerCancellationBlock(OrderStatus.PICKED_UP, [svc('READY_FOR_PICKUP')], false)).toBe('ORDER_STATUS');
  });
});

describe('isServiceOnlyOrder', () => {
  it('true only when every active segment is a service segment', () => {
    expect(isServiceOnlyOrder([svc('READY_FOR_PICKUP')])).toBe(true);
    expect(isServiceOnlyOrder([svc('READY_FOR_PICKUP'), cat('PENDING')])).toBe(false);
    expect(isServiceOnlyOrder([cat('CANCELLED'), svc('READY_FOR_PICKUP')])).toBe(true);
    expect(isServiceOnlyOrder([svc('CANCELLED')])).toBe(false);
  });
});

describe('servicePurchaseRecordedFor', () => {
  it('queries the purchase records of the given orders and returns the ids that have one', async () => {
    const query = jest.fn(async () => [{ order_id: 'o1' }]);
    await expect(servicePurchaseRecordedFor(query, ['o1', 'o2'])).resolves.toEqual(new Set(['o1']));
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ad_hoc_purchase_records'), [['o1', 'o2']]);
  });

  it('no order ids → no query', async () => {
    const query = jest.fn();
    await expect(servicePurchaseRecordedFor(query, [])).resolves.toEqual(new Set());
    expect(query).not.toHaveBeenCalled();
  });
});
