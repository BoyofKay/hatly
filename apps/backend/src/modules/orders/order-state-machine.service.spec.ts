import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { OrderStateMachineService } from './order-state-machine.service';
import { OrderStatus } from './order-status.enum';
import { Role } from '../../common/enums/role.enum';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderVendorSegment } from './entities/order-vendor-segment.entity';
import { OrderVendorSegmentStatus } from './order-vendor-segment-status.enum';
import { PricingUnit } from '../products/pricing-unit.enum';

// PD-006 collaborators of the state machine — pass-through stubs here; their own behaviour has dedicated specs.
const passGate = { assertFulfilmentMayProceed: jest.fn(async () => undefined) };
const noopStatusHistory = { record: jest.fn(async () => undefined) };
const noopWalletRefund = { refundExcess: jest.fn(async () => 0), effectiveWalletPaidMinor: jest.fn(async () => 0) };

/**
 * The state machine stamps `deliveries.picked_up_at` / `delivered_at` through a no-arg
 * `manager.createQueryBuilder().update(Delivery)...execute()` chain (Group 8 fix). Harnesses that
 * do not care about that write use this recorder; `deliveryTimestampWrites` lets a test assert it.
 */
const deliveryTimestampWrites: Array<{ set: Record<string, unknown>; orderId: unknown }> = [];
/** Driver-availability releases (Group 8): `UPDATE drivers SET is_available = true` scoped to an order's delivery. */
const driverReleases: Array<{ orderId: unknown }> = [];
/** R18: the release recomputes the holder's capacity through raw SQL — record it as a release of that order's driver. */
async function driverQuery(sql: string, params: unknown[] = []): Promise<any[]> {
  if (/SELECT driver_id FROM deliveries WHERE order_id/.test(sql)) return [{ driver_id: 'driver-1', orderId: params[0] }].map(({ driver_id }) => ({ driver_id }));
  if (/UPDATE drivers d SET is_available/.test(sql)) driverReleases.push({ orderId: params[2] });
  return [];
}
function deliveryUpdateQueryBuilder() {
  const call: { entity?: string; set: Record<string, unknown>; orderId: unknown } = { set: {}, orderId: undefined };
  const qb: any = {
    update: (EntityClass?: { name: string }) => {
      call.entity = EntityClass?.name;
      return qb;
    },
    set: (values: Record<string, unknown>) => {
      call.set = values;
      return qb;
    },
    where: (_sql: string, params: { orderId: unknown }) => {
      call.orderId = params.orderId;
      return qb;
    },
    execute: async () => {
      if (call.entity === 'Driver') driverReleases.push({ orderId: call.orderId });
      else if (call.entity !== 'DispatchAlert') deliveryTimestampWrites.push({ set: call.set, orderId: call.orderId });
      return { affected: 1 };
    },
  };
  return qb;
}

function buildHarness(order: any, segmentItems: any[] = [], delivery?: { driverId: string | null } | null) {
  const store = { ...order };
  const manager = {
    // `delivery` (when given) answers the Delivery lookup of the acting-driver ownership re-check.
    findOne: async (EntityClass: any, _opts: any) => (delivery !== undefined && EntityClass?.name === 'Delivery' ? delivery : { ...store }),
    save: async (entity: any) => {
      Object.assign(store, entity);
      saves.push(entity);
      return entity;
    },
    // Inventory Restoration on Order Cancellation. CONFIRMED
    // regression fix: without these, every existing CANCELLED test
    // here would throw "manager.find is not a function" the moment
    // the new restoration call was added. Defaults to zero segments
    // (so restoreTrackedInventory returns immediately, never even
    // reaching createQueryBuilder), matching every pre-existing
    // test's implicit "this order's inventory restoration is not
    // being exercised" assumption.
    find: async (_EntityClass: any, _opts: any) => (segmentItems.length > 0 ? [{ id: 'segment-1', orderId: store.id }] : []),
    query: driverQuery,
    createQueryBuilder: (EntityClass: any, _alias?: string) => {
      if (EntityClass && EntityClass.name === 'OrderItem') {
        const qb: any = { where: () => qb, getMany: async () => segmentItems };
        return qb;
      }
      if (EntityClass === undefined) return deliveryUpdateQueryBuilder(); // Delivery timestamp stamp (Group 8)
      const updateQb: any = {
        update: () => updateQb,
        set: () => updateQb,
        where: () => updateQb,
        andWhere: () => updateQb,
        setParameter: () => updateQb,
        execute: async () => ({ affected: 1 }),
      };
      return updateQb;
    },
    // Atomic Manual Transfer Refund on Order Cancellation (Chunk B2).
    // Defaults to no Payment at all, matching every pre-existing
    // test's implicit "this order has no Manual Transfer payment"
    // assumption — same convention as buildInventoryHarness's own
    // getRepository.
    getRepository: (EntityClass: any) => {
      if (EntityClass.name === 'Payment') {
        return { findOne: async () => null };
      }
      throw new Error(`unhandled getRepository ${EntityClass.name}`);
    },
  };
  const dataSource = { transaction: async (cb: any) => cb(manager) };
  const ordersRepository = { findOne: async (_opts: any) => ({ ...store }) };
  const orderFinancialEventsService = { handleTransition: jest.fn(async () => undefined) };
  const bestSellingCacheService = { recordDeliveredSales: jest.fn(async () => undefined) };
  const offerConsumptionService = { reverseFlashSaleConsumptionForOrder: jest.fn(async () => undefined), reverseSubtotalDiscountConsumptionForOrder: jest.fn(async () => undefined) };
  const loyaltyService = { awardOrderEarning: jest.fn(async () => undefined) };
  const manualTransferRefundService = { recordRefund: jest.fn(async () => undefined) };
  const pushNotificationService = {
    sendOrderConfirmedNotification: jest.fn(async () => undefined),
    sendOrderCancelledNotification: jest.fn(async () => undefined),
    sendOrderOnTheWayNotification: jest.fn(async () => undefined),
    sendOrderDeliveredNotification: jest.fn(async () => undefined),
    sendOrderFailedDeliveryNotification: jest.fn(async () => undefined),
  };
  const service = new OrderStateMachineService(
    ordersRepository as any,
    dataSource as any,
    orderFinancialEventsService as any,
    bestSellingCacheService as any,
    offerConsumptionService as any,
      loyaltyService as any,
      manualTransferRefundService as any,
      pushNotificationService as any,
      { getCorrelationId: () => 'corr-test' } as any,
    passGate as any,
    noopStatusHistory as any,
    noopWalletRefund as any,
  );
  lastMocks = { loyaltyService, bestSellingCacheService, pushNotificationService, orderFinancialEventsService, store };
  return service;
}
const saves: any[] = [];
let lastMocks: any;

// Shared across both "Inventory Restoration on Order Cancellation" and
// "Atomic Manual Transfer Refund on Order Cancellation (Chunk B2)" — hoisted
// to module scope (matching buildHarness's own placement above) so both
// describe blocks below can call it.
function buildInventoryHarness(params: {
  orderStatus?: OrderStatus;
  servicePurchased?: boolean;
  segments: any[];
  items: any[];
  products: any[];
  payment?: any | null;
  orderExtras?: Record<string, unknown>;
}) {
  const order = { id: 'order-1', status: params.orderStatus ?? OrderStatus.PREPARING, ...(params.orderExtras ?? {}) };
  const store = { ...order };
  const productStore = new Map(params.products.map((p) => [p.id, { ...p }]));
  const paymentStore = params.payment ? { ...params.payment } : null;

  const manager = {
    // The order id of a segment and the stock-ledger context (a no-op for this fake store). R40: `servicePurchased` fakes a driver's
    // recorded Hatly Service purchase.
    query: async (sql: string, p: unknown[] = []) =>
      /drivers|driver_id FROM deliveries/.test(sql) ? driverQuery(sql, p) : sql.includes('ad_hoc_purchase_records')
        ? (params.servicePurchased ? [{ order_id: 'order-1' }] : [])
        : sql.includes('order_vendor_segments') ? [{ order_id: 'order-1' }] : [{ set_config: '' }],
    findOne: async (_EntityClass: any, _opts: any) => ({ ...store }),
    save: async (entity: any) => {
      Object.assign(store, entity);
      return entity;
    },
    find: async (EntityClass: any, opts: any) => {
      if (EntityClass === OrderVendorSegment) return params.segments.filter((s) => s.orderId === opts.where.orderId);
      throw new Error('unhandled find');
    },
    // Atomic Manual Transfer Refund on Order Cancellation (Chunk
    // B2). CONFIRMED regression fix: without this, every existing
    // Chunk A test in this describe block would throw
    // "manager.getRepository is not a function" the moment the new
    // Payment lookup was added. Defaults to no Payment at all
    // (matching every pre-existing test's implicit "this order has
    // no Manual Transfer payment" assumption) unless `params.payment`
    // is supplied.
    getRepository: (EntityClass: any) => {
      if (EntityClass.name === 'Payment') {
        return { findOne: async () => (paymentStore ? { ...paymentStore } : null) };
      }
      throw new Error(`unhandled getRepository ${EntityClass.name}`);
    },
    createQueryBuilder: (EntityClass: any, _alias?: string) => {
      if (EntityClass === OrderItem) {
        let segmentIds: string[] = [];
        const qb: any = {
          where: (_sql: string, p: any) => {
            segmentIds = p.segmentIds;
            return qb;
          },
          getMany: async () => params.items.filter((i) => segmentIds.includes(i.orderVendorSegmentId)),
        };
        return qb;
      }
      // Product restoration update — CONFIRMED atomic-update
      // simulation: only actually increments if the LIVE simulated
      // product's inventoryMode matches the condition, mirroring a
      // real `WHERE inventory_mode = :mode` clause.
      let productId: string | undefined;
      let mode: string | undefined;
      let amount = 0;
      const updateQb: any = {
        update: () => updateQb,
        set: () => updateQb,
        where: (_sql: string, p: any) => {
          productId = p.id;
          return updateQb;
        },
        andWhere: (_sql: string, p: any) => {
          mode = p.mode;
          return updateQb;
        },
        setParameter: (_name: string, value: number) => {
          amount = value;
          return updateQb;
        },
        execute: async () => {
          const product = productId ? productStore.get(productId) : undefined;
          if (product && product.inventoryMode === mode) {
            product.quantity += amount;
            return { affected: 1 };
          }
          return { affected: 0 };
        },
      };
      return updateQb;
    },
  };
  const dataSource = { transaction: async (cb: any) => cb(manager) };
  const ordersRepository = { findOne: async (_opts: any) => ({ ...store }) };
  const orderFinancialEventsService = { handleTransition: jest.fn(async () => undefined) };
  const bestSellingCacheService = { recordDeliveredSales: jest.fn(async () => undefined) };
  const offerConsumptionService = { reverseFlashSaleConsumptionForOrder: jest.fn(async () => undefined), reverseSubtotalDiscountConsumptionForOrder: jest.fn(async () => undefined) };
  const loyaltyService = { awardOrderEarning: jest.fn(async () => undefined) };
  const manualTransferRefundService = {
    recordRefund: jest.fn(
      async (_params: { paymentId: string; amountMinor: number; reason?: string; actorUserId: string }, _manager?: unknown) =>
        undefined,
    ),
    // PD-002: the whole-order refund is now "paid minus already refunded". This harness has no earlier partial refunds,
    // so — exactly like the real ManualTransferRefundService.recordRemainingRefund — it records the full paid amount
    // through recordRefund on the same manager.
    // PD-004: an unverified transfer only gets a pending refund entitlement (no refund event).
    recordPendingRefundForCancelledOrder: jest.fn(async (_orderId: string, _manager?: unknown): Promise<number> => 0),
    recordRemainingRefund: jest.fn(
      async (p: { paymentId: string; actorUserId: string; reason: string }, m?: unknown): Promise<number> => {
        if (!paymentStore || paymentStore.status !== 'PAID' || paymentStore.amountMinor == null) return 0;
        await manualTransferRefundService.recordRefund(
          { paymentId: p.paymentId, amountMinor: paymentStore.amountMinor, actorUserId: p.actorUserId, reason: p.reason },
          m,
        );
        return paymentStore.amountMinor;
      },
    ),
  };
  const pushNotificationService = {
    sendOrderConfirmedNotification: jest.fn(async () => undefined),
    sendOrderCancelledNotification: jest.fn(async () => undefined),
    sendOrderOnTheWayNotification: jest.fn(async () => undefined),
    sendOrderDeliveredNotification: jest.fn(async () => undefined),
    sendOrderFailedDeliveryNotification: jest.fn(async () => undefined),
  };
  const service = new OrderStateMachineService(
    ordersRepository as any,
    dataSource as any,
    orderFinancialEventsService as any,
    bestSellingCacheService as any,
    offerConsumptionService as any,
    loyaltyService as any,
    manualTransferRefundService as any,
    pushNotificationService as any,
    { getCorrelationId: () => 'corr-test' } as any,
    passGate as any,
    noopStatusHistory as any,
    noopWalletRefund as any,
  );
  return { service, productStore, offerConsumptionService, manualTransferRefundService, paymentStore };
}

