import { OrderReadinessService } from './order-readiness.service';
import { OrderVendorSegmentStatus } from './order-vendor-segment-status.enum';
import { OrderStatus } from './order-status.enum';
import { Role } from '../../common/enums/role.enum';

function buildHarness(order: any, segments: any[]) {
  const orderState = { ...order };
  const segmentsRepository = { find: jest.fn(async () => segments) };
  const ordersRepository = { findOne: jest.fn(async () => ({ ...orderState })) };

  // A minimal, faithful simulation of the real OrderStateMachineService's
  // transition table for just the statuses this service walks through.
  const CHAIN = [OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY_FOR_PICKUP];
  const orderStateMachine = {
    transitionIfPossible: jest.fn(async (params: { orderId: string; to: OrderStatus; actorRole: Role }) => {
      const currentIndex = CHAIN.indexOf(orderState.status);
      const targetIndex = CHAIN.indexOf(params.to);
      if (targetIndex === currentIndex + 1) {
        orderState.status = params.to;
      }
      return { ...orderState };
    }),
  };

  const service = new OrderReadinessService(
    segmentsRepository as any,
    ordersRepository as any,
    orderStateMachine as any,
  );
  return { service, orderState, orderStateMachine };
}

describe('OrderReadinessService', () => {
  it('advances Order.status through the full chain and returns true when a single-segment order becomes ready', async () => {
    const { service, orderState } = buildHarness({ id: 'order-1', status: OrderStatus.PENDING }, [
      { id: 'seg-1', orderId: 'order-1', status: OrderVendorSegmentStatus.READY_FOR_PICKUP },
    ]);

    const result = await service.checkAndAdvance('order-1');

    expect(result).toBe(true);
    expect(orderState.status).toBe(OrderStatus.READY_FOR_PICKUP);
  });

  it("CONFIRMED BUSINESS RULE: does NOT advance when only some of a multi-vendor order's segments are ready", async () => {
    const { service, orderState } = buildHarness({ id: 'order-1', status: OrderStatus.PENDING }, [
      { id: 'seg-1', orderId: 'order-1', status: OrderVendorSegmentStatus.READY_FOR_PICKUP },
      { id: 'seg-2', orderId: 'order-1', status: OrderVendorSegmentStatus.PREPARING },
    ]);

    const result = await service.checkAndAdvance('order-1');

    expect(result).toBe(false);
    expect(orderState.status).toBe(OrderStatus.PENDING); // untouched
  });

  it('advances once ALL segments of a multi-vendor order are ready', async () => {
    const { service, orderState } = buildHarness({ id: 'order-1', status: OrderStatus.PENDING }, [
      { id: 'seg-1', orderId: 'order-1', status: OrderVendorSegmentStatus.READY_FOR_PICKUP },
      { id: 'seg-2', orderId: 'order-1', status: OrderVendorSegmentStatus.READY_FOR_PICKUP },
      { id: 'seg-3', orderId: 'order-1', status: OrderVendorSegmentStatus.READY_FOR_PICKUP },
    ]);

    const result = await service.checkAndAdvance('order-1');

    expect(result).toBe(true);
    expect(orderState.status).toBe(OrderStatus.READY_FOR_PICKUP);
  });

  it('a CANCELLED segment does not block readiness — excluded from the "must be ready" set', async () => {
    const { service, orderState } = buildHarness({ id: 'order-1', status: OrderStatus.PENDING }, [
      { id: 'seg-1', orderId: 'order-1', status: OrderVendorSegmentStatus.READY_FOR_PICKUP },
      { id: 'seg-2', orderId: 'order-1', status: OrderVendorSegmentStatus.CANCELLED },
    ]);

    const result = await service.checkAndAdvance('order-1');

    expect(result).toBe(true);
    expect(orderState.status).toBe(OrderStatus.READY_FOR_PICKUP);
  });

  it('is idempotent — a second call after the order is already READY_FOR_PICKUP returns false, does not re-attempt transitions', async () => {
    const { service, orderStateMachine } = buildHarness({ id: 'order-1', status: OrderStatus.READY_FOR_PICKUP }, [
      { id: 'seg-1', orderId: 'order-1', status: OrderVendorSegmentStatus.READY_FOR_PICKUP },
    ]);

    const result = await service.checkAndAdvance('order-1');

    expect(result).toBe(false);
    expect(orderStateMachine.transitionIfPossible).not.toHaveBeenCalled();
  });

  it('uses Role.ADMIN as the system actor for every transition — never attributes the advancement to a vendor', async () => {
    const { service, orderStateMachine } = buildHarness({ id: 'order-1', status: OrderStatus.PENDING }, [
      { id: 'seg-1', orderId: 'order-1', status: OrderVendorSegmentStatus.READY_FOR_PICKUP },
    ]);

    await service.checkAndAdvance('order-1');

    for (const call of orderStateMachine.transitionIfPossible.mock.calls) {
      expect(call[0].actorRole).toBe(Role.ADMIN);
    }
  });

  it('returns false when the order has no segments at all', async () => {
    const { service } = buildHarness({ id: 'order-1', status: OrderStatus.PENDING }, []);
    const result = await service.checkAndAdvance('order-1');
    expect(result).toBe(false);
  });
});
