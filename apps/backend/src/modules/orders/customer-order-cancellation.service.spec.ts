import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CustomerOrderCancellationService } from './customer-order-cancellation.service';
import { OrderStatus } from './order-status.enum';
import { OrderVendorSegmentStatus } from './order-vendor-segment-status.enum';
import { OrderVendorSegment } from './entities/order-vendor-segment.entity';
import { Order } from './entities/order.entity';
import { Role } from '../../common/enums/role.enum';

/**
 * Customer cancellation of a whole order (PD-005) on a mocked transaction. The state-machine money/stock handling has its
 * own specs and the real-database behaviour (locks, concurrency, refunds) is in test/e2e/64-customer-cancellation.e2e-spec.ts.
 */
function build(params: { order: any | null; visibleOrder?: any | null; segments?: any[]; purchasedOrderIds?: string[] }) {
  const calls: string[] = [];
  const segmentUpdates: any[] = [];
  const afterCommit = jest.fn(async () => {
    calls.push('afterCommit');
  });
  const manager: any = {
    // R40: purchase-record lookup (Hatly Service) — `params.purchasedOrderIds` lists orders whose driver already bought the items.
    query: jest.fn(async () => (params.purchasedOrderIds ?? []).map((order_id: string) => ({ order_id }))),
    find: jest.fn(async (E: any, opts: any) => {
      if (E === OrderVendorSegment) {
        calls.push('lock-segments');
        expect(opts.lock).toEqual({ mode: 'pessimistic_write' });
        expect(opts.order).toEqual({ id: 'ASC' }); // deterministic order — no lock-order deadlocks between two cancellations
        return params.segments ?? [];
      }
      return [];
    }),
    findOne: jest.fn(async (E: any) => {
      if (E === Order) {
        calls.push('lock-order');
        return params.order;
      }
      return null;
    }),
    createQueryBuilder: () => {
      const qb: any = {
        update: () => qb,
        set: (v: any) => {
          qb.values = v;
          return qb;
        },
        where: (_sql: string, p: any) => {
          qb.ids = p.ids;
          return qb;
        },
        execute: async () => {
          segmentUpdates.push({ set: qb.values, ids: qb.ids });
          calls.push('cancel-segments');
        },
      };
      return qb;
    },
  };
  const dataSource: any = {
    getRepository: () => ({ findOne: async () => (params.visibleOrder === undefined ? params.order : params.visibleOrder) }),
    transaction: async (cb: any) => {
      calls.push('begin');
      const result = await cb(manager);
      calls.push('commit');
      return result;
    },
  };
  const orderStateMachine = {
    transitionInTransaction: jest.fn(async () => {
      calls.push('state-machine');
      return { order: {}, afterCommit };
    }),
  };
  const service = new CustomerOrderCancellationService(dataSource, orderStateMachine as any);
  return { service, calls, segmentUpdates, orderStateMachine, afterCommit };
}

const order = (status: OrderStatus, customerId = 'cust-1') => ({ id: 'order-1', customerId, status });
const seg = (id: string, status: OrderVendorSegmentStatus) => ({ id, status });