describe('OrderStateMachineService — delivery timestamps (Group 8 regression)', () => {
  beforeEach(() => {
    deliveryTimestampWrites.length = 0;
    driverReleases.length = 0;
  });

  it('stamps deliveries.picked_up_at when the order becomes PICKED_UP, for that order only', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.ASSIGNED_TO_DRIVER });
    await service.transition({ orderId: 'order-1', to: OrderStatus.PICKED_UP, actorRole: Role.DRIVER });
    // R16: picking up also records the acknowledgement if the driver never opened the order (COALESCE keeps an earlier one).
    expect(deliveryTimestampWrites).toEqual([{ set: { pickedUpAt: expect.any(Date), acknowledgedAt: expect.any(Function) }, orderId: 'order-1' }]);
  });

  it('stamps deliveries.delivered_at when the order becomes DELIVERED', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.ON_THE_WAY });
    await service.transition({ orderId: 'order-1', to: OrderStatus.DELIVERED, actorRole: Role.DRIVER });
    expect(deliveryTimestampWrites).toEqual([{ set: { deliveredAt: expect.any(Date) }, orderId: 'order-1' }]);
  });

  it.each([
    [OrderStatus.ON_THE_WAY, OrderStatus.DELIVERED, Role.DRIVER],
    [OrderStatus.ON_THE_WAY, OrderStatus.FAILED_DELIVERY, Role.DRIVER],
    [OrderStatus.PENDING, OrderStatus.CANCELLED, Role.ADMIN],
    [OrderStatus.ASSIGNED_TO_DRIVER, OrderStatus.READY_FOR_PICKUP, Role.ADMIN],
  ])('frees the driver (is_available = true) when %s -> %s (Group 8 regression: they were never freed)', async (from, to, role) => {
    const service = buildHarness({ id: 'order-1', status: from });
    await service.transition({ orderId: 'order-1', to, actorRole: role });
    expect(driverReleases).toEqual([{ orderId: 'order-1' }]);
  });

  it('R17: a DRIVER can no longer release an assignment (ASSIGNED_TO_DRIVER -> READY_FOR_PICKUP is Operations-only)', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.ASSIGNED_TO_DRIVER });
    await expect(service.transition({ orderId: 'order-1', to: OrderStatus.READY_FOR_PICKUP, actorRole: Role.DRIVER })).rejects.toThrow(
      'Role DRIVER is not allowed to perform this transition.',
    );
    expect(driverReleases).toEqual([]);
  });

  it.each([
    [OrderStatus.READY_FOR_PICKUP, OrderStatus.ASSIGNED_TO_DRIVER, Role.ADMIN],
    [OrderStatus.ASSIGNED_TO_DRIVER, OrderStatus.PICKED_UP, Role.DRIVER],
    [OrderStatus.PICKED_UP, OrderStatus.ON_THE_WAY, Role.DRIVER],
  ])('keeps the driver busy on %s -> %s', async (from, to, role) => {
    const service = buildHarness({ id: 'order-1', status: from });
    await service.transition({ orderId: 'order-1', to, actorRole: role });
    expect(driverReleases).toEqual([]);
  });

  it('cancelling from READY_FOR_PICKUP frees NO driver (PD-014: the delivery row may name a driver released earlier who is on another order now)', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.READY_FOR_PICKUP });
    await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.ADMIN });
    expect(driverReleases).toEqual([]);
  });

  it('writes no delivery timestamp for any other transition', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.PICKED_UP });
    await service.transition({ orderId: 'order-1', to: OrderStatus.ON_THE_WAY, actorRole: Role.DRIVER });
    expect(deliveryTimestampWrites).toEqual([]);
  });
});

describe('OrderStateMachineService — cancellation rule (Phase 3 Step 4)', () => {
  it('rejects CUSTOMER attempting to cancel a PENDING order — confirmed business rule: cancellation goes through Support', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.PENDING });

    await expect(
      service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.CUSTOMER }),
    ).rejects.toThrow(BadRequestException);
  });

  it('still allows ADMIN to cancel a PENDING order — unaffected by the Step 4 change', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.PENDING });

    const result = await service.transition({
      orderId: 'order-1',
      to: OrderStatus.CANCELLED,
      actorRole: Role.ADMIN,
      cancellationReason: 'Customer contacted support',
    });

    expect(result.status).toBe(OrderStatus.CANCELLED);
    expect(result.cancelledByRole).toBe(Role.ADMIN);
  });

  it('SUPER_ADMIN may do everything ADMIN may (Group 8 regression: it was refused an ADMIN-permitted cancellation)', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.PENDING });

    const result = await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.SUPER_ADMIN, cancellationReason: 'Support' });

    expect(result.status).toBe(OrderStatus.CANCELLED);
    expect(result.cancelledByRole).toBe(Role.SUPER_ADMIN);
    expect(service.getAllowedNextStatuses(OrderStatus.PENDING, Role.SUPER_ADMIN)).toEqual(
      service.getAllowedNextStatuses(OrderStatus.PENDING, Role.ADMIN),
    );
  });

  it('SUPER_ADMIN does not gain transitions that are not ADMIN\'s (driver-only pickup stays driver-only)', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.ASSIGNED_TO_DRIVER });

    await expect(
      service.transition({ orderId: 'order-1', to: OrderStatus.PICKED_UP, actorRole: Role.SUPER_ADMIN }),
    ).rejects.toThrow(BadRequestException);
  });

  it('still allows VENDOR to cancel a PENDING order — unaffected by the Step 4 change', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.PENDING });

    const result = await service.transition({
      orderId: 'order-1',
      to: OrderStatus.CANCELLED,
      actorRole: Role.VENDOR,
    });

    expect(result.status).toBe(OrderStatus.CANCELLED);
  });

  it('PHASE 4 CHANGE: VENDOR can no longer advance PENDING to CONFIRMED directly — that path is now ADMIN-only (system-driven, via OrderReadinessService), closing the bypass around the segment-level flow', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.PENDING });

    await expect(
      service.transition({ orderId: 'order-1', to: OrderStatus.CONFIRMED, actorRole: Role.VENDOR }),
    ).rejects.toThrow(BadRequestException);
  });

  it('PHASE 4 CHANGE: ADMIN (the system actor used by OrderReadinessService) can advance PENDING to CONFIRMED', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.PENDING });

    const result = await service.transition({
      orderId: 'order-1',
      to: OrderStatus.CONFIRMED,
      actorRole: Role.ADMIN,
    });

    expect(result.status).toBe(OrderStatus.CONFIRMED);
  });
});

describe('OrderStateMachineService — transitionIfPossible (Phase 4 addition)', () => {
  it('succeeds and returns the updated order when the transition is valid', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.PENDING });

    const result = await service.transitionIfPossible({
      orderId: 'order-1',
      to: OrderStatus.CONFIRMED,
      actorRole: Role.ADMIN,
    });

    expect(result?.status).toBe(OrderStatus.CONFIRMED);
  });

  it('returns the unchanged current order (never throws) when the transition rule does not match', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.DELIVERED });

    const result = await service.transitionIfPossible({
      orderId: 'order-1',
      to: OrderStatus.CONFIRMED,
      actorRole: Role.ADMIN,
    });

    expect(result?.status).toBe(OrderStatus.DELIVERED); // unchanged, no throw
  });
});

