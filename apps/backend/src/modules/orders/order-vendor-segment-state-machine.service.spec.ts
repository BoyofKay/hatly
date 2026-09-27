import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrderVendorSegmentStateMachineService } from './order-vendor-segment-state-machine.service';
import { OrderVendorSegmentStatus } from './order-vendor-segment-status.enum';
import { Role } from '../../common/enums/role.enum';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderStatus } from './order-status.enum';
import { OrderVendorSegment } from './entities/order-vendor-segment.entity';

function buildHarness(
  segment: any,
  ownedBranchIds: string[],
  items: any[] = [],
  orderStatus: OrderStatus = OrderStatus.PENDING,
  // The order's OTHER segments. Default: one other still-active vendor — i.e. a cancellation here is a PARTIAL one
  // (PD-002); pass [] for the last active segment.
  siblingSegments: any[] = [{ id: 'segment-2', orderId: 'order-1', status: OrderVendorSegmentStatus.PENDING }],
) {
  const stored = { ...segment };
  // Stock-restoration writes (Group 8): one entry per `UPDATE products SET quantity = quantity + amount`.
  const restoredStock: Array<{ productId: string; amount: number }> = [];
  const manager = {
    findOne: async (EntityClass: any, _opts: any) => (EntityClass === Order ? { id: stored.orderId, status: orderStatus } : { ...stored }),
    createQueryBuilder: (EntityClass?: any) => {
      if (EntityClass === OrderItem) {
        const qb: any = { where: () => qb, getMany: async () => items };
        return qb;
      }
      const call: { productId?: string; amount?: number } = {};
      const update: any = {
        update: () => update,
        set: () => update,
        where: (_sql: string, p: { id: string }) => {
          call.productId = p.id;
          return update;
        },
        andWhere: () => update,
        setParameter: (_n: string, value: number) => {
          call.amount = value;
          return update;
        },
        execute: async () => {
          restoredStock.push({ productId: call.productId!, amount: call.amount! });
          return { affected: 1 };
        },
      };
      return update;
    },
    // CRITICAL: the real production call is the SINGLE-argument
    // `manager.save(segment)` (TypeORM infers the entity type from the
    // object itself), not `manager.save(EntityClass, entity)` — a
    // two-argument mock silently received `segment` as its own
    // `_EntityClass` param and `undefined` as `entity`, so every
    // transition here actually returned `undefined` instead of the
    // updated segment.
    save: async (entity: any) => {
      Object.assign(stored, entity);
      return entity;
    },
    // Vendor/Driver Deferred Pricing workflow. Only OrderItem is ever
    // looked up via `find` in this service — CONFIRMED regression fix:
    // without this, every existing READY_FOR_PICKUP test here would
    // throw "manager.find is not a function" the moment the new
    // unpriced-custom-item check was added. Defaults to no items
    // (nothing pending), matching every pre-existing test's implicit
    // "this segment has no custom items" assumption.
    find: async (EntityClass: any, _opts: any) =>
      EntityClass === OrderVendorSegment ? [{ ...stored }, ...siblingSegments] : items,
  };
  const dataSource = { transaction: async (cb: any) => cb(manager) };
  const vendorStaffAuthorizationService = {
    assertOwnsBranch: jest.fn(async (_userId: string, vendorBranchId: string) => {
      if (!ownedBranchIds.includes(vendorBranchId)) {
        throw new ForbiddenException('You are not authorized to act on this vendor branch.');
      }
    }),
  };
  // Fixed responses — this file tests THIS service's own logic, not
  // OrderReadinessService's or AutomaticDispatchService's, which each
  // have their own dedicated spec files.
  const orderReadinessService = { checkAndAdvance: jest.fn(async () => false) };
  const automaticDispatchService = { attemptAutomaticDispatch: jest.fn(async () => undefined) };
  // The financial consequences of a cancellation have their own dedicated specs (order-segment-cancellation.service.spec.ts,
  // order-state-machine.service.spec.ts) — this file only checks that THIS service routes to them correctly.
  const orderSegmentCancellationService = { applyPartialCancellation: jest.fn(async () => ({})) };
  const afterCommit = jest.fn(async () => undefined);
  const gate = { assertFulfilmentMayProceed: jest.fn(async () => undefined) };
  const orderStateMachine = { transitionInTransaction: jest.fn(async () => ({ order: {}, afterCommit })) };
  const service = new OrderVendorSegmentStateMachineService(
    dataSource as any,
    vendorStaffAuthorizationService as any,
    orderReadinessService as any,
    automaticDispatchService as any,
    orderStateMachine as any,
    orderSegmentCancellationService as any,
    gate as any,
  );
  return {
    service,
    stored,
    orderReadinessService,
    automaticDispatchService,
    restoredStock,
    orderSegmentCancellationService,
    orderStateMachine,
    afterCommit,
    gate,
  };
}