describe('CustomerOrderCancellationService', () => {
  it.each([OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY_FOR_PICKUP, OrderStatus.ASSIGNED_TO_DRIVER])('R3: cancels a %s order: state machine (as the CUSTOMER, customer path) then every active segment, then post-commit effects', async (status) => {
    const h = build({ order: order(status), segments: [seg('s1', OrderVendorSegmentStatus.PENDING), seg('s2', OrderVendorSegmentStatus.CONFIRMED)] });
    await h.service.cancel('cust-1', 'order-1', 'changed my mind');

    expect(h.orderStateMachine.transitionInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      { orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.CUSTOMER, actorUserId: 'cust-1', cancellationReason: 'changed my mind', customerCancellation: true },
    );
    expect(h.segmentUpdates).toEqual([{ set: { status: OrderVendorSegmentStatus.CANCELLED }, ids: ['s1', 's2'] }]);
    // segments are locked BEFORE the order (vendor: segment → order), the segment update comes after the state machine has
    // restored stock from the still-active statuses, and effects only run after the commit
    expect(h.calls).toEqual(['begin', 'lock-segments', 'lock-order', 'state-machine', 'cancel-segments', 'commit', 'afterCommit']);
  });

  it('already-cancelled segments are left terminal and never processed again', async () => {
    const h = build({
      order: order(OrderStatus.PENDING),
      segments: [seg('s1', OrderVendorSegmentStatus.CANCELLED), seg('s2', OrderVendorSegmentStatus.PENDING), seg('s3', OrderVendorSegmentStatus.CANCELLED)],
    });
    await h.service.cancel('cust-1', 'order-1');
    expect(h.segmentUpdates).toEqual([{ set: { status: OrderVendorSegmentStatus.CANCELLED }, ids: ['s2'] }]);
  });

  it('no segment update at all when every segment is already cancelled', async () => {
    const h = build({ order: order(OrderStatus.PENDING), segments: [seg('s1', OrderVendorSegmentStatus.CANCELLED)] });
    await h.service.cancel('cust-1', 'order-1');
    expect(h.segmentUpdates).toEqual([]);
  });

  it("another customer's order is a 404 — nothing is locked, nothing is cancelled", async () => {
    const h = build({ order: order(OrderStatus.PENDING, 'someone-else') });
    await expect(h.service.cancel('cust-1', 'order-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(h.calls).toEqual([]);
  });

  it('a non-existent order is a 404, indistinguishable from someone else\'s', async () => {
    const h = build({ order: null, visibleOrder: null });
    await expect(h.service.cancel('cust-1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(h.calls).toEqual([]);
  });

  it('ownership is re-checked under the lock (the row is the truth, not the earlier unlocked read)', async () => {
    const h = build({ order: order(OrderStatus.PENDING, 'someone-else'), visibleOrder: order(OrderStatus.PENDING) });
    await expect(h.service.cancel('cust-1', 'order-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(h.orderStateMachine.transitionInTransaction).not.toHaveBeenCalled();
  });

  it.each([
    OrderStatus.PICKED_UP,
    OrderStatus.ON_THE_WAY,
    OrderStatus.DELIVERED,
    OrderStatus.FAILED_DELIVERY,
  ])('a %s order is refused with ORDER_NOT_CANCELLABLE_BY_CUSTOMER — nothing changes', async (status) => {
    const h = build({ order: order(status), segments: [seg('s1', OrderVendorSegmentStatus.PENDING)] });
    await expect(h.service.cancel('cust-1', 'order-1')).rejects.toMatchObject({ response: { details: { code: 'ORDER_NOT_CANCELLABLE_BY_CUSTOMER', status } } });
    await expect(h.service.cancel('cust-1', 'order-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(h.orderStateMachine.transitionInTransaction).not.toHaveBeenCalled();
    expect(h.segmentUpdates).toEqual([]);
    expect(h.afterCommit).not.toHaveBeenCalled();
  });

  it('an already-cancelled order is refused with ORDER_ALREADY_CANCELLED (a repeat is never a second cancellation)', async () => {
    const h = build({ order: order(OrderStatus.CANCELLED), segments: [] });
    await expect(h.service.cancel('cust-1', 'order-1')).rejects.toMatchObject({ response: { details: { code: 'ORDER_ALREADY_CANCELLED' } } });
    expect(h.orderStateMachine.transitionInTransaction).not.toHaveBeenCalled();
  });

  it('if the state machine fails, nothing is committed and no post-commit effect runs', async () => {
    const h = build({ order: order(OrderStatus.PENDING), segments: [seg('s1', OrderVendorSegmentStatus.PENDING)] });
    h.orderStateMachine.transitionInTransaction.mockRejectedValueOnce(new Error('refund write failed'));
    await expect(h.service.cancel('cust-1', 'order-1')).rejects.toThrow('refund write failed');
    expect(h.calls).not.toContain('commit');
    expect(h.segmentUpdates).toEqual([]);
    expect(h.afterCommit).not.toHaveBeenCalled();
  });
});

describe('CustomerOrderCancellationService — R3: preparation no longer blocks; R40: a recorded Hatly Service purchase does', () => {
  it.each(['PREPARING', 'READY_FOR_PICKUP'] as const)('order PENDING with one vendor segment %s → cancelled (Hatly bears the preparation cost)', async (segStatus) => {
    const h = build({ order: order(OrderStatus.PENDING), segments: [seg('s1', OrderVendorSegmentStatus.CONFIRMED), seg('s2', segStatus as OrderVendorSegmentStatus)] });
    await expect(h.service.cancel('cust-1', 'order-1')).resolves.toEqual({ orderId: 'order-1' });
    expect(h.segmentUpdates).toEqual([{ set: { status: OrderVendorSegmentStatus.CANCELLED }, ids: ['s1', 's2'] }]);
  });

  it('a Hatly Service order whose driver already recorded the purchase → refused with SERVICE_PURCHASE_RECORDED, nothing changes', async () => {
    const h = build({
      order: order(OrderStatus.ASSIGNED_TO_DRIVER),
      segments: [{ id: 's1', status: OrderVendorSegmentStatus.READY_FOR_PICKUP, groupType: 'AD_HOC_SERVICE' }],
      purchasedOrderIds: ['order-1'],
    });
    await expect(h.service.cancel('cust-1', 'order-1')).rejects.toMatchObject({
      response: { details: { code: 'ORDER_NOT_CANCELLABLE_BY_CUSTOMER', reason: 'SERVICE_PURCHASE_RECORDED' } },
    });
    expect(h.orderStateMachine.transitionInTransaction).not.toHaveBeenCalled();
    expect(h.segmentUpdates).toEqual([]);
  });

  it('the same Hatly Service order before any purchase is recorded → cancelled', async () => {
    const h = build({
      order: order(OrderStatus.ASSIGNED_TO_DRIVER),
      segments: [{ id: 's1', status: OrderVendorSegmentStatus.READY_FOR_PICKUP, groupType: 'AD_HOC_SERVICE' }],
    });
    await expect(h.service.cancel('cust-1', 'order-1')).resolves.toEqual({ orderId: 'order-1' });
  });

  it('a CANCELLED segment is left as it is: the customer cancels what is left', async () => {
    const h = build({ order: order(OrderStatus.PENDING), segments: [seg('s1', OrderVendorSegmentStatus.CANCELLED), seg('s2', OrderVendorSegmentStatus.CONFIRMED)] });
    await expect(h.service.cancel('cust-1', 'order-1')).resolves.toEqual({ orderId: 'order-1' });
  });
});
