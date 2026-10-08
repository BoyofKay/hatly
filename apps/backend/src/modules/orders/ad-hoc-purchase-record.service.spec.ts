import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AdHocPurchaseRecordService } from './ad-hoc-purchase-record.service';
import { OrderItem } from './entities/order-item.entity';
import { OrderVendorSegment } from './entities/order-vendor-segment.entity';
import { Order } from './entities/order.entity';
import { AdHocPurchaseRecord } from './entities/ad-hoc-purchase-record.entity';
import { Delivery } from '../delivery/entities/delivery.entity';

function buildHarness(seed: {
  items: any[];
  segments: any[];
  orders: any[];
  deliveries?: any[];
  ownedBranchIds?: string[];
}) {
  const items = new Map(seed.items.map((i) => [i.id, i]));
  const segments = new Map(seed.segments.map((s) => [s.id, s]));
  const orders = new Map(seed.orders.map((o) => [o.id, o]));
  const deliveries = new Map((seed.deliveries ?? []).map((d) => [d.id, d]));
  const records = new Map<string, any>();
  const locks: string[] = [];

  const manager = {
    findOne: async (EntityClass: any, opts: any) => {
      if (opts?.lock) locks.push(EntityClass.name);
      if (EntityClass === OrderItem) return items.get(opts.where.id) ?? null;
      if (EntityClass === OrderVendorSegment) return segments.get(opts.where.id) ?? null;
      if (EntityClass === Order) return orders.get(opts.where.id) ?? null;
      if (EntityClass === Delivery) return [...deliveries.values()].find((d) => d.orderId === opts.where.orderId) ?? null;
      if (EntityClass === AdHocPurchaseRecord) {
        return [...records.values()].find((r) => r.orderItemId === opts.where.orderItemId) ?? null;
      }
      throw new Error(`unhandled findOne ${EntityClass.name}`);
    },
    create: (_EntityClass: any, data: any) => ({ ...data }),
    save: async (EntityClass: any, entity: any) => {
      const withId = { id: entity.id ?? randomUUID(), ...entity };
      if (EntityClass === AdHocPurchaseRecord) records.set(withId.id, withId);
      else if (EntityClass === OrderItem) items.set(withId.id, withId);
      else if (EntityClass === OrderVendorSegment) segments.set(withId.id, withId);
      else if (EntityClass === Order) orders.set(withId.id, withId);
      return withId;
    },
    createQueryBuilder: (_EntityClass: any, _alias: string) => {
      const qb: any = {
        innerJoin: () => qb,
        where: (_sql: string, params: any) => {
          qb._orderId = params.orderId;
          return qb;
        },
        getMany: async () =>
          [...items.values()].filter((i) => segments.get(i.orderVendorSegmentId)?.orderId === qb._orderId),
      };
      return qb;
    },
    update: async (EntityClass: any, criteria: any, patch: any) => {
      if (EntityClass === Order) {
        const order = orders.get(criteria.id);
        if (order) Object.assign(order, patch);
      }
    },
  };

  const dataSource = { transaction: async (cb: any) => cb(manager) };
  const financialEventService = { record: jest.fn(async () => undefined) };
  const vendorStaffAuthorizationService = {
    getOwnedBranchIds: jest.fn(async () => seed.ownedBranchIds ?? []),
  };
  const driverAuthorizationService = {
    getDriverForUser: jest.fn(async (userId: string) => ({ id: `driver-of-${userId}` })),
  };

  const service = new AdHocPurchaseRecordService(
    dataSource as any,
    financialEventService as any,
    vendorStaffAuthorizationService as any,
    driverAuthorizationService as any,
  );
  return { service, items, segments, orders, deliveries, records, financialEventService, locks };
}