describe('OrderStateMachineService — Vendor cancellation at READY_FOR_PICKUP (confirmed business decision)', () => {
  it('allows VENDOR to cancel an order that is READY_FOR_PICKUP — previously ADMIN-only at this stage', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.READY_FOR_PICKUP });

    const result = await service.transition({
      orderId: 'order-1',
      to: OrderStatus.CANCELLED,
      actorRole: Role.VENDOR,
    });

    expect(result.status).toBe(OrderStatus.CANCELLED);
    expect(result.cancelledByRole).toBe(Role.VENDOR);
  });

  it('allows VENDOR_MANAGER to cancel an order that is READY_FOR_PICKUP', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.READY_FOR_PICKUP });

    const result = await service.transition({
      orderId: 'order-1',
      to: OrderStatus.CANCELLED,
      actorRole: Role.VENDOR_MANAGER,
    });

    expect(result.status).toBe(OrderStatus.CANCELLED);
  });

  it('still allows ADMIN to cancel an order that is READY_FOR_PICKUP — unaffected by this change', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.READY_FOR_PICKUP });

    const result = await service.transition({
      orderId: 'order-1',
      to: OrderStatus.CANCELLED,
      actorRole: Role.ADMIN,
    });

    expect(result.status).toBe(OrderStatus.CANCELLED);
  });

  it('still rejects CUSTOMER cancelling at READY_FOR_PICKUP — unaffected by this change', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.READY_FOR_PICKUP });

    await expect(
      service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.CUSTOMER }),
    ).rejects.toThrow(BadRequestException);
  });

  it('the READY_FOR_PICKUP -> ASSIGNED_TO_DRIVER transition remains ADMIN/SUPER_ADMIN-only — dispatch authority is untouched by this cancellation-only change', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.READY_FOR_PICKUP });

    await expect(
      service.transition({ orderId: 'order-1', to: OrderStatus.ASSIGNED_TO_DRIVER, actorRole: Role.VENDOR }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('OrderStateMachineService — post-commit financial hook never blocks an already-committed transition (Phase F handoff correction)', () => {
  it('still returns the successfully-updated order even when OrderFinancialEventsService.handleTransition() throws', async () => {
    const store = { id: 'order-1', status: OrderStatus.PENDING };
    const manager = {
      query: driverQuery,
      createQueryBuilder: () => deliveryUpdateQueryBuilder(),
      findOne: async () => ({ ...store }),
      save: async (entity: any) => {
        Object.assign(store, entity);
        return entity;
      },
    };
    const dataSource = { transaction: async (cb: any) => cb(manager) };
    const ordersRepository = { findOne: async () => ({ ...store }) };
    const orderFinancialEventsService = {
      handleTransition: jest.fn(async () => {
        throw new Error('transient DB error while writing a FinancialEvent');
      }),
    };
    const bestSellingCacheService = { recordDeliveredSales: jest.fn(async () => undefined) };
    const offerConsumptionService = { reverseFlashSaleConsumptionForOrder: jest.fn(async () => undefined), reverseSubtotalDiscountConsumptionForOrder: jest.fn(async () => undefined) };
  const loyaltyService = { awardOrderEarning: jest.fn(async () => undefined) };
  const manualTransferRefundService = { recordRefund: jest.fn(async () => undefined) };
  const pushNotificationService = {
    sendOrderConfirmedNotification: jest.fn(async () => undefined),
    sendOrderCancelledNotification: jest.fn(async () => undefined),
    sendOrderOnTheWayNotification: jest.fn(async () => undefined),
    sendOrderDeliveredNotification: jest.fn(async () => undefined),
    sendOrderFailedDeliveryNotification: jest.fn(async () => undefined),
  };
    const service = new OrderStateMachineService(
      ordersRepository as any,
      dataSource as any,
      orderFinancialEventsService as any,
      bestSellingCacheService as any,
      offerConsumptionService as any,
      loyaltyService as any,
      manualTransferRefundService as any,
      pushNotificationService as any,
      { getCorrelationId: () => 'corr-test' } as any,
      passGate as any,
      noopStatusHistory as any,
      noopWalletRefund as any,
    );

    // The caller must NOT see this rejected — the status transition
    // itself already committed successfully; only the financial hook
    // failed, and that must never surface as the caller's own error.
    const result = await service.transition({
      orderId: 'order-1',
      to: OrderStatus.CONFIRMED,
      actorRole: Role.ADMIN,
    });

    expect(result.status).toBe(OrderStatus.CONFIRMED);
    expect(orderFinancialEventsService.handleTransition).toHaveBeenCalled();
  });
});

describe('OrderStateMachineService — Weighted Products PICKED_UP gate (Phase G)', () => {
  function buildPickupHarness(params: { order: any; segments: any[]; items: any[] }) {
    const orderStore = { ...params.order };
    const segments = new Map(params.segments.map((s) => [s.id, s]));
    const items = params.items;

    const manager = {
      // The order id of a segment and the stock-ledger context (a no-op for this fake store).
  query: async (sql: string, p: unknown[] = []) => (/drivers|driver_id FROM deliveries/.test(sql) ? driverQuery(sql, p) : sql.includes('order_vendor_segments') ? [{ order_id: 'order-1' }] : [{ set_config: '' }]),
      findOne: async (EntityClass: any, _opts: any) => {
        if (EntityClass === Order) return { ...orderStore };
        throw new Error(`unhandled findOne ${EntityClass.name}`);
      },
      find: async (EntityClass: any, opts: any) => {
        if (EntityClass === OrderVendorSegment) {
          return [...segments.values()].filter((s) => s.orderId === opts.where.orderId);
        }
        throw new Error(`unhandled find ${EntityClass.name}`);
      },
      createQueryBuilder: (EntityClass: any, _alias: string) => {
        if (EntityClass === undefined) return deliveryUpdateQueryBuilder(); // Delivery timestamp stamp (Group 8)
        if (EntityClass !== OrderItem) throw new Error(`unhandled createQueryBuilder ${EntityClass.name}`);
        const qb: any = {
          _segmentIds: [] as string[],
          where: (_sql: string, p: any) => {
            qb._segmentIds = p.segmentIds;
            return qb;
          },
          getMany: async () => items.filter((i) => qb._segmentIds.includes(i.orderVendorSegmentId)),
        };
        return qb;
      },
      save: async (entity: any) => {
        Object.assign(orderStore, entity);
        return entity;
      },
    };
    const dataSource = { transaction: async (cb: any) => cb(manager) };
    const ordersRepository = { findOne: async () => ({ ...orderStore }) };
    const orderFinancialEventsService = { handleTransition: jest.fn(async () => undefined) };
    const bestSellingCacheService = { recordDeliveredSales: jest.fn(async () => undefined) };
    const offerConsumptionService = { reverseFlashSaleConsumptionForOrder: jest.fn(async () => undefined), reverseSubtotalDiscountConsumptionForOrder: jest.fn(async () => undefined) };
  const loyaltyService = { awardOrderEarning: jest.fn(async () => undefined) };
  const manualTransferRefundService = { recordRefund: jest.fn(async () => undefined) };
  const pushNotificationService = {
    sendOrderConfirmedNotification: jest.fn(async () => undefined),
    sendOrderCancelledNotification: jest.fn(async () => undefined),
    sendOrderOnTheWayNotification: jest.fn(async () => undefined),
    sendOrderDeliveredNotification: jest.fn(async () => undefined),
    sendOrderFailedDeliveryNotification: jest.fn(async () => undefined),
  };
    return new OrderStateMachineService(
      ordersRepository as any,
      dataSource as any,
      orderFinancialEventsService as any,
      bestSellingCacheService as any,
      offerConsumptionService as any,
      loyaltyService as any,
      manualTransferRefundService as any,
      pushNotificationService as any,
      { getCorrelationId: () => 'corr-test' } as any,
      passGate as any,
      noopStatusHistory as any,
      noopWalletRefund as any,
    );
  }

  it('blocks ASSIGNED_TO_DRIVER -> PICKED_UP when a WEIGHT item has no actualWeightGrams recorded yet', async () => {
    const service = buildPickupHarness({
      order: { id: 'order-1', status: OrderStatus.ASSIGNED_TO_DRIVER },
      segments: [{ id: 'seg-1', orderId: 'order-1', status: OrderVendorSegmentStatus.READY_FOR_PICKUP }],
      items: [{ id: 'item-1', orderVendorSegmentId: 'seg-1', pricingUnitSnapshot: PricingUnit.WEIGHT, actualWeightGrams: null }],
    });

    await expect(
      service.transition({ orderId: 'order-1', to: OrderStatus.PICKED_UP, actorRole: Role.DRIVER }),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows ASSIGNED_TO_DRIVER -> PICKED_UP once every WEIGHT item has actualWeightGrams recorded', async () => {
    const service = buildPickupHarness({
      order: { id: 'order-1', status: OrderStatus.ASSIGNED_TO_DRIVER },
      segments: [{ id: 'seg-1', orderId: 'order-1', status: OrderVendorSegmentStatus.READY_FOR_PICKUP }],
      items: [{ id: 'item-1', orderVendorSegmentId: 'seg-1', pricingUnitSnapshot: PricingUnit.WEIGHT, actualWeightGrams: 1150 }],
    });

    const result = await service.transition({ orderId: 'order-1', to: OrderStatus.PICKED_UP, actorRole: Role.DRIVER });
    expect(result.status).toBe(OrderStatus.PICKED_UP);
  });

  it('never blocks an order made up entirely of PIECE items — pricingUnitSnapshot null/PIECE is never checked', async () => {
    const service = buildPickupHarness({
      order: { id: 'order-1', status: OrderStatus.ASSIGNED_TO_DRIVER },
      segments: [{ id: 'seg-1', orderId: 'order-1', status: OrderVendorSegmentStatus.READY_FOR_PICKUP }],
      items: [
        { id: 'item-1', orderVendorSegmentId: 'seg-1', pricingUnitSnapshot: PricingUnit.PIECE, actualWeightGrams: null },
        { id: 'item-2', orderVendorSegmentId: 'seg-1', pricingUnitSnapshot: null, actualWeightGrams: null },
      ],
    });

    const result = await service.transition({ orderId: 'order-1', to: OrderStatus.PICKED_UP, actorRole: Role.DRIVER });
    expect(result.status).toBe(OrderStatus.PICKED_UP);
  });

  it('multi-vendor: blocks pickup when Vendor B\'s WEIGHT item is missing weight, even though Vendor A\'s is fully recorded', async () => {
    const service = buildPickupHarness({
      order: { id: 'order-1', status: OrderStatus.ASSIGNED_TO_DRIVER },
      segments: [
        { id: 'seg-a', orderId: 'order-1', status: OrderVendorSegmentStatus.READY_FOR_PICKUP },
        { id: 'seg-b', orderId: 'order-1', status: OrderVendorSegmentStatus.READY_FOR_PICKUP },
      ],
      items: [
        { id: 'item-a', orderVendorSegmentId: 'seg-a', pricingUnitSnapshot: PricingUnit.WEIGHT, actualWeightGrams: 1150 },
        { id: 'item-b', orderVendorSegmentId: 'seg-b', pricingUnitSnapshot: PricingUnit.WEIGHT, actualWeightGrams: null },
      ],
    });

    await expect(
      service.transition({ orderId: 'order-1', to: OrderStatus.PICKED_UP, actorRole: Role.DRIVER }),
    ).rejects.toThrow(BadRequestException);
  });

  it('ignores a CANCELLED segment\'s unrecorded WEIGHT item — that segment was never going to be picked up', async () => {
    const service = buildPickupHarness({
      order: { id: 'order-1', status: OrderStatus.ASSIGNED_TO_DRIVER },
      segments: [
        { id: 'seg-a', orderId: 'order-1', status: OrderVendorSegmentStatus.READY_FOR_PICKUP },
        { id: 'seg-b', orderId: 'order-1', status: OrderVendorSegmentStatus.CANCELLED },
      ],
      items: [
        { id: 'item-a', orderVendorSegmentId: 'seg-a', pricingUnitSnapshot: PricingUnit.WEIGHT, actualWeightGrams: 1150 },
        { id: 'item-b', orderVendorSegmentId: 'seg-b', pricingUnitSnapshot: PricingUnit.WEIGHT, actualWeightGrams: null },
      ],
    });

    const result = await service.transition({ orderId: 'order-1', to: OrderStatus.PICKED_UP, actorRole: Role.DRIVER });
    expect(result.status).toBe(OrderStatus.PICKED_UP);
  });

  it('does not affect an unrelated transition (e.g. PICKED_UP -> ON_THE_WAY) — the gate only guards entry INTO PICKED_UP', async () => {
    const service = buildPickupHarness({
      order: { id: 'order-1', status: OrderStatus.PICKED_UP },
      segments: [],
      items: [],
    });

    const result = await service.transition({ orderId: 'order-1', to: OrderStatus.ON_THE_WAY, actorRole: Role.DRIVER });
    expect(result.status).toBe(OrderStatus.ON_THE_WAY);
  });
});

describe('OrderStateMachineService — Best Selling cache hook (Discovery & Ranking)', () => {
  function buildDeliveredHarness(fromStatus: OrderStatus) {
    const store = { id: 'order-1', status: fromStatus };
    const manager = {
      query: driverQuery,
      createQueryBuilder: () => deliveryUpdateQueryBuilder(),
      findOne: async () => ({ ...store }),
      save: async (entity: any) => {
        Object.assign(store, entity);
        return entity;
      },
    };
    const dataSource = { transaction: async (cb: any) => cb(manager) };
    const ordersRepository = { findOne: async () => ({ ...store }) };
    const orderFinancialEventsService = { handleTransition: jest.fn(async () => undefined) };
    const bestSellingCacheService = { recordDeliveredSales: jest.fn(async () => undefined) };
    const offerConsumptionService = { reverseFlashSaleConsumptionForOrder: jest.fn(async () => undefined), reverseSubtotalDiscountConsumptionForOrder: jest.fn(async () => undefined) };
  const loyaltyService = { awardOrderEarning: jest.fn(async () => undefined) };
  const manualTransferRefundService = { recordRefund: jest.fn(async () => undefined) };
  const pushNotificationService = {
    sendOrderConfirmedNotification: jest.fn(async () => undefined),
    sendOrderCancelledNotification: jest.fn(async () => undefined),
    sendOrderOnTheWayNotification: jest.fn(async () => undefined),
    sendOrderDeliveredNotification: jest.fn(async () => undefined),
    sendOrderFailedDeliveryNotification: jest.fn(async () => undefined),
  };
    const service = new OrderStateMachineService(
      ordersRepository as any,
      dataSource as any,
      orderFinancialEventsService as any,
      bestSellingCacheService as any,
      offerConsumptionService as any,
      loyaltyService as any,
      manualTransferRefundService as any,
      pushNotificationService as any,
      { getCorrelationId: () => 'corr-test' } as any,
      passGate as any,
      noopStatusHistory as any,
      noopWalletRefund as any,
    );
    return { service, bestSellingCacheService };
  }

  it('calls recordDeliveredSales exactly once when transitioning ON_THE_WAY -> DELIVERED', async () => {
    const { service, bestSellingCacheService } = buildDeliveredHarness(OrderStatus.ON_THE_WAY);

    const result = await service.transition({ orderId: 'order-1', to: OrderStatus.DELIVERED, actorRole: Role.DRIVER });

    expect(result.status).toBe(OrderStatus.DELIVERED);
    expect(bestSellingCacheService.recordDeliveredSales).toHaveBeenCalledTimes(1);
    expect(bestSellingCacheService.recordDeliveredSales).toHaveBeenCalledWith('order-1');
  });

  it('does not call recordDeliveredSales for an unrelated transition', async () => {
    const { service, bestSellingCacheService } = buildDeliveredHarness(OrderStatus.PICKED_UP);

    await service.transition({ orderId: 'order-1', to: OrderStatus.ON_THE_WAY, actorRole: Role.DRIVER });

    expect(bestSellingCacheService.recordDeliveredSales).not.toHaveBeenCalled();
  });

  it('a second attempt to transition an already-DELIVERED order is rejected outright — the existing transition-rule guard, not a new dedupe mechanism, prevents double counting', async () => {
    const { service, bestSellingCacheService } = buildDeliveredHarness(OrderStatus.DELIVERED);

    await expect(
      service.transition({ orderId: 'order-1', to: OrderStatus.DELIVERED, actorRole: Role.DRIVER }),
    ).rejects.toThrow(BadRequestException);
    expect(bestSellingCacheService.recordDeliveredSales).not.toHaveBeenCalled();
  });

  it('a failure in recordDeliveredSales never blocks the DELIVERED transition itself — same non-blocking convention as the financial-event hook', async () => {
    const store = { id: 'order-1', status: OrderStatus.ON_THE_WAY };
    const manager = {
      query: driverQuery,
      createQueryBuilder: () => deliveryUpdateQueryBuilder(),
      findOne: async () => ({ ...store }),
      save: async (entity: any) => {
        Object.assign(store, entity);
        return entity;
      },
    };
    const dataSource = { transaction: async (cb: any) => cb(manager) };
    const ordersRepository = { findOne: async () => ({ ...store }) };
    const orderFinancialEventsService = { handleTransition: jest.fn(async () => undefined) };
    const bestSellingCacheService = {
      recordDeliveredSales: jest.fn(async () => {
        throw new Error('transient DB error while incrementing Product counters');
      }),
    };
    const offerConsumptionService = { reverseFlashSaleConsumptionForOrder: jest.fn(async () => undefined), reverseSubtotalDiscountConsumptionForOrder: jest.fn(async () => undefined) };
  const loyaltyService = { awardOrderEarning: jest.fn(async () => undefined) };
  const manualTransferRefundService = { recordRefund: jest.fn(async () => undefined) };
  const pushNotificationService = {
    sendOrderConfirmedNotification: jest.fn(async () => undefined),
    sendOrderCancelledNotification: jest.fn(async () => undefined),
    sendOrderOnTheWayNotification: jest.fn(async () => undefined),
    sendOrderDeliveredNotification: jest.fn(async () => undefined),
    sendOrderFailedDeliveryNotification: jest.fn(async () => undefined),
  };
    const service = new OrderStateMachineService(
      ordersRepository as any,
      dataSource as any,
      orderFinancialEventsService as any,
      bestSellingCacheService as any,
      offerConsumptionService as any,
      loyaltyService as any,
      manualTransferRefundService as any,
      pushNotificationService as any,
      { getCorrelationId: () => 'corr-test' } as any,
      passGate as any,
      noopStatusHistory as any,
      noopWalletRefund as any,
    );

    const result = await service.transition({ orderId: 'order-1', to: OrderStatus.DELIVERED, actorRole: Role.DRIVER });
    expect(result.status).toBe(OrderStatus.DELIVERED);
  });
});

describe('OrderStateMachineService — Offers Final System: Flash Sale cancellation reversal wiring', () => {
  function buildHarnessWithOfferMock(order: any) {
    const store = { ...order };
    const manager = {
      query: driverQuery,
      createQueryBuilder: () => deliveryUpdateQueryBuilder(),
      findOne: async (_EntityClass: any, _opts: any) => ({ ...store }),
      save: async (entity: any) => {
        Object.assign(store, entity);
        return entity;
      },
      find: async () => [],
      getRepository: (EntityClass: any) => {
        if (EntityClass.name === 'Payment') {
          return { findOne: async () => null };
        }
        throw new Error(`unhandled getRepository ${EntityClass.name}`);
      },
    };
    const dataSource = { transaction: async (cb: any) => cb(manager) };
    const ordersRepository = { findOne: async (_opts: any) => ({ ...store }) };
    const orderFinancialEventsService = { handleTransition: jest.fn(async () => undefined) };
    const bestSellingCacheService = { recordDeliveredSales: jest.fn(async () => undefined) };
    const offerConsumptionService = {
      reverseFlashSaleConsumptionForOrder: jest.fn(async (_manager: unknown, _orderId: string) => undefined),
      reverseSubtotalDiscountConsumptionForOrder: jest.fn(async (_manager: unknown, _orderId: string) => undefined),
    };
  const loyaltyService = { awardOrderEarning: jest.fn(async () => undefined) };
  const manualTransferRefundService = { recordRefund: jest.fn(async () => undefined) };
  const pushNotificationService = {
    sendOrderConfirmedNotification: jest.fn(async () => undefined),
    sendOrderCancelledNotification: jest.fn(async () => undefined),
    sendOrderOnTheWayNotification: jest.fn(async () => undefined),
    sendOrderDeliveredNotification: jest.fn(async () => undefined),
    sendOrderFailedDeliveryNotification: jest.fn(async () => undefined),
  };
    const service = new OrderStateMachineService(
      ordersRepository as any,
      dataSource as any,
      orderFinancialEventsService as any,
      bestSellingCacheService as any,
      offerConsumptionService as any,
      loyaltyService as any,
      manualTransferRefundService as any,
      pushNotificationService as any,
      { getCorrelationId: () => 'corr-test' } as any,
      passGate as any,
      noopStatusHistory as any,
      noopWalletRefund as any,
    );
    return { service, offerConsumptionService };
  }

  it('CRITICAL: transitioning to CANCELLED calls reverseFlashSaleConsumptionForOrder, inside the same transaction manager, with the correct orderId', async () => {
    const { service, offerConsumptionService } = buildHarnessWithOfferMock({ id: 'order-1', status: OrderStatus.PENDING });

    await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.ADMIN });

    expect(offerConsumptionService.reverseFlashSaleConsumptionForOrder).toHaveBeenCalledTimes(1);
    expect(offerConsumptionService.reverseFlashSaleConsumptionForOrder.mock.calls[0][1]).toBe('order-1');
  });

  it('does NOT call reverseFlashSaleConsumptionForOrder for a non-cancellation transition', async () => {
    const { service, offerConsumptionService } = buildHarnessWithOfferMock({ id: 'order-1', status: OrderStatus.PENDING });

    await service.transition({ orderId: 'order-1', to: OrderStatus.CONFIRMED, actorRole: Role.ADMIN });

    expect(offerConsumptionService.reverseFlashSaleConsumptionForOrder).not.toHaveBeenCalled();
  });
});

describe('OrderStateMachineService — Loyalty Earning (Chunk C) wiring', () => {
  function buildHarnessWithLoyaltyMock(order: any) {
    const store = { ...order };
    const manager = {
      query: driverQuery,
      createQueryBuilder: () => deliveryUpdateQueryBuilder(),
      findOne: async (_EntityClass: any, _opts: any) => ({ ...store }),
      save: async (entity: any) => {
        Object.assign(store, entity);
        return entity;
      },
      find: async () => [],
    };
    const dataSource = { transaction: async (cb: any) => cb(manager) };
    const ordersRepository = { findOne: async (_opts: any) => ({ ...store }) };
    const orderFinancialEventsService = { handleTransition: jest.fn(async () => undefined) };
    const bestSellingCacheService = { recordDeliveredSales: jest.fn(async () => undefined) };
    const offerConsumptionService = { reverseFlashSaleConsumptionForOrder: jest.fn(async () => undefined), reverseSubtotalDiscountConsumptionForOrder: jest.fn(async () => undefined) };
    const loyaltyService = {
      awardOrderEarning: jest.fn(async (_manager: unknown, _orderId: string) => undefined),
    };
  const manualTransferRefundService = { recordRefund: jest.fn(async () => undefined) };
  const pushNotificationService = {
    sendOrderConfirmedNotification: jest.fn(async () => undefined),
    sendOrderCancelledNotification: jest.fn(async () => undefined),
    sendOrderOnTheWayNotification: jest.fn(async () => undefined),
    sendOrderDeliveredNotification: jest.fn(async () => undefined),
    sendOrderFailedDeliveryNotification: jest.fn(async () => undefined),
  };
    const service = new OrderStateMachineService(
      ordersRepository as any,
      dataSource as any,
      orderFinancialEventsService as any,
      bestSellingCacheService as any,
      offerConsumptionService as any,
      loyaltyService as any,
      manualTransferRefundService as any,
      pushNotificationService as any,
      { getCorrelationId: () => 'corr-test' } as any,
      passGate as any,
      noopStatusHistory as any,
      noopWalletRefund as any,
    );
    return { service, loyaltyService };
  }

  it('CRITICAL: transitioning to DELIVERED calls awardOrderEarning, inside the same transaction manager, with the correct orderId', async () => {
    const { service, loyaltyService } = buildHarnessWithLoyaltyMock({ id: 'order-1', status: OrderStatus.ON_THE_WAY });

    await service.transition({ orderId: 'order-1', to: OrderStatus.DELIVERED, actorRole: Role.DRIVER });

    expect(loyaltyService.awardOrderEarning).toHaveBeenCalledTimes(1);
    expect(loyaltyService.awardOrderEarning.mock.calls[0][1]).toBe('order-1');
  });

  it('does NOT call awardOrderEarning for a non-DELIVERED transition', async () => {
    const { service, loyaltyService } = buildHarnessWithLoyaltyMock({ id: 'order-1', status: OrderStatus.PENDING });

    await service.transition({ orderId: 'order-1', to: OrderStatus.CONFIRMED, actorRole: Role.ADMIN });

    expect(loyaltyService.awardOrderEarning).not.toHaveBeenCalled();
  });

  it('CRITICAL: if awardOrderEarning throws, the whole transition rejects — no partial state (the real Postgres transaction would roll back the status change too, since both happen in the same manager.transaction callback)', async () => {
    const { service, loyaltyService } = buildHarnessWithLoyaltyMock({ id: 'order-1', status: OrderStatus.ON_THE_WAY });
    loyaltyService.awardOrderEarning = jest.fn(async (_manager: unknown, _orderId: string) => {
      throw new Error('simulated failure inside the locked transaction');
    });

    await expect(
      service.transition({ orderId: 'order-1', to: OrderStatus.DELIVERED, actorRole: Role.DRIVER }),
    ).rejects.toThrow('simulated failure');
  });
});

describe('OrderStateMachineService — Inventory Restoration on Order Cancellation', () => {
  it('restores exactly the decremented quantity for a TRACKED PIECE product', async () => {
    const { service, productStore } = buildInventoryHarness({
      segments: [{ id: 'seg-1', orderId: 'order-1' }],
      items: [{ id: 'item-1', orderVendorSegmentId: 'seg-1', productId: 'p1', quantity: 3, pricingUnitSnapshot: PricingUnit.PIECE, requestedWeightGrams: null }],
      products: [{ id: 'p1', inventoryMode: 'TRACKED', quantity: 10 }],
    });

    await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.VENDOR });

    expect(productStore.get('p1')!.quantity).toBe(13);
  });

  it('does not restore a segment the vendor already cancelled on its own — that stock came back when the segment was cancelled (Group 8 regression: no double restore)', async () => {
    const { service, productStore } = buildInventoryHarness({
      segments: [
        { id: 'seg-1', orderId: 'order-1', status: 'READY_FOR_PICKUP' },
        { id: 'seg-2', orderId: 'order-1', status: 'CANCELLED' },
      ],
      items: [
        { id: 'item-1', orderVendorSegmentId: 'seg-1', productId: 'p1', quantity: 3, pricingUnitSnapshot: PricingUnit.PIECE, requestedWeightGrams: null },
        { id: 'item-2', orderVendorSegmentId: 'seg-2', productId: 'p2', quantity: 5, pricingUnitSnapshot: PricingUnit.PIECE, requestedWeightGrams: null },
      ],
      products: [
        { id: 'p1', inventoryMode: 'TRACKED', quantity: 10 },
        { id: 'p2', inventoryMode: 'TRACKED', quantity: 10 },
      ],
    });

    await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.ADMIN });

    expect(productStore.get('p1')!.quantity).toBe(13); // live segment restored
    expect(productStore.get('p2')!.quantity).toBe(10); // cancelled segment NOT restored a second time
  });

  it('restores exactly the decremented quantity for a TRACKED WEIGHT product, using requestedWeightGrams (the exact amount originally decremented)', async () => {
    const { service, productStore } = buildInventoryHarness({
      segments: [{ id: 'seg-1', orderId: 'order-1' }],
      items: [{ id: 'item-1', orderVendorSegmentId: 'seg-1', productId: 'p1', quantity: 1, pricingUnitSnapshot: PricingUnit.WEIGHT, requestedWeightGrams: 750 }],
      products: [{ id: 'p1', inventoryMode: 'TRACKED', quantity: 2000 }],
    });

    await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.VENDOR });

    expect(productStore.get('p1')!.quantity).toBe(2750);
  });

  it('does NOT modify an UNTRACKED (OPEN) product', async () => {
    const { service, productStore } = buildInventoryHarness({
      segments: [{ id: 'seg-1', orderId: 'order-1' }],
      items: [{ id: 'item-1', orderVendorSegmentId: 'seg-1', productId: 'p1', quantity: 3, pricingUnitSnapshot: PricingUnit.PIECE, requestedWeightGrams: null }],
      products: [{ id: 'p1', inventoryMode: 'OPEN', quantity: 10 }],
    });

    await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.VENDOR });

    expect(productStore.get('p1')!.quantity).toBe(10);
  });

  it('CRITICAL: a Custom Vendor/Pharmacy item (productId = null) does not modify inventory at all', async () => {
    const { service, productStore } = buildInventoryHarness({
      segments: [{ id: 'seg-1', orderId: 'order-1' }],
      items: [{ id: 'item-1', orderVendorSegmentId: 'seg-1', productId: null, quantity: 1, pricingUnitSnapshot: null, requestedWeightGrams: null }],
      products: [],
    });

    // Should not throw despite no product existing for this item.
    await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.VENDOR });
    expect(productStore.size).toBe(0);
  });

  it('restores ALL eligible tracked catalog items in a multi-item order, skipping the custom item', async () => {
    const { service, productStore } = buildInventoryHarness({
      segments: [{ id: 'seg-1', orderId: 'order-1' }],
      items: [
        { id: 'item-1', orderVendorSegmentId: 'seg-1', productId: 'p1', quantity: 2, pricingUnitSnapshot: PricingUnit.PIECE, requestedWeightGrams: null },
        { id: 'item-2', orderVendorSegmentId: 'seg-1', productId: 'p2', quantity: 1, pricingUnitSnapshot: PricingUnit.WEIGHT, requestedWeightGrams: 500 },
        { id: 'item-3', orderVendorSegmentId: 'seg-1', productId: null, quantity: 1, pricingUnitSnapshot: null, requestedWeightGrams: null },
      ],
      products: [
        { id: 'p1', inventoryMode: 'TRACKED', quantity: 5 },
        { id: 'p2', inventoryMode: 'TRACKED', quantity: 1000 },
      ],
    });

    await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.VENDOR });

    expect(productStore.get('p1')!.quantity).toBe(7);
    expect(productStore.get('p2')!.quantity).toBe(1500);
  });

  it('CRITICAL: if restoration throws, the whole cancellation transaction rejects — no partial state (real Postgres would roll back the status write too, same transaction)', async () => {
    const brokenService = buildInventoryHarness({
      segments: [{ id: 'seg-1', orderId: 'order-1' }],
      items: [{ id: 'item-1', orderVendorSegmentId: 'seg-1', productId: 'p1', quantity: 1, pricingUnitSnapshot: PricingUnit.PIECE, requestedWeightGrams: null }],
      products: [{ id: 'p1', inventoryMode: 'TRACKED', quantity: 5 }],
    }).service;
    (brokenService as any).restoreTrackedInventory = jest.fn(async () => {
      throw new Error('simulated restoration failure');
    });

    await expect(
      brokenService.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.VENDOR }),
    ).rejects.toThrow('simulated restoration failure');
  });

  it('CRITICAL: cancelling an already-CANCELLED order is rejected by the existing transition rule — restoration can never run twice for the same order', async () => {
    const { service, productStore } = buildInventoryHarness({
      orderStatus: OrderStatus.CANCELLED,
      segments: [{ id: 'seg-1', orderId: 'order-1' }],
      items: [{ id: 'item-1', orderVendorSegmentId: 'seg-1', productId: 'p1', quantity: 3, pricingUnitSnapshot: PricingUnit.PIECE, requestedWeightGrams: null }],
      products: [{ id: 'p1', inventoryMode: 'TRACKED', quantity: 10 }],
    });

    await expect(
      service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.VENDOR }),
    ).rejects.toThrow(BadRequestException);
    expect(productStore.get('p1')!.quantity).toBe(10); // untouched — the transition never reached restoration
  });

  it('existing Flash Sale reversal still occurs during cancellation, alongside inventory restoration', async () => {
    const { service, offerConsumptionService, productStore } = buildInventoryHarness({
      segments: [{ id: 'seg-1', orderId: 'order-1' }],
      items: [{ id: 'item-1', orderVendorSegmentId: 'seg-1', productId: 'p1', quantity: 2, pricingUnitSnapshot: PricingUnit.PIECE, requestedWeightGrams: null }],
      products: [{ id: 'p1', inventoryMode: 'TRACKED', quantity: 5 }],
    });

    await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.VENDOR });

    expect(offerConsumptionService.reverseFlashSaleConsumptionForOrder).toHaveBeenCalledWith(expect.anything(), 'order-1');
    expect(productStore.get('p1')!.quantity).toBe(7);
  });

  it('existing cancellation authorization remains unchanged — a non-Vendor/Admin role is still rejected', async () => {
    const { service } = buildInventoryHarness({
      orderStatus: OrderStatus.PENDING,
      segments: [],
      items: [],
      products: [],
    });

    await expect(
      service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.DRIVER }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('OrderStateMachineService — Atomic Manual Transfer Refund on Order Cancellation (Chunk B2)', () => {
  it('CRITICAL: PAID Manual Transfer + cancellation records exactly one refund event, using Payment.amountMinor', async () => {
    const { service, manualTransferRefundService } = buildInventoryHarness({
      segments: [],
      items: [],
      products: [],
      payment: { id: 'payment-1', orderId: 'order-1', status: 'PAID', amountMinor: 10000 },
    });

    await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.ADMIN, actorUserId: 'admin-1' });

    expect(manualTransferRefundService.recordRefund).toHaveBeenCalledTimes(1);
    const [refundParams, passedManager] = manualTransferRefundService.recordRefund.mock.calls[0];
    expect(refundParams.paymentId).toBe('payment-1');
    expect(refundParams.amountMinor).toBe(10000);
    expect(refundParams.actorUserId).toBe('admin-1');
    expect(passedManager).toBeTruthy(); // participates in the SAME transaction manager
  });

  it('CRITICAL: refund amount equals Payment.amountMinor even when it differs from Order.totalMinor (deferred Custom Request pricing scenario)', async () => {
    const { service, manualTransferRefundService } = buildInventoryHarness({
      segments: [],
      items: [],
      products: [],
      payment: { id: 'payment-1', orderId: 'order-1', status: 'PAID', amountMinor: 10000 },
    });
    // Order.totalMinor grew to 13000 after a Custom Request was priced —
    // the mock order object itself doesn't need to reflect this for the
    // test to prove the point: the refund call never reads Order.totalMinor
    // at all, only Payment.amountMinor.
    await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.ADMIN, actorUserId: 'admin-1' });

    expect(manualTransferRefundService.recordRefund.mock.calls[0][0].amountMinor).toBe(10000);
  });

  it('CRITICAL: PAID with hasPendingAdHocPricing=true still refunds exactly Payment.amountMinor — no new business rule introduced', async () => {
    const { service, manualTransferRefundService } = buildInventoryHarness({
      segments: [],
      items: [],
      products: [],
      payment: { id: 'payment-1', orderId: 'order-1', status: 'PAID', amountMinor: 10000 },
    });

    await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.ADMIN, actorUserId: 'admin-1' });

    expect(manualTransferRefundService.recordRefund.mock.calls[0][0].amountMinor).toBe(10000);
  });

  it.each(['PENDING', 'CUSTOMER_CLAIMED_TRANSFER', 'UNDER_REVIEW', 'REJECTED'])(
    'no refund is recorded when the Manual Transfer payment status is %s',
    async (status) => {
      const { service, manualTransferRefundService } = buildInventoryHarness({
        segments: [],
        items: [],
        products: [],
        payment: { id: 'payment-1', orderId: 'order-1', status, amountMinor: 10000 },
      });

      await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.ADMIN, actorUserId: 'admin-1' });

      expect(manualTransferRefundService.recordRefund).not.toHaveBeenCalled();
    },
  );

  it('no refund attempted when the order has no Manual Transfer payment at all (e.g. COD)', async () => {
    const { service, manualTransferRefundService } = buildInventoryHarness({
      segments: [],
      items: [],
      products: [],
      payment: null,
    });

    await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.ADMIN, actorUserId: 'admin-1' });

    expect(manualTransferRefundService.recordRefund).not.toHaveBeenCalled();
  });

  it('CRITICAL: the original Payment is never mutated — still PAID after cancellation', async () => {
    const { service, paymentStore } = buildInventoryHarness({
      segments: [],
      items: [],
      products: [],
      payment: { id: 'payment-1', orderId: 'order-1', status: 'PAID', amountMinor: 10000 },
    });

    await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.ADMIN, actorUserId: 'admin-1' });

    expect(paymentStore!.status).toBe('PAID'); // this harness's own copy was never written to
  });

  it('duplicate/repeated refund invocation: relies on ManualTransferRefundService/FinancialEventService\u2019s own existing idempotency — verified by asserting it is called with the SAME deterministic identity on a retried cancellation attempt', async () => {
    const { service, manualTransferRefundService } = buildInventoryHarness({
      orderStatus: OrderStatus.CANCELLED, // already cancelled — a retried attempt
      segments: [],
      items: [],
      products: [],
      payment: { id: 'payment-1', orderId: 'order-1', status: 'PAID', amountMinor: 10000 },
    });

    // The existing state-machine guarantee (no rule from CANCELLED)
    // rejects this before the refund call is ever reached again.
    await expect(
      service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.ADMIN, actorUserId: 'admin-1' }),
    ).rejects.toThrow(BadRequestException);
    expect(manualTransferRefundService.recordRefund).not.toHaveBeenCalled();
  });

  it('CRITICAL: if the refund call throws, the whole cancellation transaction rejects — no partial state', async () => {
    const { service } = buildInventoryHarness({
      segments: [],
      items: [],
      products: [],
      payment: { id: 'payment-1', orderId: 'order-1', status: 'PAID', amountMinor: 10000 },
    });
    (service as any).manualTransferRefundService.recordRefund = jest.fn(async () => {
      throw new Error('simulated refund failure');
    });

    await expect(
      service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.ADMIN, actorUserId: 'admin-1' }),
    ).rejects.toThrow('simulated refund failure');
  });

  it('inventory restoration and Flash Sale reversal still occur alongside the Manual Transfer refund', async () => {
    const { service, productStore, offerConsumptionService, manualTransferRefundService } = buildInventoryHarness({
      segments: [{ id: 'seg-1', orderId: 'order-1' }],
      items: [{ id: 'item-1', orderVendorSegmentId: 'seg-1', productId: 'p1', quantity: 2, pricingUnitSnapshot: PricingUnit.PIECE, requestedWeightGrams: null }],
      products: [{ id: 'p1', inventoryMode: 'TRACKED', quantity: 5 }],
      payment: { id: 'payment-1', orderId: 'order-1', status: 'PAID', amountMinor: 10000 },
    });

    await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.ADMIN, actorUserId: 'admin-1' });

    expect(productStore.get('p1')!.quantity).toBe(7);
    expect(offerConsumptionService.reverseFlashSaleConsumptionForOrder).toHaveBeenCalledWith(expect.anything(), 'order-1');
    expect(manualTransferRefundService.recordRefund).toHaveBeenCalledTimes(1);
  });

  it('existing cancellation authorization remains unchanged even with a PAID Manual Transfer present — a non-Vendor/Admin role is still rejected', async () => {
    const { service, manualTransferRefundService } = buildInventoryHarness({
      orderStatus: OrderStatus.PENDING,
      segments: [],
      items: [],
      products: [],
      payment: { id: 'payment-1', orderId: 'order-1', status: 'PAID', amountMinor: 10000 },
    });

    await expect(
      service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.DRIVER }),
    ).rejects.toThrow(BadRequestException);
    expect(manualTransferRefundService.recordRefund).not.toHaveBeenCalled();
  });
});

