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

  describe('PD-014 — Hatly / Wasally service segments (no vendor)', () => {
    const svc = (status: string) => ({ status, groupType: 'AD_HOC_SERVICE' });
    const cat = (status: string) => ({ status, groupType: 'CATALOG' });

    it('a service-only order is cancellable while READY_FOR_PICKUP (no driver yet)', () => {
      expect(customerCancellationBlock(OrderStatus.READY_FOR_PICKUP, [svc('READY_FOR_PICKUP')])).toBeNull();
      expect(customerCancellationBlock(OrderStatus.READY_FOR_PICKUP, [svc('READY_FOR_PICKUP'), svc('READY_FOR_PICKUP')])).toBeNull();
    });

    it.each([OrderStatus.ASSIGNED_TO_DRIVER, OrderStatus.PICKED_UP, OrderStatus.ON_THE_WAY, OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.FAILED_DELIVERY])(
      'a service-only order that is %s is NOT cancellable by the customer',
      (status) => {
        expect(customerCancellationBlock(status, [svc('READY_FOR_PICKUP')])).toBe('ORDER_STATUS');
      },
    );

    it('a vendor order at READY_FOR_PICKUP stays blocked (the vendor already prepared it)', () => {
      expect(customerCancellationBlock(OrderStatus.READY_FOR_PICKUP, [cat('READY_FOR_PICKUP')])).toBe('ORDER_STATUS');
      expect(customerCancellationBlock(OrderStatus.READY_FOR_PICKUP, [cat('READY_FOR_PICKUP'), svc('READY_FOR_PICKUP')])).toBe('ORDER_STATUS');
    });

    it('a service segment that became ready on its own never blocks a PENDING mixed order; a vendor preparing still does', () => {
      expect(customerCancellationBlock(OrderStatus.PENDING, [cat('PENDING'), svc('READY_FOR_PICKUP')])).toBeNull();
      expect(customerCancellationBlock(OrderStatus.PENDING, [cat('PREPARING'), svc('READY_FOR_PICKUP')])).toBe('VENDOR_SEGMENT_PREPARING');
    });

    it('only the still-active segments decide: a rejected vendor part next to a ready service part is a service-only order', () => {
      expect(customerCancellationBlock(OrderStatus.READY_FOR_PICKUP, [cat('CANCELLED'), svc('READY_FOR_PICKUP')])).toBeNull();
    });
  });
});