function customItem(overrides: Partial<any> = {}) {
  return { id: 'item-1', productId: null, orderVendorSegmentId: 'seg-1', actualAmountMinor: null, ...overrides };
}
function segment(overrides: Partial<any> = {}) {
  return { id: 'seg-1', orderId: 'order-1', vendorBranchId: 'branch-1', subtotalMinor: 0, ...overrides };
}
function order(overrides: Partial<any> = {}) {
  return { id: 'order-1', subtotalMinor: 100, totalMinor: 130, hasPendingAdHocPricing: true, ...overrides };
}

describe('AdHocPurchaseRecordService.recordVendorPrice', () => {
  it('a Vendor can record a final price for a vendor-scoped custom CATALOG item', async () => {
    const { service, records } = buildHarness({
      items: [customItem()],
      segments: [segment()],
      orders: [order()],
      ownedBranchIds: ['branch-1'],
    });
    const record = await service.recordVendorPrice('item-1', 5000, 'vendor-user-1');
    expect(record.amountMinor).toBe(5000);
    expect(record.recordedByRole).toBe('VENDOR');
    expect(records.size).toBe(1);
  });

  it('CRITICAL: Vendor pricing does NOT create DRIVER_REIMBURSEMENT_OWED', async () => {
    const { service, financialEventService } = buildHarness({
      items: [customItem()],
      segments: [segment()],
      orders: [order()],
      ownedBranchIds: ['branch-1'],
    });
    await service.recordVendorPrice('item-1', 5000, 'vendor-user-1');
    expect(financialEventService.record).not.toHaveBeenCalled();
  });

  it('rejects a Vendor Staff user not authorized for the item\u2019s branch', async () => {
    const { service } = buildHarness({
      items: [customItem()],
      segments: [segment()],
      orders: [order()],
      ownedBranchIds: ['some-other-branch'],
    });
    await expect(service.recordVendorPrice('item-1', 5000, 'vendor-user-1')).rejects.toThrow(NotFoundException);
  });
});

describe('AdHocPurchaseRecordService.recordDriverPurchase', () => {
  it('a Driver can record a final price for an eligible custom item', async () => {
    const { service, records } = buildHarness({
      items: [customItem()],
      segments: [segment()],
      orders: [order()],
      deliveries: [{ id: 'delivery-1', orderId: 'order-1', driverId: 'driver-of-driver-user-1' }],
    });
    const record = await service.recordDriverPurchase('item-1', 4500, 'driver-user-1');
    expect(record.amountMinor).toBe(4500);
    expect(record.recordedByRole).toBe('DRIVER');
    expect(records.size).toBe(1);
  });

  it('CRITICAL: Driver pricing preserves the existing DRIVER_REIMBURSEMENT_OWED behavior', async () => {
    const { service, financialEventService } = buildHarness({
      items: [customItem()],
      segments: [segment()],
      orders: [order()],
      deliveries: [{ id: 'delivery-1', orderId: 'order-1', driverId: 'driver-of-driver-user-1' }],
    });
    await service.recordDriverPurchase('item-1', 4500, 'driver-user-1');
    expect(financialEventService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'DRIVER_REIMBURSEMENT_OWED',
        amountMinor: 4500,
        orderId: 'order-1',
        driverId: 'driver-of-driver-user-1',
        idempotencyKey: 'hatly-service-reimbursement:item-1',
      }),
    );
  });

  it('rejects a Driver not assigned to the item\u2019s Order', async () => {
    const { service } = buildHarness({
      items: [customItem()],
      segments: [segment()],
      orders: [order()],
      deliveries: [{ id: 'delivery-1', orderId: 'order-1', driverId: 'driver-of-someone-else' }],
    });
    await expect(service.recordDriverPurchase('item-1', 4500, 'driver-user-1')).rejects.toThrow(NotFoundException);
  });

  it('CRITICAL: existing External Hatly Service Driver purchase behavior remains unchanged (AD_HOC_SERVICE item, no vendorBranchId)', async () => {
    const { service, records, financialEventService } = buildHarness({
      items: [customItem()],
      segments: [segment({ vendorBranchId: null })],
      orders: [order()],
      deliveries: [{ id: 'delivery-1', orderId: 'order-1', driverId: 'driver-of-driver-user-1' }],
    });
    const record = await service.recordDriverPurchase('item-1', 3000, 'driver-user-1');
    expect(record.amountMinor).toBe(3000);
    expect(financialEventService.record).toHaveBeenCalledTimes(1);
    expect(records.size).toBe(1);
  });
});