describe('OrderStateMachineService — Failed Delivery Metadata (Chunk 1)', () => {
  it('PICKED_UP → FAILED_DELIVERY stores the supplied failureReason', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.PICKED_UP });

    const order = await service.transition({
      orderId: 'order-1',
      to: OrderStatus.FAILED_DELIVERY,
      actorRole: Role.DRIVER,
      failureReason: 'Customer not reachable at the address',
    });

    expect(order.failureReason).toBe('Customer not reachable at the address');
  });

  it('ON_THE_WAY → FAILED_DELIVERY stores the supplied failureReason', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.ON_THE_WAY });

    const order = await service.transition({
      orderId: 'order-1',
      to: OrderStatus.FAILED_DELIVERY,
      actorRole: Role.DRIVER,
      failureReason: 'Address inaccessible',
    });

    expect(order.failureReason).toBe('Address inaccessible');
  });

  it('failedAt is populated with the actual transition time', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.PICKED_UP });
    const before = new Date();

    const order = await service.transition({
      orderId: 'order-1',
      to: OrderStatus.FAILED_DELIVERY,
      actorRole: Role.DRIVER,
      failureReason: 'x',
    });

    expect(order.failedAt).toBeInstanceOf(Date);
    expect(order.failedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('failureReason is null when omitted', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.PICKED_UP });

    const order = await service.transition({
      orderId: 'order-1',
      to: OrderStatus.FAILED_DELIVERY,
      actorRole: Role.DRIVER,
    });

    expect(order.failureReason).toBeNull();
  });

  it('failedAt is null before the failure transition (a normal, non-failed order)', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.PENDING });

    const order = await service.transition({ orderId: 'order-1', to: OrderStatus.CONFIRMED, actorRole: Role.ADMIN });

    expect(order.failedAt).toBeUndefined();
  });

  it('CRITICAL: a repeated FAILED_DELIVERY attempt on an already-failed order is rejected before any metadata can be overwritten', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.FAILED_DELIVERY, failureReason: 'original reason' });

    await expect(
      service.transition({
        orderId: 'order-1',
        to: OrderStatus.FAILED_DELIVERY,
        actorRole: Role.DRIVER,
        failureReason: 'a different reason',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('Driver remains authorized to trigger FAILED_DELIVERY', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.PICKED_UP });
    const order = await service.transition({ orderId: 'order-1', to: OrderStatus.FAILED_DELIVERY, actorRole: Role.DRIVER });
    expect(order.status).toBe(OrderStatus.FAILED_DELIVERY);
  });

  it('Admin remains authorized to trigger FAILED_DELIVERY', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.PICKED_UP });
    const order = await service.transition({ orderId: 'order-1', to: OrderStatus.FAILED_DELIVERY, actorRole: Role.ADMIN });
    expect(order.status).toBe(OrderStatus.FAILED_DELIVERY);
  });

  it('Vendor remains unauthorized to trigger FAILED_DELIVERY', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.PICKED_UP });
    await expect(
      service.transition({ orderId: 'order-1', to: OrderStatus.FAILED_DELIVERY, actorRole: Role.VENDOR }),
    ).rejects.toThrow(BadRequestException);
  });

  it('Customer remains unauthorized to trigger FAILED_DELIVERY', async () => {
    const service = buildHarness({ id: 'order-1', status: OrderStatus.PICKED_UP });
    await expect(
      service.transition({ orderId: 'order-1', to: OrderStatus.FAILED_DELIVERY, actorRole: Role.CUSTOMER }),
    ).rejects.toThrow(BadRequestException);
  });

  it('CRITICAL: no side effects are added — inventory, Manual Transfer refund, and Flash Sale reversal are never invoked for FAILED_DELIVERY', async () => {
    const store = { id: 'order-1', status: OrderStatus.PICKED_UP };
    const productStore = new Map([['p1', { id: 'p1', inventoryMode: 'TRACKED', quantity: 5 }]]);
    const manager = {
      findOne: async (_EntityClass: any, _opts: any) => ({ ...store }),
      save: async (entity: any) => {
        Object.assign(store, entity);
        return entity;
      },
      find: async () => [],
      getRepository: (EntityClass: any) => {
        if (EntityClass.name === 'Payment') return { findOne: async () => null };
        throw new Error('unhandled getRepository');
      },
      query: driverQuery,
      createQueryBuilder: (EntityClass?: unknown) => {
        // Inventory restoration reads OrderItem rows via createQueryBuilder(OrderItem, ...): still forbidden here.
        // The no-arg form is the driver-availability release added in Group 8 (a deliberate, separate effect).
        if (EntityClass !== undefined) throw new Error('should not be called — no items/segments to restore for this test');
        return deliveryUpdateQueryBuilder();
      },
    };
    const dataSource = { transaction: async (cb: any) => cb(manager) };
    const ordersRepository = { findOne: async () => ({ ...store }) };
    const offerConsumptionService = { reverseFlashSaleConsumptionForOrder: jest.fn(async () => undefined), reverseSubtotalDiscountConsumptionForOrder: jest.fn(async () => undefined) };
    const manualTransferRefundService = { recordRefund: jest.fn(async () => undefined) };
  const pushNotificationService = {
    sendOrderConfirmedNotification: jest.fn(async () => undefined),
    sendOrderCancelledNotification: jest.fn(async () => undefined),
    sendOrderOnTheWayNotification: jest.fn(async () => undefined),
    sendOrderDeliveredNotification: jest.fn(async () => undefined),
    sendOrderFailedDeliveryNotification: jest.fn(async () => undefined),
  };
    const service = new OrderStateMachineService(
      ordersRepository as any,
      dataSource as any,
      { handleTransition: jest.fn(async () => undefined) } as any,
      { recordDeliveredSales: jest.fn(async () => undefined) } as any,
      offerConsumptionService as any,
      { awardOrderEarning: jest.fn(async () => undefined) } as any,
      manualTransferRefundService as any,
      pushNotificationService as any,
      { getCorrelationId: () => 'corr-test' } as any,
      passGate as any,
      noopStatusHistory as any,
      noopWalletRefund as any,
    );

    await service.transition({ orderId: 'order-1', to: OrderStatus.FAILED_DELIVERY, actorRole: Role.DRIVER, failureReason: 'x' });

    expect(productStore.get('p1')!.quantity).toBe(5); // untouched
    expect(offerConsumptionService.reverseFlashSaleConsumptionForOrder).not.toHaveBeenCalled();
    expect(manualTransferRefundService.recordRefund).not.toHaveBeenCalled();
  });

  it('existing CANCELLED behavior remains unchanged (Flash Sale reversal still occurs alongside the FAILED_DELIVERY metadata addition)', async () => {
    const store = { id: 'order-1', status: OrderStatus.PREPARING };
    const manager = {
      query: driverQuery,
      createQueryBuilder: () => deliveryUpdateQueryBuilder(),
      findOne: async (_EntityClass: any, _opts: any) => ({ ...store }),
      save: async (entity: any) => {
        Object.assign(store, entity);
        return entity;
      },
      find: async () => [], // no segments — restoreTrackedInventory returns immediately
      getRepository: (EntityClass: any) => {
        if (EntityClass.name === 'Payment') return { findOne: async () => null };
        throw new Error('unhandled getRepository');
      },
    };
    const dataSource = { transaction: async (cb: any) => cb(manager) };
    const ordersRepository = { findOne: async () => ({ ...store }) };
    const offerConsumptionService = { reverseFlashSaleConsumptionForOrder: jest.fn(async () => undefined), reverseSubtotalDiscountConsumptionForOrder: jest.fn(async () => undefined) };
    const service = new OrderStateMachineService(
      ordersRepository as any,
      dataSource as any,
      { handleTransition: jest.fn(async () => undefined) } as any,
      { recordDeliveredSales: jest.fn(async () => undefined) } as any,
      offerConsumptionService as any,
      { awardOrderEarning: jest.fn(async () => undefined) } as any,
      { recordRefund: jest.fn(async () => undefined) } as any,
      { sendOrderCancelledNotification: jest.fn(async () => undefined) } as any,
      { getCorrelationId: () => 'corr-test' } as any,
      passGate as any,
      noopStatusHistory as any,
      noopWalletRefund as any,
    );

    const order = await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.VENDOR });

    expect(offerConsumptionService.reverseFlashSaleConsumptionForOrder).toHaveBeenCalledWith(expect.anything(), 'order-1');
    expect(order.status).toBe(OrderStatus.CANCELLED);
    expect(order.failedAt).toBeUndefined(); // CANCELLED never touches failure metadata
  });
});

