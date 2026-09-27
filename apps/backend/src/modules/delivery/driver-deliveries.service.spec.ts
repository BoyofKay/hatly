import { NotFoundException } from '@nestjs/common';
import { DriverDeliveriesService } from './driver-deliveries.service';
import { CartGroupType } from '../cart/cart-group-type.enum';

function makeOrder(overrides: Partial<any> = {}) {
  return {
    id: 'order-1',
    status: 'ASSIGNED_TO_DRIVER',
    fulfillmentType: 'DELIVERY',
    orderNote: null,
    customer: { fullName: 'Jane Customer', phone: '+201000000099' },
    deliveryAddressSnapshot: { line1: '12 Market St', latitude: 30.1, longitude: 31.2 },
    segments: [],
    ...overrides,
  };
}

function makeDelivery(overrides: Partial<any> = {}) {
  return {
    id: 'delivery-1',
    driverId: 'driver-1',
    orderId: 'order-1',
    assignedAt: null,
    acceptDeadlineAt: null,
    pickedUpAt: null,
    deliveredAt: null,
    order: makeOrder(),
    ...overrides,
  };
}

function buildHarness(deliveries: any[], branches: any[] = [], driverId = 'driver-1') {
  const deliveriesRepository = {
    find: jest.fn(async ({ where }: any) => deliveries.filter((d) => d.driverId === where.driverId)),
    findOne: jest.fn(async ({ where }: any) => deliveries.find((d) => d.id === where.id) ?? null),
  };
  const vendorBranchesRepository = {
    find: jest.fn(async ({ where }: any) => {
      const ids = where.map((w: any) => w.id);
      return branches.filter((b) => ids.includes(b.id));
    }),
  };
  const driverAuthorizationService = {
    getDriverForUser: jest.fn(async () => ({ id: driverId })),
    assertOwnsDelivery: jest.fn(async (dId: string, deliveryId: string) => {
      const delivery = deliveries.find((d) => d.id === deliveryId);
      if (!delivery || delivery.driverId !== dId) {
        throw new NotFoundException('Delivery not found.');
      }
      return delivery;
    }),
  };
  const service = new DriverDeliveriesService(
    deliveriesRepository as any,
    vendorBranchesRepository as any,
    driverAuthorizationService as any,
  );
  return { service };
}

describe('DriverDeliveriesService', () => {
  it("list only returns deliveries assigned to the caller's own Driver id", async () => {
    const mine = makeDelivery({ id: 'delivery-mine', driverId: 'driver-1' });
    const other = makeDelivery({ id: 'delivery-other', driverId: 'driver-2' });
    const { service } = buildHarness([mine, other], [], 'driver-1');

    const results = await service.listForUser('user-1');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('delivery-mine');
  });

  it('includes customer name, phone, and delivery address — confirmed allowed for drivers, unlike vendors', async () => {
    const { service } = buildHarness([makeDelivery()]);
    const results = await service.listForUser('user-1');

    expect(results[0].customerName).toBe('Jane Customer');
    expect(results[0].customerPhone).toBe('+201000000099');
    expect(results[0].deliveryAddress!.line1).toBe('12 Market St');
  });

  it("includes ALL of the order's segments (every vendor), not just one — required for multi-vendor pickup execution", async () => {
    const segmentA = {
      id: 'seg-a',
      groupType: CartGroupType.CATALOG,
      vendorBranchId: 'branch-a',
      status: 'READY_FOR_PICKUP',
      items: [],
    };
    const segmentB = {
      id: 'seg-b',
      groupType: CartGroupType.CATALOG,
      vendorBranchId: 'branch-b',
      status: 'PREPARING',
      items: [],
    };
    const delivery = makeDelivery({ order: makeOrder({ segments: [segmentA, segmentB] }) });
    const branches = [
      { id: 'branch-a', name: 'Vendor A', address: 'Addr A', latitude: 1, longitude: 1 },
      { id: 'branch-b', name: 'Vendor B', address: 'Addr B', latitude: 2, longitude: 2 },
    ];
    const { service } = buildHarness([delivery], branches);

    const results = await service.listForUser('user-1');
    expect(results[0].segments).toHaveLength(2);
    expect(results[0].segments.map((s) => s.vendorBranchName)).toEqual(['Vendor A', 'Vendor B']);
  });

  it('getForUser throws NotFoundException for a delivery not assigned to this driver', async () => {
    const other = makeDelivery({ id: 'delivery-other', driverId: 'driver-2' });
    const { service } = buildHarness([other], [], 'driver-1');

    await expect(service.getForUser('user-1', 'delivery-other')).rejects.toThrow(NotFoundException);
  });

  it('Driver Core + Dispatch Foundation milestone: exposes amountDueMinor (what to actually collect) separately from totalMinor, plus electronicPaymentMethod', async () => {
    // A wallet-partial order: total is 100.00 but only 40.00 is actually due in cash on delivery.
    const delivery = makeDelivery({
      order: makeOrder({ paymentMethod: 'COD', totalMinor: 10000, amountDueMinor: 4000, electronicPaymentMethod: null }),
    });
    const { service } = buildHarness([delivery]);

    const results = await service.listForUser('user-1');

    expect(results[0].totalMinor).toBe(10000);
    expect(results[0].amountDueMinor).toBe(4000);
    expect(results[0].amountDueMinor).not.toBe(results[0].totalMinor);
  });

  it('electronicPaymentMethod is exposed for PAY_AT_DELIVERY so the driver knows which method to expect', async () => {
    const delivery = makeDelivery({
      order: makeOrder({
        paymentMethod: 'PAY_AT_DELIVERY',
        electronicPaymentMethod: 'INSTAPAY',
        totalMinor: 5000,
        amountDueMinor: 5000,
      }),
    });
    const { service } = buildHarness([delivery]);

    const results = await service.listForUser('user-1');
    expect(results[0].electronicPaymentMethod).toBe('INSTAPAY');
  });

  it('amountDueMinor/electronicPaymentMethod default to null rather than throwing when absent (legacy/pickup orders)', async () => {
    const { service } = buildHarness([makeDelivery()]);
    const results = await service.listForUser('user-1');
    expect(results[0].amountDueMinor).toBeNull();
    expect(results[0].electronicPaymentMethod).toBeNull();
  });
});