describe('AdHocPurchaseRecordService — shared eligibility/financial rules', () => {
  it('CRITICAL: a normal catalog product cannot be priced through this mechanism', async () => {
    const { service } = buildHarness({
      items: [customItem({ productId: 'real-product-1' })],
      segments: [segment()],
      orders: [order()],
      ownedBranchIds: ['branch-1'],
    });
    await expect(service.recordVendorPrice('item-1', 5000, 'vendor-user-1')).rejects.toThrow(BadRequestException);
  });

  it('CRITICAL: an already-priced custom item cannot be priced again', async () => {
    const { service } = buildHarness({
      items: [customItem({ actualAmountMinor: 5000 })],
      segments: [segment()],
      orders: [order()],
      ownedBranchIds: ['branch-1'],
    });
    await expect(service.recordVendorPrice('item-1', 6000, 'vendor-user-1')).rejects.toThrow(ConflictException);
  });

  it('the final price is stored in actualAmountMinor', async () => {
    const { service, items } = buildHarness({
      items: [customItem()],
      segments: [segment()],
      orders: [order()],
      ownedBranchIds: ['branch-1'],
    });
    await service.recordVendorPrice('item-1', 5000, 'vendor-user-1');
    expect(items.get('item-1').actualAmountMinor).toBe(5000);
  });

  it('CRITICAL: OrderItem.unitPriceMinor remains NULL', async () => {
    const { service, items } = buildHarness({
      items: [customItem({ unitPriceMinor: null })],
      segments: [segment()],
      orders: [order()],
      ownedBranchIds: ['branch-1'],
    });
    await service.recordVendorPrice('item-1', 5000, 'vendor-user-1');
    expect(items.get('item-1').unitPriceMinor).toBeNull();
  });

  it('AdHocPurchaseRecord is created exactly once', async () => {
    const { service, records } = buildHarness({
      items: [customItem()],
      segments: [segment()],
      orders: [order()],
      ownedBranchIds: ['branch-1'],
    });
    await service.recordVendorPrice('item-1', 5000, 'vendor-user-1');
    expect(records.size).toBe(1);
  });

  it('CRITICAL: segment subtotal increases by the final amount', async () => {
    const { service, segments } = buildHarness({
      items: [customItem()],
      segments: [segment({ subtotalMinor: 10000 })],
      orders: [order()],
      ownedBranchIds: ['branch-1'],
    });
    await service.recordVendorPrice('item-1', 5000, 'vendor-user-1');
    expect(segments.get('seg-1').subtotalMinor).toBe(15000);
  });

  it('CRITICAL: order subtotal increases by the final amount', async () => {
    const { service, orders } = buildHarness({
      items: [customItem()],
      segments: [segment()],
      orders: [order({ subtotalMinor: 10000 })],
      ownedBranchIds: ['branch-1'],
    });
    await service.recordVendorPrice('item-1', 5000, 'vendor-user-1');
    expect(orders.get('order-1').subtotalMinor).toBe(15000);
  });

  it('CRITICAL: order total increases by the final amount when already known', async () => {
    const { service, orders } = buildHarness({
      items: [customItem()],
      segments: [segment()],
      orders: [order({ subtotalMinor: 10000, totalMinor: 13000 })],
      ownedBranchIds: ['branch-1'],
    });
    await service.recordVendorPrice('item-1', 5000, 'vendor-user-1');
    expect(orders.get('order-1').totalMinor).toBe(18000);
  });

  it('CRITICAL: order total remains NULL when it was previously NULL — never fabricated', async () => {
    const { service, orders } = buildHarness({
      items: [customItem()],
      segments: [segment()],
      orders: [order({ subtotalMinor: 10000, totalMinor: null })],
      ownedBranchIds: ['branch-1'],
    });
    await service.recordVendorPrice('item-1', 5000, 'vendor-user-1');
    expect(orders.get('order-1').totalMinor).toBeNull();
  });

  it('CRITICAL: hasPendingAdHocPricing becomes false when the last pending custom item is priced', async () => {
    const { service, orders } = buildHarness({
      items: [customItem()],
      segments: [segment()],
      orders: [order({ hasPendingAdHocPricing: true })],
      ownedBranchIds: ['branch-1'],
    });
    await service.recordVendorPrice('item-1', 5000, 'vendor-user-1');
    expect(orders.get('order-1').hasPendingAdHocPricing).toBe(false);
  });

  it('hasPendingAdHocPricing stays true when another custom item in the same order is still unpriced', async () => {
    const { service, orders } = buildHarness({
      items: [customItem(), customItem({ id: 'item-2', orderVendorSegmentId: 'seg-1' })],
      segments: [segment()],
      orders: [order({ hasPendingAdHocPricing: true })],
      ownedBranchIds: ['branch-1'],
    });
    await service.recordVendorPrice('item-1', 5000, 'vendor-user-1');
    expect(orders.get('order-1').hasPendingAdHocPricing).toBe(true);
  });

  it('CRITICAL: concurrent/double pricing cannot apply the financial delta twice — the second attempt is rejected before any further mutation', async () => {
    const { service, orders } = buildHarness({
      items: [customItem()],
      segments: [segment()],
      orders: [order({ subtotalMinor: 10000, totalMinor: 13000 })],
      ownedBranchIds: ['branch-1'],
    });
    await service.recordVendorPrice('item-1', 5000, 'vendor-user-1');
    await expect(service.recordVendorPrice('item-1', 5000, 'vendor-user-1')).rejects.toThrow(ConflictException);
    // Total only ever moved once, not twice.
    expect(orders.get('order-1').totalMinor).toBe(18000);
  });

  it('CRITICAL: a Driver cannot re-price an item the Vendor already priced (cross-actor protection)', async () => {
    const { service } = buildHarness({
      items: [customItem()],
      segments: [segment()],
      orders: [order()],
      ownedBranchIds: ['branch-1'],
      deliveries: [{ id: 'delivery-1', orderId: 'order-1', driverId: 'driver-of-driver-user-1' }],
    });
    await service.recordVendorPrice('item-1', 5000, 'vendor-user-1');
    await expect(service.recordDriverPurchase('item-1', 6000, 'driver-user-1')).rejects.toThrow(ConflictException);
  });
});