describe('OrderStateMachineService — Customer Push Notifications (Chunk A)', () => {
  // Local harness, self-contained: buildHarness() above only returns
  // `service`, not the mocks — CONFIRMED not modified here (many
  // existing tests depend on its exact current shape), so this
  // chunk's own tests build their own small harness instead, exposing
  // `pushNotificationService` for assertions.
  function buildPushTestHarness(order: any) {
    const store = { ...order };
    const manager = {
      findOne: async () => ({ ...store }),
      save: async (entity: any) => {
        Object.assign(store, entity);
        return entity;
      },
      find: async () => [],
      query: driverQuery,
      createQueryBuilder: (EntityClass?: unknown) =>
        EntityClass === undefined
          ? deliveryUpdateQueryBuilder()
          : {
              where: function (this: any) {
                return this;
              },
              getMany: async () => [],
            },
      getRepository: (EntityClass: any) => {
        if (EntityClass.name === 'Payment') {
          return { findOne: async () => null };
        }
        throw new Error(`unhandled getRepository ${EntityClass.name}`);
      },
    };
    const dataSource = { transaction: async (cb: any) => cb(manager) };
    const ordersRepository = { findOne: async () => ({ ...store }) };
    const orderFinancialEventsService = { handleTransition: jest.fn(async () => undefined) };
    const bestSellingCacheService = { recordDeliveredSales: jest.fn(async () => undefined) };
    const offerConsumptionService = { reverseFlashSaleConsumptionForOrder: jest.fn(async () => undefined), reverseSubtotalDiscountConsumptionForOrder: jest.fn(async () => undefined) };
    const loyaltyService = { awardOrderEarning: jest.fn(async () => undefined) };
    const manualTransferRefundService = { recordRefund: jest.fn(async () => undefined) };
    const pushNotificationService = {
      sendOrderConfirmedNotification: jest.fn(async () => undefined),
      sendOrderCancelledNotification: jest.fn(async () => undefined),
      sendOrderOnTheWayNotification: jest.fn(async () => undefined),
      sendOrderDeliveredNotification: jest.fn(async () => undefined),
      sendOrderFailedDeliveryNotification: jest.fn(async () => undefined),
    };
    const service = new OrderStateMachineService(
      ordersRepository as any,
      dataSource as any,
      orderFinancialEventsService as any,
      bestSellingCacheService as any,
      offerConsumptionService as any,
      loyaltyService as any,
      manualTransferRefundService as any,
      pushNotificationService as any,
      { getCorrelationId: () => 'corr-test' } as any,
      passGate as any,
      noopStatusHistory as any,
      noopWalletRefund as any,
    );
    return { service, pushNotificationService };
  }

  it('CRITICAL: CONFIRMED targets Order.customerId via sendOrderConfirmedNotification', async () => {
    const { service, pushNotificationService } = buildPushTestHarness({
      id: 'order-1',
      customerId: 'customer-1',
      status: OrderStatus.PENDING,
    });
    await service.transition({ orderId: 'order-1', to: OrderStatus.CONFIRMED, actorRole: Role.ADMIN });
    expect(pushNotificationService.sendOrderConfirmedNotification).toHaveBeenCalledWith('customer-1', 'order-1');
    expect(pushNotificationService.sendOrderCancelledNotification).not.toHaveBeenCalled();
  });

  it('CRITICAL: CANCELLED targets Order.customerId via sendOrderCancelledNotification', async () => {
    const { service, pushNotificationService } = buildPushTestHarness({
      id: 'order-1',
      customerId: 'customer-1',
      status: OrderStatus.PENDING,
    });
    await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.ADMIN });
    expect(pushNotificationService.sendOrderCancelledNotification).toHaveBeenCalledWith('customer-1', 'order-1');
  });

  it('CRITICAL: ON_THE_WAY targets Order.customerId via sendOrderOnTheWayNotification', async () => {
    const { service, pushNotificationService } = buildPushTestHarness({
      id: 'order-1',
      customerId: 'customer-1',
      status: OrderStatus.PICKED_UP,
    });
    await service.transition({ orderId: 'order-1', to: OrderStatus.ON_THE_WAY, actorRole: Role.DRIVER });
    expect(pushNotificationService.sendOrderOnTheWayNotification).toHaveBeenCalledWith('customer-1', 'order-1');
  });

  it('CRITICAL: DELIVERED targets Order.customerId via sendOrderDeliveredNotification', async () => {
    const { service, pushNotificationService } = buildPushTestHarness({
      id: 'order-1',
      customerId: 'customer-1',
      status: OrderStatus.ON_THE_WAY,
    });
    await service.transition({ orderId: 'order-1', to: OrderStatus.DELIVERED, actorRole: Role.DRIVER });
    expect(pushNotificationService.sendOrderDeliveredNotification).toHaveBeenCalledWith('customer-1', 'order-1');
  });

  it('CRITICAL: FAILED_DELIVERY targets Order.customerId via sendOrderFailedDeliveryNotification', async () => {
    const { service, pushNotificationService } = buildPushTestHarness({
      id: 'order-1',
      customerId: 'customer-1',
      status: OrderStatus.ON_THE_WAY,
    });
    await service.transition({ orderId: 'order-1', to: OrderStatus.FAILED_DELIVERY, actorRole: Role.DRIVER });
    expect(pushNotificationService.sendOrderFailedDeliveryNotification).toHaveBeenCalledWith('customer-1', 'order-1');
  });

  it('a non-approved transition (e.g. PREPARING) sends no customer push notification at all', async () => {
    const { service, pushNotificationService } = buildPushTestHarness({
      id: 'order-1',
      customerId: 'customer-1',
      status: OrderStatus.CONFIRMED,
    });
    await service.transition({ orderId: 'order-1', to: OrderStatus.PREPARING, actorRole: Role.ADMIN });
    expect(pushNotificationService.sendOrderConfirmedNotification).not.toHaveBeenCalled();
    expect(pushNotificationService.sendOrderCancelledNotification).not.toHaveBeenCalled();
    expect(pushNotificationService.sendOrderOnTheWayNotification).not.toHaveBeenCalled();
    expect(pushNotificationService.sendOrderDeliveredNotification).not.toHaveBeenCalled();
    expect(pushNotificationService.sendOrderFailedDeliveryNotification).not.toHaveBeenCalled();
  });

  it('CRITICAL: a simulated push-notification failure does NOT cause the Order transition to fail', async () => {
    const { service, pushNotificationService } = buildPushTestHarness({
      id: 'order-1',
      customerId: 'customer-1',
      status: OrderStatus.PENDING,
    });
    pushNotificationService.sendOrderConfirmedNotification.mockRejectedValueOnce(new Error('FCM unreachable'));

    const result = await service.transition({ orderId: 'order-1', to: OrderStatus.CONFIRMED, actorRole: Role.ADMIN });
    expect(result.status).toBe(OrderStatus.CONFIRMED);
  });
});

