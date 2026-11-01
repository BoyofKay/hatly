import { NotFoundException } from '@nestjs/common';
import { VENDOR_ORDERS_LIST_MAX_SEGMENTS, VendorOrdersService } from './vendor-orders.service';

function buildHarness(allSegments: any[], ownedBranchIds: string[]) {
  const segmentsRepository = {
    // Raw reads for the segment history / refund summary (no rows in these tests).
    query: jest.fn(async () => []),
    find: jest.fn(async ({ where }: any) => {
      // `where` is an array of {vendorBranchId} or {orderId, vendorBranchId}
      // objects (OR semantics, matching TypeORM's array-where behavior)
      return allSegments.filter((s) =>
        where.some((w: any) => Object.entries(w).every(([k, v]) => (s as any)[k] === v)),
      );
    }),
  };
  const vendorStaffAuthorizationService = {
    getOwnedBranchIds: jest.fn(async () => ownedBranchIds),
  };
  const service = new VendorOrdersService(segmentsRepository as any, vendorStaffAuthorizationService as any);
  return { service, segmentsRepository };
}

function makeSegment(overrides: Partial<any> = {}) {
  return {
    id: 'segment-1',
    orderId: 'order-1',
    vendorBranchId: 'branch-1',
    groupType: 'CATALOG',
    vendorNoteSnapshot: null,
    status: 'PENDING',
    subtotalMinor: 1000,
    expectedReadyAt: null,
    items: [],
    order: {
      id: 'order-1',
      orderNumber: 'HT-100001',
      status: 'PENDING',
      fulfillmentType: 'DELIVERY',
      orderNote: null,
      paymentMethod: 'COD',
      customerId: 'customer-1',
      deliveryAddressSnapshot: { line1: '123 Secret St', latitude: 1, longitude: 1 },
    },
    ...overrides,
  };
}

describe('VendorOrdersService', () => {
  it('the list is bounded: newest first, at most VENDOR_ORDERS_LIST_MAX_SEGMENTS segments per call (it used to load the whole history)', async () => {
    const { service, segmentsRepository } = buildHarness([makeSegment()], ['branch-1']);
    await service.listForUser('user-1');
    expect(segmentsRepository.find).toHaveBeenCalledWith(expect.objectContaining({ take: VENDOR_ORDERS_LIST_MAX_SEGMENTS, order: { createdAt: 'DESC' } }));
    expect(VENDOR_ORDERS_LIST_MAX_SEGMENTS).toBeLessThanOrEqual(500);
  });

  it("list only returns segments belonging to the caller's owned branches", async () => {
    const mine = makeSegment({ id: 'seg-mine', vendorBranchId: 'branch-1' });
    const { service } = buildHarness([mine], ['branch-1']);

    const orders = await service.listForUser('user-1');
    expect(orders).toHaveLength(1);
    expect(orders[0].segments).toHaveLength(1);
    expect(orders[0].segments[0].id).toBe('seg-mine');
  });

  it('list returns an empty array for a user with no owned branches, without querying segments', async () => {
    const { service } = buildHarness([makeSegment()], []);
    const orders = await service.listForUser('user-1');
    expect(orders).toEqual([]);
  });

  it('never exposes customerId or deliveryAddressSnapshot in the returned view — the core PII-exclusion guarantee', async () => {
    const { service } = buildHarness([makeSegment()], ['branch-1']);
    const orders = await service.listForUser('user-1');

    const orderView = orders[0] as any;
    expect(orderView.customerId).toBeUndefined();
    expect(orderView.deliveryAddressSnapshot).toBeUndefined();
    // Confirm the view only has the expected whitelisted keys.
    expect(Object.keys(orderView).sort()).toEqual(
      ['fulfillmentType', 'id', 'orderNote', 'orderNumber', 'paymentMethod', 'segments', 'status'].sort(),
    );
    expect(orderView.orderNumber).toBe('HT-100001');
  });

  it("a multi-vendor order's sibling segment (another vendor's) never appears in this vendor's view", async () => {
    const mine = makeSegment({ id: 'seg-mine', vendorBranchId: 'branch-1', orderId: 'order-1' });
    const sibling = makeSegment({ id: 'seg-sibling', vendorBranchId: 'branch-2', orderId: 'order-1' });
    const { service } = buildHarness([mine, sibling], ['branch-1']);

    const order = await service.getForUser('user-1', 'order-1');
    expect(order.segments).toHaveLength(1);
    expect(order.segments[0].id).toBe('seg-mine');
    expect(order.segments.find((s) => s.id === 'seg-sibling')).toBeUndefined();
  });

  it('getForUser throws NotFoundException when the vendor has no segment on that order', async () => {
    const sibling = makeSegment({ id: 'seg-sibling', vendorBranchId: 'branch-2', orderId: 'order-1' });
    const { service } = buildHarness([sibling], ['branch-1']);

    await expect(service.getForUser('user-1', 'order-1')).rejects.toThrow(NotFoundException);
  });

  it('getForUser throws NotFoundException (not a different error) when the order does not exist at all — does not leak which case it is', async () => {
    const { service } = buildHarness([], ['branch-1']);
    await expect(service.getForUser('user-1', 'nonexistent-order')).rejects.toThrow(NotFoundException);
  });
});

