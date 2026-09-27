import { customerCancellationBlock } from './customer-cancellation-rule';
import { OrderStatus } from './order-status.enum';

describe('customerCancellationBlock — the customer may cancel only while PENDING/CONFIRMED and no active vendor is preparing', () => {
  it.each([OrderStatus.PENDING, OrderStatus.CONFIRMED])('%s with every segment before PREPARING → allowed', (status) => {
    expect(customerCancellationBlock(status, ['PENDING', 'CONFIRMED'])).toBeNull();
    expect(customerCancellationBlock(status, [])).toBeNull();
  });

  it.each([OrderStatus.PREPARING, OrderStatus.READY_FOR_PICKUP, OrderStatus.ASSIGNED_TO_DRIVER, OrderStatus.PICKED_UP, OrderStatus.ON_THE_WAY, OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.FAILED_DELIVERY])('%s → blocked by the ORDER status', (status) => {
    expect(customerCancellationBlock(status, ['PENDING'])).toBe('ORDER_STATUS');
  });

  it.each(['PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP'])('a PENDING order with one vendor segment already %s → blocked by the vendor segment', (segment) => {
    expect(customerCancellationBlock(OrderStatus.PENDING, ['CONFIRMED', segment])).toBe('VENDOR_SEGMENT_PREPARING');
  });

  it('a CANCELLED segment never blocks (its vendor is out of the order)', () => {
    expect(customerCancellationBlock(OrderStatus.PENDING, ['CANCELLED', 'PENDING'])).toBeNull();
    expect(customerCancellationBlock(OrderStatus.PENDING, ['CANCELLED'])).toBeNull();
  });
});