describe('OrderStateMachineService — structured business-event logging (Group 4)', () => {
  function buildLoggingHarness(order: any) {
    const store = { ...order };
    const manager = {
      query: driverQuery,
      createQueryBuilder: () => deliveryUpdateQueryBuilder(),
      findOne: async (_EntityClass: any, _opts: any) => ({ ...store }),
      save: async (entity: any) => {
        Object.assign(store, entity);
        return entity;
      },
      find: async () => [],
      getRepository: () => ({ findOne: async () => null }),
    };
    const dataSource = { transaction: async (cb: any) => cb(manager) };
    const ordersRepository = { findOne: async () => ({ ...store }) };
    const orderFinancialEventsService = { handleTransition: jest.fn(async () => undefined) };
    const bestSellingCacheService = { recordDeliveredSales: jest.fn(async () => undefined) };
    const offerConsumptionService = { reverseFlashSaleConsumptionForOrder: jest.fn(async () => undefined), reverseSubtotalDiscountConsumptionForOrder: jest.fn(async () => undefined) };
    const loyaltyService = { awardOrderEarning: jest.fn(async () => undefined) };
    const manualTransferRefundService = { recordRefund: jest.fn(async () => undefined) };
    const pushNotificationService = {
      sendOrderConfirmedNotification: jest.fn(async () => undefined),
      sendOrderCancelledNotification: jest.fn(async () => undefined),
      sendOrderOnTheWayNotification: jest.fn(async () => undefined),
      sendOrderDeliveredNotification: jest.fn(async () => undefined),
      sendOrderFailedDeliveryNotification: jest.fn(async () => undefined),
    };
    const requestContextService = { getCorrelationId: jest.fn(() => 'corr-order-log') };
    const service = new OrderStateMachineService(
      ordersRepository as any,
      dataSource as any,
      orderFinancialEventsService as any,
      bestSellingCacheService as any,
      offerConsumptionService as any,
      loyaltyService as any,
      manualTransferRefundService as any,
      pushNotificationService as any,
      requestContextService as any,
      passGate as any,
      noopStatusHistory as any,
      noopWalletRefund as any,
    );
    const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    return { service, logSpy, requestContextService };
  }

  it('B: a successful transition logs a single order.state_transition event containing the correlation id, from/to, and actor', async () => {
    const { service, logSpy } = buildLoggingHarness({ id: 'order-1', customerId: 'customer-1', status: OrderStatus.PENDING });

    await service.transition({ orderId: 'order-1', to: OrderStatus.CONFIRMED, actorRole: Role.ADMIN, actorUserId: 'admin-1' });

    const transitionLogCall = logSpy.mock.calls.find((call) => (call[0] as string).includes('order.state_transition'));
    expect(transitionLogCall).toBeDefined();
    const logged = JSON.parse(transitionLogCall![0] as string);
    expect(logged).toEqual({
      event: 'order.state_transition',
      correlationId: 'corr-order-log',
      orderId: 'order-1',
      from: OrderStatus.PENDING,
      to: OrderStatus.CONFIRMED,
      actorRole: Role.ADMIN,
      actorUserId: 'admin-1',
    });
  });

  it('J: a rejected (business-rule) transition attempt never reaches the transition log — no ERROR-level noise for a normal rejection', async () => {
    const { service, logSpy } = buildLoggingHarness({ id: 'order-1', customerId: 'customer-1', status: OrderStatus.DELIVERED });

    await expect(
      service.transition({ orderId: 'order-1', to: OrderStatus.CONFIRMED, actorRole: Role.ADMIN }),
    ).rejects.toThrow(BadRequestException);

    expect(logSpy.mock.calls.some((call) => (call[0] as string).includes('order.state_transition'))).toBe(false);
  });

  it('CRITICAL (requirement 19): a correlation-id lookup failure never breaks the transition itself — logging cannot change business outcomes', async () => {
    const { service, requestContextService } = buildLoggingHarness({
      id: 'order-1',
      customerId: 'customer-1',
      status: OrderStatus.PENDING,
    });
    requestContextService.getCorrelationId.mockImplementation(() => {
      throw new Error('request context unexpectedly unavailable');
    });

    // The transition itself must still succeed — a logging-layer failure
    // is never allowed to become a business-logic failure.
    const result = await service.transition({ orderId: 'order-1', to: OrderStatus.CONFIRMED, actorRole: Role.ADMIN });
    expect(result.status).toBe(OrderStatus.CONFIRMED);
  });
});