describe('AdHocPurchaseRecordService.confirmHatlyServicePrice (operations confirm a Hatly Service price)', () => {
  const hatlyItem = (over: Partial<any> = {}) => customItem(over);
  const hatlySegment = (over: Partial<any> = {}) => segment({ vendorBranchId: null, groupType: 'AD_HOC_SERVICE', subtotalMinor: 0, ...over });
  const pendingOrder = (over: Partial<any> = {}) =>
    order({ status: 'PENDING', subtotalMinor: 0, deliveryFeeMinor: 11000, discountMinor: 0, totalMinor: null, amountDueMinor: null, walletAmountMinor: 0, hasPendingAdHocPricing: true, ...over });

  it('records an ADMIN price, recomputes subtotal/total/amount due authoritatively and clears the pending flag', async () => {
    const { service, orders, segments, items, records } = buildHarness({ items: [hatlyItem()], segments: [hatlySegment()], orders: [pendingOrder()] });
    const { record, alreadyApplied } = await service.confirmHatlyServicePrice('item-1', 25000, 'admin-1');
    expect(alreadyApplied).toBe(false);
    expect(record).toMatchObject({ amountMinor: 25000, recordedByRole: 'ADMIN', recordedByUserId: 'admin-1', recordedByDriverId: null });
    expect(records.size).toBe(1);
    expect(items.get('item-1').actualAmountMinor).toBe(25000);
    expect(segments.get('seg-1').subtotalMinor).toBe(25000);
    expect(orders.get('order-1')).toMatchObject({ subtotalMinor: 25000, totalMinor: 36000, amountDueMinor: 36000, hasPendingAdHocPricing: false });
  });

  it('never fires DRIVER_REIMBURSEMENT_OWED (no driver advanced any money)', async () => {
    const { service, financialEventService } = buildHarness({ items: [hatlyItem()], segments: [hatlySegment()], orders: [pendingOrder()] });
    await service.confirmHatlyServicePrice('item-1', 25000, 'admin-1');
    expect(financialEventService.record).not.toHaveBeenCalled();
  });

  it('keeps the total UNKNOWN (null, never a partial number) while another Hatly Service item is still pending', async () => {
    const { service, orders } = buildHarness({
      items: [hatlyItem({ id: 'item-1' }), hatlyItem({ id: 'item-2' })],
      segments: [hatlySegment()],
      orders: [pendingOrder()],
    });
    await service.confirmHatlyServicePrice('item-1', 10000, 'admin-1');
    expect(orders.get('order-1')).toMatchObject({ subtotalMinor: 10000, totalMinor: null, amountDueMinor: null, hasPendingAdHocPricing: true });
    await service.confirmHatlyServicePrice('item-2', 5000, 'admin-1');
    expect(orders.get('order-1')).toMatchObject({ subtotalMinor: 15000, totalMinor: 26000, amountDueMinor: 26000, hasPendingAdHocPricing: false });
  });

  it('is idempotent: the same confirmation again returns the existing record, changes nothing and does not double-count', async () => {
    const { service, orders, records } = buildHarness({ items: [hatlyItem()], segments: [hatlySegment()], orders: [pendingOrder()] });
    const first = await service.confirmHatlyServicePrice('item-1', 25000, 'admin-1');
    const again = await service.confirmHatlyServicePrice('item-1', 25000, 'admin-2');
    expect(again.alreadyApplied).toBe(true);
    expect(again.record.id).toBe(first.record.id);
    expect(records.size).toBe(1);
    expect(orders.get('order-1')).toMatchObject({ subtotalMinor: 25000, totalMinor: 36000 });
  });

  it('refuses a DIFFERENT amount for an already-priced item (a recorded price is evidence and is never rewritten)', async () => {
    const { service, orders } = buildHarness({ items: [hatlyItem()], segments: [hatlySegment()], orders: [pendingOrder()] });
    await service.confirmHatlyServicePrice('item-1', 25000, 'admin-1');
    await expect(service.confirmHatlyServicePrice('item-1', 30000, 'admin-1')).rejects.toMatchObject({ response: { details: { code: 'PURCHASE_ALREADY_RECORDED' } } });
    expect(orders.get('order-1').subtotalMinor).toBe(25000);
  });

  it('an item already priced by the DRIVER is not silently re-priced by operations, even at the same amount', async () => {
    const { service } = buildHarness({
      items: [hatlyItem()], segments: [hatlySegment()], orders: [pendingOrder()],
      deliveries: [{ id: 'd1', orderId: 'order-1', driverId: 'driver-of-driver-user-1' }],
    });
    await service.recordDriverPurchase('item-1', 25000, 'driver-user-1');
    await expect(service.confirmHatlyServicePrice('item-1', 25000, 'admin-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([0, -5, 1.5, NaN])('rejects a non-positive-integer amount (%s) before touching anything', async (amount) => {
    const { service, records } = buildHarness({ items: [hatlyItem()], segments: [hatlySegment()], orders: [pendingOrder()] });
    await expect(service.confirmHatlyServicePrice('item-1', amount as number, 'admin-1')).rejects.toMatchObject({ response: { details: { code: 'INVALID_FINAL_AMOUNT' } } });
    expect(records.size).toBe(0);
  });

  it('only a Hatly Service (AD_HOC_SERVICE) request can be confirmed by operations — never a vendor custom item or a catalog product', async () => {
    const vendorScoped = buildHarness({ items: [hatlyItem()], segments: [segment({ groupType: 'CATALOG' })], orders: [pendingOrder()] });
    await expect(vendorScoped.service.confirmHatlyServicePrice('item-1', 100, 'admin-1')).rejects.toMatchObject({ response: { details: { code: 'NOT_A_HATLY_SERVICE_ITEM' } } });
    const catalogItem = buildHarness({ items: [hatlyItem({ productId: 'product-1' })], segments: [hatlySegment()], orders: [pendingOrder()] });
    await expect(catalogItem.service.confirmHatlyServicePrice('item-1', 100, 'admin-1')).rejects.toMatchObject({ response: { details: { code: 'NOT_A_CUSTOM_ITEM' } } });
  });

  it.each(['DELIVERED', 'CANCELLED', 'FAILED_DELIVERY'])('refuses to price an order that is already %s', async (status) => {
    const { service, records } = buildHarness({ items: [hatlyItem()], segments: [hatlySegment()], orders: [pendingOrder({ status })] });
    await expect(service.confirmHatlyServicePrice('item-1', 100, 'admin-1')).rejects.toMatchObject({ response: { details: { code: 'ORDER_NOT_PRICEABLE' } } });
    expect(records.size).toBe(0);
  });

  it('an unknown item is a plain 404', async () => {
    const { service } = buildHarness({ items: [], segments: [], orders: [] });
    await expect(service.confirmHatlyServicePrice('nope', 100, 'admin-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('locks the ORDER row before the ITEM row (the single lock order every pricing path uses, so concurrent pricing can neither lose an update nor deadlock)', async () => {
    const admin = buildHarness({ items: [hatlyItem()], segments: [hatlySegment()], orders: [pendingOrder()] });
    await admin.service.confirmHatlyServicePrice('item-1', 100, 'admin-1');
    expect(admin.locks.slice(0, 2)).toEqual(['Order', 'OrderItem']);
    const driver = buildHarness({ items: [hatlyItem()], segments: [hatlySegment()], orders: [pendingOrder()], deliveries: [{ id: 'd1', orderId: 'order-1', driverId: 'driver-of-u' }] });
    await driver.service.recordDriverPurchase('item-1', 100, 'u');
    expect(driver.locks.slice(0, 2)).toEqual(['Order', 'OrderItem']);
  });
});

describe('totals finalization for the existing Driver/Vendor pricing paths', () => {
  it('a Driver recording the last pending Hatly Service amount now also makes the total and amount due known (they stayed null forever before)', async () => {
    const { service, orders } = buildHarness({
      items: [customItem()], segments: [segment({ vendorBranchId: null, groupType: 'AD_HOC_SERVICE', subtotalMinor: 0 })],
      orders: [order({ subtotalMinor: 0, deliveryFeeMinor: 5000, discountMinor: 0, totalMinor: null, amountDueMinor: null, walletAmountMinor: 0, hasPendingAdHocPricing: true })],
      deliveries: [{ id: 'd1', orderId: 'order-1', driverId: 'driver-of-driver-user-1' }],
    });
    await service.recordDriverPurchase('item-1', 4500, 'driver-user-1');
    expect(orders.get('order-1')).toMatchObject({ subtotalMinor: 4500, totalMinor: 9500, amountDueMinor: 9500, hasPendingAdHocPricing: false });
  });

  it('a total that is already known is never rewritten by the finalization step', async () => {
    const { service, orders } = buildHarness({
      items: [customItem()], segments: [segment()],
      orders: [order({ subtotalMinor: 10000, deliveryFeeMinor: 3000, totalMinor: 13000, amountDueMinor: 13000 })],
      ownedBranchIds: ['branch-1'],
    });
    await service.recordVendorPrice('item-1', 5000, 'vendor-user-1');
    expect(orders.get('order-1')).toMatchObject({ totalMinor: 18000, amountDueMinor: 13000 }); // delta logic unchanged; amountDue is not this step's concern
  });
});