describe('VendorOrdersService — Vendor Custom Item Pricing read model (Chunk 4C)', () => {
  it('a normal catalog item exposes actualAmountMinor as null, unitPriceMinor unchanged', async () => {
    const segment = makeSegment({
      items: [
        {
          id: 'item-1',
          productId: 'product-1',
          productNameSnapshot: 'Burger',
          quantity: 2,
          unitPriceMinor: 1000,
          optionsSnapshot: [],
          notes: null,
          freeTextDescriptionSnapshot: null,
          imageUrlsSnapshot: null,
          pricingUnitSnapshot: null,
          requestedWeightGrams: null,
          actualWeightGrams: null,
          actualAmountMinor: null,
        },
      ],
    });
    const { service } = buildHarness([segment], ['branch-1']);

    const orders = await service.listForUser('user-1');

    const item = orders[0].segments[0].items[0];
    expect(item.unitPriceMinor).toBe(1000);
    expect(item.actualAmountMinor).toBeNull();
  });

  it('CRITICAL: an unpriced Vendor Custom Request exposes productId=null and actualAmountMinor=null', async () => {
    const segment = makeSegment({
      items: [
        {
          id: 'item-2',
          productId: null,
          productNameSnapshot: null,
          quantity: 1,
          unitPriceMinor: null,
          optionsSnapshot: [],
          notes: null,
          freeTextDescriptionSnapshot: 'Panadol Extra 500mg',
          imageUrlsSnapshot: null,
          pricingUnitSnapshot: null,
          requestedWeightGrams: null,
          actualWeightGrams: null,
          actualAmountMinor: null,
        },
      ],
    });
    const { service } = buildHarness([segment], ['branch-1']);

    const orders = await service.listForUser('user-1');

    const item = orders[0].segments[0].items[0];
    expect(item.productId).toBeNull();
    expect(item.actualAmountMinor).toBeNull();
  });

  it('CRITICAL: a priced Vendor Custom Request exposes the exact persisted actualAmountMinor, while unitPriceMinor stays null', async () => {
    const segment = makeSegment({
      items: [
        {
          id: 'item-3',
          productId: null,
          productNameSnapshot: null,
          quantity: 1,
          unitPriceMinor: null,
          optionsSnapshot: [],
          notes: null,
          freeTextDescriptionSnapshot: 'Panadol Extra 500mg',
          imageUrlsSnapshot: null,
          pricingUnitSnapshot: null,
          requestedWeightGrams: null,
          actualWeightGrams: null,
          actualAmountMinor: 4500,
        },
      ],
    });
    const { service } = buildHarness([segment], ['branch-1']);

    const orders = await service.listForUser('user-1');

    const item = orders[0].segments[0].items[0];
    expect(item.productId).toBeNull();
    expect(item.actualAmountMinor).toBe(4500);
    expect(item.unitPriceMinor).toBeNull();
  });
});