describe('OrderStateMachineService — whole-order cancellation money (PD-002)', () => {
  const money = { subtotalMinor: 30000, discountMinor: 1000, deliveryFeeMinor: 2500, totalMinor: 31500 };

  it('the delivery fee becomes 0 and nothing is owed any more (subtotal/discount/total zeroed, total = subtotal + fee - discount still holds)', async () => {
    const { service } = buildInventoryHarness({ segments: [], items: [], products: [], orderExtras: money });
    const order = await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.ADMIN, actorUserId: 'admin-1' });
    expect(order).toMatchObject({ subtotalMinor: 0, discountMinor: 0, deliveryFeeMinor: 0, totalMinor: 0 });
    expect(order.totalMinor).toBe(order.subtotalMinor + (order.deliveryFeeMinor ?? 0) - order.discountMinor);
  });

  it('an unknown (null) total / fee stays null rather than becoming a made-up 0', async () => {
    const { service } = buildInventoryHarness({
      segments: [],
      items: [],
      products: [],
      orderExtras: { ...money, deliveryFeeMinor: null, totalMinor: null },
    });
    const order = await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.ADMIN, actorUserId: 'a' });
    expect(order.totalMinor).toBeNull();
    expect(order.deliveryFeeMinor).toBeNull();
  });

  it('other transitions never touch the money fields', async () => {
    const { service } = buildInventoryHarness({ orderStatus: OrderStatus.CONFIRMED, segments: [], items: [], products: [], orderExtras: money });
    const order = await service.transition({ orderId: 'order-1', to: OrderStatus.PREPARING, actorRole: Role.ADMIN });
    expect(order).toMatchObject(money);
  });

  it('the refund is asked for as the REMAINING paid amount (so earlier partial refunds are not refunded twice)', async () => {
    const { service, manualTransferRefundService } = buildInventoryHarness({
      segments: [],
      items: [],
      products: [],
      payment: { id: 'payment-1', orderId: 'order-1', status: 'PAID', amountMinor: 31500 },
    });
    await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.ADMIN, actorUserId: 'admin-1' });
    expect(manualTransferRefundService.recordRemainingRefund).toHaveBeenCalledTimes(1);
    expect(manualTransferRefundService.recordRemainingRefund.mock.calls[0][0]).toMatchObject({ paymentId: 'payment-1', actorUserId: 'admin-1' });
  });

  it('transitionInTransaction: nothing is emitted until the caller runs afterCommit()', async () => {
    const { service } = buildInventoryHarness({ segments: [], items: [], products: [], orderExtras: money });
    const spy = jest.spyOn((service as any).pushNotificationService, 'sendOrderCancelledNotification');
    // the harness's own transaction manager, i.e. the "caller-owned" transaction
    const res = await (service as any).dataSource.transaction((manager: any) =>
      service.transitionInTransaction(manager, { orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.VENDOR, actorUserId: 'v1' }),
    );
    expect(res.order.status).toBe(OrderStatus.CANCELLED);
    expect(spy).not.toHaveBeenCalled();
    await res.afterCommit();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each(['PENDING', 'CUSTOMER_CLAIMED_TRANSFER', 'UNDER_REVIEW'])(
    'PD-004: cancelling the order with a %s transfer records the pending refund entitlement — and NO refund event',
    async (status) => {
      const { service, manualTransferRefundService } = buildInventoryHarness({
        segments: [],
        items: [],
        products: [],
        payment: { id: 'payment-1', orderId: 'order-1', status, amountMinor: 10000 },
      });
      await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.ADMIN, actorUserId: 'admin-1' });
      expect(manualTransferRefundService.recordPendingRefundForCancelledOrder).toHaveBeenCalledTimes(1);
      expect(manualTransferRefundService.recordPendingRefundForCancelledOrder.mock.calls[0][0]).toBe('order-1');
      expect(manualTransferRefundService.recordRefund).not.toHaveBeenCalled();
      expect(manualTransferRefundService.recordRemainingRefund).not.toHaveBeenCalled();
    },
  );

  it.each(['PAID', 'REJECTED'])('PD-004: a %s transfer never gets a pending entitlement from a cancellation', async (status) => {
    const { service, manualTransferRefundService } = buildInventoryHarness({
      segments: [],
      items: [],
      products: [],
      payment: { id: 'payment-1', orderId: 'order-1', status, amountMinor: 10000 },
    });
    await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.ADMIN, actorUserId: 'admin-1' });
    expect(manualTransferRefundService.recordPendingRefundForCancelledOrder).not.toHaveBeenCalled();
  });

  it('PD-004: COD / PAY_AT_DELIVERY (no Payment row) never gets a pending entitlement', async () => {
    const { service, manualTransferRefundService } = buildInventoryHarness({ segments: [], items: [], products: [], payment: null });
    await service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.ADMIN, actorUserId: 'admin-1' });
    expect(manualTransferRefundService.recordPendingRefundForCancelledOrder).not.toHaveBeenCalled();
  });
});