const baseSegment = {
  id: 'segment-1',
  orderId: 'order-1',
  vendorBranchId: 'branch-1',
  status: OrderVendorSegmentStatus.PENDING,
};

describe('OrderVendorSegmentStateMachineService', () => {
  it('allows VENDOR to confirm their own PENDING segment', async () => {
    const { service, stored } = buildHarness(baseSegment, ['branch-1']);

    const result = await service.transition({
      segmentId: 'segment-1',
      to: OrderVendorSegmentStatus.CONFIRMED,
      actorUserId: 'user-1',
      actorRole: Role.VENDOR,
    });

    expect(result.status).toBe(OrderVendorSegmentStatus.CONFIRMED);
    expect(stored.status).toBe(OrderVendorSegmentStatus.CONFIRMED);
  });

  it("rejects a vendor acting on another vendor's segment — the core cross-vendor isolation guarantee", async () => {
    const { service } = buildHarness(baseSegment, ['some-other-branch']);

    await expect(
      service.transition({
        segmentId: 'segment-1',
        to: OrderVendorSegmentStatus.CONFIRMED,
        actorUserId: 'user-2',
        actorRole: Role.VENDOR,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects an invalid transition (e.g. PENDING straight to READY_FOR_PICKUP)', async () => {
    const { service } = buildHarness(baseSegment, ['branch-1']);

    await expect(
      service.transition({
        segmentId: 'segment-1',
        to: OrderVendorSegmentStatus.READY_FOR_PICKUP,
        actorUserId: 'user-1',
        actorRole: Role.VENDOR,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a role not permitted to transition segments (e.g. DRIVER)', async () => {
    const { service } = buildHarness(baseSegment, ['branch-1']);

    await expect(
      service.transition({
        segmentId: 'segment-1',
        to: OrderVendorSegmentStatus.CONFIRMED,
        actorUserId: 'user-1',
        actorRole: Role.DRIVER,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows VENDOR/VENDOR_MANAGER to cancel even at READY_FOR_PICKUP — mirrors the confirmed order-level rule at its correct scope', async () => {
    const { service, stored } = buildHarness(
      { ...baseSegment, status: OrderVendorSegmentStatus.READY_FOR_PICKUP },
      ['branch-1'],
    );

    const result = await service.transition({
      segmentId: 'segment-1',
      to: OrderVendorSegmentStatus.CANCELLED,
      actorUserId: 'user-1',
      actorRole: Role.VENDOR_MANAGER,
    });

    expect(result.status).toBe(OrderVendorSegmentStatus.CANCELLED);
    expect(stored.status).toBe(OrderVendorSegmentStatus.CANCELLED);
  });

  it('never writes Order.status — only OrderVendorSegment fields are ever assigned', async () => {
    const { service, stored } = buildHarness(baseSegment, ['branch-1']);

    await service.transition({
      segmentId: 'segment-1',
      to: OrderVendorSegmentStatus.CONFIRMED,
      actorUserId: 'user-1',
      actorRole: Role.VENDOR,
    });

    expect(stored).not.toHaveProperty('order');
    expect((stored as any).orderStatus).toBeUndefined();
  });

  it('rejects a segment with no VendorBranch (AD_HOC_SERVICE) — nothing to authorize a vendor against', async () => {
    const { service } = buildHarness({ ...baseSegment, vendorBranchId: null }, ['branch-1']);

    await expect(
      service.transition({
        segmentId: 'segment-1',
        to: OrderVendorSegmentStatus.CONFIRMED,
        actorUserId: 'user-1',
        actorRole: Role.VENDOR,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException for a non-existent segment', async () => {
    const manager = { findOne: async () => null, save: async (_: any, e: any) => e };
    const dataSource = { transaction: async (cb: any) => cb(manager) };
    const service = new OrderVendorSegmentStateMachineService(dataSource as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);

    await expect(
      service.transition({
        segmentId: 'missing',
        to: OrderVendorSegmentStatus.CONFIRMED,
        actorUserId: 'user-1',
        actorRole: Role.VENDOR,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('accepts and stores an optional expectedReadyAt alongside the transition', async () => {
    const { service, stored } = buildHarness(baseSegment, ['branch-1']);
    const readyAt = new Date('2026-01-01T19:00:00Z');

    await service.transition({
      segmentId: 'segment-1',
      to: OrderVendorSegmentStatus.CONFIRMED,
      actorUserId: 'user-1',
      actorRole: Role.VENDOR,
      expectedReadyAt: readyAt,
    });

    expect(stored.expectedReadyAt).toEqual(readyAt);
  });

  it('PHASE 4: triggers OrderReadinessService.checkAndAdvance when a segment reaches READY_FOR_PICKUP', async () => {
    const { service, orderReadinessService } = buildHarness(
      { ...baseSegment, status: OrderVendorSegmentStatus.PREPARING },
      ['branch-1'],
    );

    await service.transition({
      segmentId: 'segment-1',
      to: OrderVendorSegmentStatus.READY_FOR_PICKUP,
      actorUserId: 'user-1',
      actorRole: Role.VENDOR,
    });

    expect(orderReadinessService.checkAndAdvance).toHaveBeenCalledWith('order-1');
  });

  it('PHASE 4: does NOT trigger readiness/dispatch for a transition other than reaching READY_FOR_PICKUP', async () => {
    const { service, orderReadinessService, automaticDispatchService } = buildHarness(baseSegment, ['branch-1']);

    await service.transition({
      segmentId: 'segment-1',
      to: OrderVendorSegmentStatus.CONFIRMED,
      actorUserId: 'user-1',
      actorRole: Role.VENDOR,
    });

    expect(orderReadinessService.checkAndAdvance).not.toHaveBeenCalled();
    expect(automaticDispatchService.attemptAutomaticDispatch).not.toHaveBeenCalled();
  });

  it('PHASE 4: attempts automatic dispatch only when checkAndAdvance reports the order JUST became fully ready', async () => {
    const { service, automaticDispatchService } = buildHarness(
      { ...baseSegment, status: OrderVendorSegmentStatus.PREPARING },
      ['branch-1'],
    );
    // Override the default fixed response for this one test.
    (service as any).orderReadinessService.checkAndAdvance = jest.fn(async () => true);

    await service.transition({
      segmentId: 'segment-1',
      to: OrderVendorSegmentStatus.READY_FOR_PICKUP,
      actorUserId: 'user-1',
      actorRole: Role.VENDOR,
    });

    expect(automaticDispatchService.attemptAutomaticDispatch).toHaveBeenCalledWith('order-1');
  });
});

describe('OrderVendorSegmentStateMachineService — Vendor/Driver Deferred Pricing workflow gate', () => {
  it('CRITICAL: Vendor cannot mark READY_FOR_PICKUP while an unpriced custom item exists', async () => {
    const { service } = buildHarness(
      { ...baseSegment, status: OrderVendorSegmentStatus.PREPARING },
      ['branch-1'],
      [{ id: 'item-1', productId: null, actualAmountMinor: null }],
    );

    await expect(
      service.transition({
        segmentId: 'segment-1',
        to: OrderVendorSegmentStatus.READY_FOR_PICKUP,
        actorUserId: 'user-1',
        actorRole: Role.VENDOR,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('Vendor can mark READY_FOR_PICKUP once the (single) custom item has been priced', async () => {
    const { service, stored } = buildHarness(
      { ...baseSegment, status: OrderVendorSegmentStatus.PREPARING },
      ['branch-1'],
      [{ id: 'item-1', productId: null, actualAmountMinor: 5000 }],
    );

    await service.transition({
      segmentId: 'segment-1',
      to: OrderVendorSegmentStatus.READY_FOR_PICKUP,
      actorUserId: 'user-1',
      actorRole: Role.VENDOR,
    });

    expect(stored.status).toBe(OrderVendorSegmentStatus.READY_FOR_PICKUP);
  });

  it('CRITICAL: multiple custom items must ALL be priced — one unpriced item among several still blocks READY', async () => {
    const { service } = buildHarness(
      { ...baseSegment, status: OrderVendorSegmentStatus.PREPARING },
      ['branch-1'],
      [
        { id: 'item-1', productId: null, actualAmountMinor: 5000 },
        { id: 'item-2', productId: null, actualAmountMinor: null },
      ],
    );

    await expect(
      service.transition({
        segmentId: 'segment-1',
        to: OrderVendorSegmentStatus.READY_FOR_PICKUP,
        actorUserId: 'user-1',
        actorRole: Role.VENDOR,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows READY_FOR_PICKUP once every custom item among several has been priced', async () => {
    const { service, stored } = buildHarness(
      { ...baseSegment, status: OrderVendorSegmentStatus.PREPARING },
      ['branch-1'],
      [
        { id: 'item-1', productId: null, actualAmountMinor: 5000 },
        { id: 'item-2', productId: null, actualAmountMinor: 2000 },
      ],
    );

    await service.transition({
      segmentId: 'segment-1',
      to: OrderVendorSegmentStatus.READY_FOR_PICKUP,
      actorUserId: 'user-1',
      actorRole: Role.VENDOR,
    });

    expect(stored.status).toBe(OrderVendorSegmentStatus.READY_FOR_PICKUP);
  });

  it('existing normal catalog-only Ready behavior remains unchanged (no custom items at all)', async () => {
    const { service, stored } = buildHarness(
      { ...baseSegment, status: OrderVendorSegmentStatus.PREPARING },
      ['branch-1'],
      [{ id: 'item-1', productId: 'real-product-1', actualAmountMinor: null }],
    );

    await service.transition({
      segmentId: 'segment-1',
      to: OrderVendorSegmentStatus.READY_FOR_PICKUP,
      actorUserId: 'user-1',
      actorRole: Role.VENDOR,
    });

    expect(stored.status).toBe(OrderVendorSegmentStatus.READY_FOR_PICKUP);
  });

  it('the unpriced-custom-item gate does not apply to transitions other than READY_FOR_PICKUP', async () => {
    const { service, stored } = buildHarness(
      { ...baseSegment, status: OrderVendorSegmentStatus.CONFIRMED },
      ['branch-1'],
      [{ id: 'item-1', productId: null, actualAmountMinor: null }],
    );

    await service.transition({
      segmentId: 'segment-1',
      to: OrderVendorSegmentStatus.PREPARING,
      actorUserId: 'user-1',
      actorRole: Role.VENDOR,
    });

    expect(stored.status).toBe(OrderVendorSegmentStatus.PREPARING);
  });
});

describe('OrderVendorSegmentStateMachineService — stock restoration on segment cancellation (Group 8 regression)', () => {
  const pieceItem = { id: 'i1', productId: 'prod-1', quantity: 3, pricingUnitSnapshot: 'PIECE', requestedWeightGrams: null };
  const weightItem = { id: 'i2', productId: 'prod-2', quantity: 1, pricingUnitSnapshot: 'WEIGHT', requestedWeightGrams: 750 };
  const customItem = { id: 'i3', productId: null, quantity: 1, pricingUnitSnapshot: null, requestedWeightGrams: null };
  const cancel = (h: ReturnType<typeof buildHarness>) =>
    h.service.transition({ segmentId: 'segment-1', to: OrderVendorSegmentStatus.CANCELLED, actorUserId: 'u1', actorRole: Role.VENDOR });

  it('gives back the units (PIECE) and grams (WEIGHT) of the cancelled segment, and nothing for a custom item', async () => {
    const h = buildHarness(baseSegment, ['branch-1'], [pieceItem, weightItem, customItem]);
    await cancel(h);
    expect(h.restoredStock).toEqual([
      { productId: 'prod-1', amount: 3 },
      { productId: 'prod-2', amount: 750 },
    ]);
    expect(h.stored.status).toBe(OrderVendorSegmentStatus.CANCELLED);
  });

  it.each([OrderStatus.CANCELLED, OrderStatus.FAILED_DELIVERY, OrderStatus.DELIVERED, OrderStatus.PICKED_UP, OrderStatus.ON_THE_WAY])(
    'refuses ANY segment change once the order is %s, and restores nothing (order-level cancellation already did, or the goods are gone)',
    async (orderStatus) => {
      const h = buildHarness(baseSegment, ['branch-1'], [pieceItem], orderStatus);
      await expect(cancel(h)).rejects.toMatchObject({ response: { details: { code: 'ORDER_NOT_ACTIVE_FOR_VENDOR', status: orderStatus } } });
      await expect(
        h.service.transition({ segmentId: 'segment-1', to: OrderVendorSegmentStatus.CONFIRMED, actorUserId: 'u1', actorRole: Role.VENDOR }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(h.restoredStock).toEqual([]);
      expect(h.stored.status).toBe(OrderVendorSegmentStatus.PENDING);
    },
  );

  it('restores nothing for a non-cancelling transition', async () => {
    const h = buildHarness(baseSegment, ['branch-1'], [pieceItem]);
    await h.service.transition({ segmentId: 'segment-1', to: OrderVendorSegmentStatus.CONFIRMED, actorUserId: 'u1', actorRole: Role.VENDOR });
    expect(h.restoredStock).toEqual([]);
  });
});

describe('OrderVendorSegmentStateMachineService — financial routing of a segment cancellation (PD-002)', () => {
  const cancel = (h: ReturnType<typeof buildHarness>, role: Role = Role.VENDOR) =>
    h.service.transition({ segmentId: 'segment-1', to: OrderVendorSegmentStatus.CANCELLED, actorUserId: 'u1', actorRole: role });

  it('other vendors still active → partial cancellation: totals/refund handled, the ORDER is not cancelled', async () => {
    const h = buildHarness(baseSegment, ['branch-1']);
    await cancel(h);
    expect(h.orderSegmentCancellationService.applyPartialCancellation).toHaveBeenCalledTimes(1);
    expect(h.orderStateMachine.transitionInTransaction).not.toHaveBeenCalled();
    // the readiness check runs so a now-fully-ready remainder moves on
    expect(h.orderReadinessService.checkAndAdvance).toHaveBeenCalledWith('order-1');
  });

  it('the LAST active segment → the whole order is cancelled in the same transaction, with the vendor as actor, and no partial recalculation', async () => {
    const h = buildHarness(baseSegment, ['branch-1'], [], OrderStatus.CONFIRMED, []);
    await cancel(h, Role.VENDOR_MANAGER);
    expect(h.orderSegmentCancellationService.applyPartialCancellation).not.toHaveBeenCalled();
    expect(h.orderStateMachine.transitionInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.VENDOR_MANAGER, actorUserId: 'u1' }),
    );
    expect(h.afterCommit).toHaveBeenCalledTimes(1); // post-commit effects (push, financial events) run once, after commit
  });

  it('already-cancelled siblings do not count as active: cancelling the only remaining one cancels the order', async () => {
    const h = buildHarness(baseSegment, ['branch-1'], [], OrderStatus.PENDING, [
      { id: 'segment-2', orderId: 'order-1', status: OrderVendorSegmentStatus.CANCELLED },
    ]);
    await cancel(h);
    expect(h.orderStateMachine.transitionInTransaction).toHaveBeenCalledTimes(1);
  });

  it('cancelling the last segment is refused (409) once a driver is assigned — the order can no longer be cancelled then', async () => {
    const h = buildHarness(baseSegment, ['branch-1'], [], OrderStatus.ASSIGNED_TO_DRIVER, []);
    await expect(cancel(h)).rejects.toMatchObject({ response: { details: { code: 'ORDER_ASSIGNED_CANNOT_CANCEL_LAST_SEGMENT' } } });
    expect(h.orderStateMachine.transitionInTransaction).not.toHaveBeenCalled();
    expect(h.restoredStock).toEqual([]);
  });

  it('a partial cancellation after a driver is assigned is still allowed (the other vendors carry on)', async () => {
    const h = buildHarness(baseSegment, ['branch-1'], [], OrderStatus.ASSIGNED_TO_DRIVER);
    await cancel(h);
    expect(h.orderSegmentCancellationService.applyPartialCancellation).toHaveBeenCalledTimes(1);
  });

  it('a non-cancelling transition never touches the financial services', async () => {
    const h = buildHarness(baseSegment, ['branch-1']);
    await h.service.transition({ segmentId: 'segment-1', to: OrderVendorSegmentStatus.CONFIRMED, actorUserId: 'u1', actorRole: Role.VENDOR });
    expect(h.orderSegmentCancellationService.applyPartialCancellation).not.toHaveBeenCalled();
    expect(h.orderStateMachine.transitionInTransaction).not.toHaveBeenCalled();
    expect(h.orderReadinessService.checkAndAdvance).not.toHaveBeenCalled();
  });
});

describe('OrderVendorSegmentStateMachineService — payment gating (PD-006)', () => {
  const move = (h: ReturnType<typeof buildHarness>, to: OrderVendorSegmentStatus) =>
    h.service.transition({ segmentId: 'segment-1', to, actorUserId: 'u1', actorRole: Role.VENDOR });

  it('starting PREPARING asks the gate about the PARENT order; a refusal aborts and the segment keeps its status', async () => {
    const h = buildHarness({ ...baseSegment, status: OrderVendorSegmentStatus.CONFIRMED }, ['branch-1']);
    h.gate.assertFulfilmentMayProceed.mockRejectedValueOnce(new BadRequestException({ message: 'no', details: { code: 'PAYMENT_NOT_APPROVED' } }));
    await expect(move(h, OrderVendorSegmentStatus.PREPARING)).rejects.toMatchObject({ response: { details: { code: 'PAYMENT_NOT_APPROVED' } } });
    expect(h.stored.status).toBe(OrderVendorSegmentStatus.CONFIRMED);
    expect((h.gate.assertFulfilmentMayProceed.mock.calls as any[][])[0][1]).toMatchObject({ id: 'order-1' });
  });

  it('with an approving gate PREPARING goes through', async () => {
    const h = buildHarness({ ...baseSegment, status: OrderVendorSegmentStatus.CONFIRMED }, ['branch-1']);
    await move(h, OrderVendorSegmentStatus.PREPARING);
    expect(h.stored.status).toBe(OrderVendorSegmentStatus.PREPARING);
  });

  it('accepting (CONFIRMED) and cancelling are never gated — a vendor may accept an order awaiting payment', async () => {
    const h = buildHarness(baseSegment, ['branch-1']);
    await move(h, OrderVendorSegmentStatus.CONFIRMED);
    expect(h.gate.assertFulfilmentMayProceed).not.toHaveBeenCalled();
    const c = buildHarness(baseSegment, ['branch-1']);
    await move(c, OrderVendorSegmentStatus.CANCELLED);
    expect(c.gate.assertFulfilmentMayProceed).not.toHaveBeenCalled();
  });
});