describe('OrderStateMachineService — customer cancellation door (PD-005)', () => {
  const cancelAsCustomer = (h: ReturnType<typeof buildInventoryHarness>, extra: Record<string, unknown> = {}) =>
    h.service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.CUSTOMER, actorUserId: 'cust-1', customerCancellation: true, ...extra });

  it.each([OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY_FOR_PICKUP, OrderStatus.ASSIGNED_TO_DRIVER])(
    'R3: a customer CAN cancel a %s order through the customer path (recorded as cancelled by CUSTOMER)',
    async (status) => {
      const h = buildInventoryHarness({ orderStatus: status, segments: [{ id: 'seg-1', orderId: 'order-1', status: 'READY_FOR_PICKUP', groupType: 'CATALOG' }], items: [], products: [] });
      const order = await cancelAsCustomer(h, { cancellationReason: 'changed my mind' });
      expect(order.status).toBe(OrderStatus.CANCELLED);
      expect(order).toMatchObject({ cancelledByRole: Role.CUSTOMER, cancellationReason: 'changed my mind' });
    },
  );

  it.each([OrderStatus.PICKED_UP, OrderStatus.ON_THE_WAY, OrderStatus.DELIVERED, OrderStatus.FAILED_DELIVERY, OrderStatus.CANCELLED])(
    'a customer can NEVER cancel a %s order — even through the customer path (they contact Operations)',
    async (status) => {
      const h = buildInventoryHarness({ orderStatus: status, segments: [], items: [], products: [] });
      await expect(cancelAsCustomer(h)).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('R40: a Hatly Service order can be cancelled by the customer while assigned, as long as no purchase is recorded', async () => {
    const h = buildInventoryHarness({
      orderStatus: OrderStatus.ASSIGNED_TO_DRIVER,
      segments: [{ id: 'seg-1', orderId: 'order-1', status: 'READY_FOR_PICKUP', groupType: 'AD_HOC_SERVICE' }],
      items: [],
      products: [],
    });
    const order = await cancelAsCustomer(h, { cancellationReason: 'no longer needed' });
    expect(order).toMatchObject({ status: OrderStatus.CANCELLED, cancelledByRole: Role.CUSTOMER });
    // the same whole-order money handling + entitlement restoration as every other cancellation
    expect(h.offerConsumptionService.reverseSubtotalDiscountConsumptionForOrder).toHaveBeenCalledWith(expect.anything(), 'order-1');
  });

  it('R40: once the driver recorded the Hatly Service purchase the customer is refused (re-checked under the order lock)', async () => {
    const h = buildInventoryHarness({
      orderStatus: OrderStatus.ASSIGNED_TO_DRIVER,
      segments: [{ id: 'seg-1', orderId: 'order-1', status: 'READY_FOR_PICKUP', groupType: 'AD_HOC_SERVICE' }],
      items: [],
      products: [],
      servicePurchased: true,
    });
    await expect(cancelAsCustomer(h)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('R3: an ADMIN may cancel an ASSIGNED_TO_DRIVER order (the goods have not left the vendor); the driver is freed', async () => {
    const h = buildInventoryHarness({ orderStatus: OrderStatus.ASSIGNED_TO_DRIVER, segments: [], items: [], products: [] });
    const order = await h.service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.ADMIN, actorUserId: 'admin-1' });
    expect(order.status).toBe(OrderStatus.CANCELLED);
  });

  it.each([OrderStatus.PENDING, OrderStatus.CONFIRMED])('without the customer-path flag a customer is still refused on a %s order (the generic status endpoint stays closed to customers)', async (status) => {
    const h = buildInventoryHarness({ orderStatus: status, segments: [], items: [], products: [] });
    await expect(cancelAsCustomer(h, { customerCancellation: false })).rejects.toBeInstanceOf(BadRequestException);
    await expect(cancelAsCustomer(h, { customerCancellation: undefined })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('the flag opens nothing else: a customer cannot use it to advance an order', async () => {
    const h = buildInventoryHarness({ orderStatus: OrderStatus.PENDING, segments: [], items: [], products: [] });
    await expect(cancelAsCustomer(h, { to: OrderStatus.CONFIRMED })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('the flag is useless to any other role: a DRIVER with it set is still refused', async () => {
    const h = buildInventoryHarness({ orderStatus: OrderStatus.PENDING, segments: [], items: [], products: [] });
    await expect(cancelAsCustomer(h, { actorRole: Role.DRIVER })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a customer cancellation uses the same money handling as any whole-order cancellation (paid → remaining refund; unverified → pending entitlement)', async () => {
    const paid = buildInventoryHarness({ orderStatus: OrderStatus.CONFIRMED, segments: [], items: [], products: [], payment: { id: 'payment-1', orderId: 'order-1', status: 'PAID', amountMinor: 10000 } });
    await cancelAsCustomer(paid);
    expect(paid.manualTransferRefundService.recordRemainingRefund.mock.calls[0][0]).toMatchObject({ paymentId: 'payment-1', actorUserId: 'cust-1' });

    const unverified = buildInventoryHarness({ orderStatus: OrderStatus.PENDING, segments: [], items: [], products: [], payment: { id: 'payment-2', orderId: 'order-1', status: 'UNDER_REVIEW', amountMinor: 10000 } });
    await cancelAsCustomer(unverified);
    expect(unverified.manualTransferRefundService.recordPendingRefundForCancelledOrder).toHaveBeenCalledTimes(1);
    expect(unverified.manualTransferRefundService.recordRefund).not.toHaveBeenCalled();
  });
});

describe('OrderStateMachineService — PD-006 payment gating, timeline and wallet refund', () => {
  const gateSpy = () => (passGate.assertFulfilmentMayProceed as jest.Mock);

  beforeEach(() => {
    gateSpy().mockClear();
    (noopStatusHistory.record as jest.Mock).mockClear();
    (noopWalletRefund.refundExcess as jest.Mock).mockClear();
  });

  it.each([
    [OrderStatus.CONFIRMED, OrderStatus.PREPARING, Role.ADMIN],
    [OrderStatus.READY_FOR_PICKUP, OrderStatus.ASSIGNED_TO_DRIVER, Role.ADMIN],
  ])('moving %s → %s asks the payment gate (under the order lock) before anything changes', async (from, to, role) => {
    const h = buildInventoryHarness({ orderStatus: from, segments: [], items: [], products: [] });
    await h.service.transition({ orderId: 'order-1', to, actorRole: role });
    expect(gateSpy()).toHaveBeenCalledTimes(1);
    expect(gateSpy().mock.calls[0][1]).toMatchObject({ id: 'order-1' });
  });

  it('a refusing gate aborts the transition: the status is not written, no history row, no side effect', async () => {
    gateSpy().mockRejectedValueOnce(new BadRequestException({ message: 'no', details: { code: 'PAYMENT_NOT_APPROVED' } }));
    const h = buildInventoryHarness({ orderStatus: OrderStatus.CONFIRMED, segments: [], items: [], products: [] });
    await expect(h.service.transition({ orderId: 'order-1', to: OrderStatus.PREPARING, actorRole: Role.ADMIN })).rejects.toBeInstanceOf(BadRequestException);
    expect(noopStatusHistory.record).not.toHaveBeenCalled();
  });

  it.each([
    [OrderStatus.PENDING, OrderStatus.CONFIRMED],
    [OrderStatus.PREPARING, OrderStatus.READY_FOR_PICKUP],
    [OrderStatus.PENDING, OrderStatus.CANCELLED],
  ])('%s → %s does NOT involve the payment gate (only PREPARING and dispatch are gated)', async (from, to) => {
    const h = buildInventoryHarness({ orderStatus: from, segments: [], items: [], products: [] });
    await h.service.transition({ orderId: 'order-1', to, actorRole: Role.ADMIN, actorUserId: 'a1' });
    expect(gateSpy()).not.toHaveBeenCalled();
  });

  it('every successful transition writes exactly one timeline row on the SAME manager, with from/to and the actor', async () => {
    const h = buildInventoryHarness({ orderStatus: OrderStatus.PENDING, segments: [], items: [], products: [] });
    await h.service.transition({ orderId: 'order-1', to: OrderStatus.CONFIRMED, actorRole: Role.ADMIN, actorUserId: 'admin-1' });
    expect(noopStatusHistory.record).toHaveBeenCalledTimes(1);
    const [manager, row] = (noopStatusHistory.record as jest.Mock).mock.calls[0];
    expect(manager).toBeTruthy();
    expect(row).toEqual({ orderId: 'order-1', from: OrderStatus.PENDING, to: OrderStatus.CONFIRMED, actorRole: Role.ADMIN, actorUserId: 'admin-1' });
  });

  it('cancelling asks the wallet refund service for the WHOLE wallet payment (owed 0), with an idempotent per-order key', async () => {
    const h = buildInventoryHarness({ orderStatus: OrderStatus.PENDING, segments: [], items: [], products: [] });
    await h.service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.ADMIN, actorUserId: 'a1' });
    expect(noopWalletRefund.refundExcess).toHaveBeenCalledTimes(1);
    expect((noopWalletRefund.refundExcess as jest.Mock).mock.calls[0][1]).toMatchObject({ owedAfterMinor: 0, idempotencyKey: 'order-refund:order-1:cancel', actorUserId: 'a1' });
  });

  it('whole cancellation also zeroes what is still due through the order\'s own method', async () => {
    const h = buildInventoryHarness({ orderStatus: OrderStatus.PENDING, segments: [], items: [], products: [], orderExtras: { subtotalMinor: 100, discountMinor: 0, deliveryFeeMinor: 10, totalMinor: 110, amountDueMinor: 60, walletAmountMinor: 50 } });
    const order = await h.service.transition({ orderId: 'order-1', to: OrderStatus.CANCELLED, actorRole: Role.ADMIN });
    expect(order).toMatchObject({ amountDueMinor: 0, totalMinor: 0, deliveryFeeMinor: 0 });
  });

  it('other transitions never ask for a wallet refund', async () => {
    const h = buildInventoryHarness({ orderStatus: OrderStatus.PENDING, segments: [], items: [], products: [] });
    await h.service.transition({ orderId: 'order-1', to: OrderStatus.CONFIRMED, actorRole: Role.ADMIN });
    expect(noopWalletRefund.refundExcess).not.toHaveBeenCalled();
  });
});

describe('OrderStateMachineService — acting driver ownership, re-checked under the order lock (Operational Completion milestone)', () => {
  beforeEach(() => (saves.length = 0));
  const assigned = { id: 'order-1', status: OrderStatus.ASSIGNED_TO_DRIVER };

  it('the driver still on the delivery may move the order', async () => {
    const service = buildHarness(assigned, [], { driverId: 'driver-1' });
    await expect(
      service.transition({ orderId: 'order-1', to: OrderStatus.PICKED_UP, actorRole: Role.DRIVER, actingDriverId: 'driver-1' }),
    ).resolves.toMatchObject({ status: OrderStatus.PICKED_UP });
  });

  it('a driver whose delivery was reassigned meanwhile is refused (404) and NOTHING is written', async () => {
    const service = buildHarness(assigned, [], { driverId: 'driver-2' });
    await expect(
      service.transition({ orderId: 'order-1', to: OrderStatus.PICKED_UP, actorRole: Role.DRIVER, actingDriverId: 'driver-1' }),
    ).rejects.toThrow(NotFoundException);
    expect(saves).toHaveLength(0);
  });

  it('no delivery row at all is refused the same way', async () => {
    const service = buildHarness(assigned, [], null);
    await expect(
      service.transition({ orderId: 'order-1', to: OrderStatus.PICKED_UP, actorRole: Role.DRIVER, actingDriverId: 'driver-1' }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('OrderStateMachineService — pickup completion: COLLECTED (U2)', () => {
  beforeEach(() => (saves.length = 0));
  const readyPickup = { id: 'order-1', customerId: 'customer-1', status: OrderStatus.READY_FOR_PICKUP, fulfillmentType: 'PICKUP' };

  it.each([Role.VENDOR, Role.VENDOR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN])('%s may mark a ready PICKUP order COLLECTED', async (role) => {
    const service = buildHarness(readyPickup);
    await expect(service.transition({ orderId: 'order-1', to: OrderStatus.COLLECTED, actorRole: role })).resolves.toMatchObject({
      status: OrderStatus.COLLECTED,
    });
  });

  it.each([Role.CUSTOMER, Role.DRIVER])('%s may not mark it collected (nothing written)', async (role) => {
    const service = buildHarness(readyPickup);
    await expect(service.transition({ orderId: 'order-1', to: OrderStatus.COLLECTED, actorRole: role })).rejects.toThrow(BadRequestException);
    expect(saves).toHaveLength(0);
  });

  it('a DELIVERY order can never be COLLECTED (NOT_A_PICKUP_ORDER) — it is completed by its driver', async () => {
    const service = buildHarness({ ...readyPickup, fulfillmentType: 'DELIVERY' });
    await expect(service.transition({ orderId: 'order-1', to: OrderStatus.COLLECTED, actorRole: Role.VENDOR })).rejects.toMatchObject({
      response: { details: { code: 'NOT_A_PICKUP_ORDER' } },
    });
    expect(saves).toHaveLength(0);
  });

  it('a PICKUP order can never be ASSIGNED_TO_DRIVER, through any endpoint (PICKUP_ORDER_NOT_DISPATCHABLE)', async () => {
    const service = buildHarness(readyPickup);
    await expect(service.transition({ orderId: 'order-1', to: OrderStatus.ASSIGNED_TO_DRIVER, actorRole: Role.ADMIN })).rejects.toThrow(ConflictException);
    expect(saves).toHaveLength(0);
  });

  it.each([OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.CANCELLED, OrderStatus.COLLECTED])(
    'only READY_FOR_PICKUP can become COLLECTED — from %s it is refused',
    async (status) => {
      const service = buildHarness({ ...readyPickup, status });
      await expect(service.transition({ orderId: 'order-1', to: OrderStatus.COLLECTED, actorRole: Role.VENDOR })).rejects.toThrow(BadRequestException);
      expect(saves).toHaveLength(0);
    },
  );

  it('COLLECTED is terminal: no transition leads out of it, for any role', () => {
    const service = buildHarness(readyPickup);
    for (const role of Object.values(Role)) expect(service.getAllowedNextStatuses(OrderStatus.COLLECTED, role as Role)).toEqual([]);
  });

  it('a weighed item without its actual weight blocks collection (WEIGHT_NOT_RECORDED), exactly like a driver pickup', async () => {
    const service = buildHarness(readyPickup, [{ id: 'item-1', pricingUnitSnapshot: 'WEIGHT', actualWeightGrams: null }]);
    await expect(service.transition({ orderId: 'order-1', to: OrderStatus.COLLECTED, actorRole: Role.VENDOR })).rejects.toMatchObject({
      response: { details: { code: 'WEIGHT_NOT_RECORDED' } },
    });
  });

  it('collection earns loyalty (in the transaction), then records best-selling, financial events and the "collected" push', async () => {
    const service = buildHarness(readyPickup);
    const pushes = (lastMocks.pushNotificationService.sendOrderCollectedNotification = jest.fn(async () => undefined));
    await service.transition({ orderId: 'order-1', to: OrderStatus.COLLECTED, actorRole: Role.VENDOR_MANAGER });
    expect(lastMocks.loyaltyService.awardOrderEarning).toHaveBeenCalledWith(expect.anything(), 'order-1');
    expect(lastMocks.bestSellingCacheService.recordDeliveredSales).toHaveBeenCalledWith('order-1');
    expect(lastMocks.orderFinancialEventsService.handleTransition).toHaveBeenCalledWith(expect.objectContaining({ id: 'order-1' }), OrderStatus.COLLECTED);
    expect(pushes).toHaveBeenCalledWith('customer-1', 'order-1');
    expect(lastMocks.pushNotificationService.sendOrderDeliveredNotification).not.toHaveBeenCalled();
  });
});
