import { NotFoundException } from '@nestjs/common';
import { AdminOrdersService } from './admin-orders.service';
import { Order } from './entities/order.entity';
import { OrderStatusEvent } from './entities/order-status-event.entity';
import { DispatchAlert } from '../delivery/entities/dispatch-alert.entity';
import { OrderVendorSegment } from './entities/order-vendor-segment.entity';
import { OrderItem } from './entities/order-item.entity';
import { Payment } from '../payments/entities/payment.entity';
import { Delivery } from '../delivery/entities/delivery.entity';
import { Driver } from '../delivery/entities/driver.entity';
import { User } from '../users/entities/user.entity';

function buildHarness(seed: {
  order?: any;
  segments?: any[];
  items?: any[];
  payment?: any;
  customer?: any;
  delivery?: any;
  driver?: any;
  driverUser?: any;
  financialEvents?: any[];
  driverCashRemainders?: any[];
  adHocPurchaseRecords?: any[];
  statusEvents?: any[];
  dispatchAlerts?: any[];
}) {
  const dataSource = {
    query: async (sql: string) => (/SUM\(amount_delta_minor\)/.test(sql) ? [{ n: 0 }] : []),
    getRepository: (EntityClass: any) => {
      if (EntityClass === Order) return { findOne: async () => seed.order ?? null };
      if (EntityClass === OrderVendorSegment) return { find: async () => seed.segments ?? [] };
      if (EntityClass === Payment) return { findOne: async () => seed.payment ?? null };
      if (EntityClass === Delivery) return { findOne: async () => seed.delivery ?? null };
      if (EntityClass === Driver) return { findOne: async () => seed.driver ?? null };
      if (EntityClass === User) {
        return {
          findOne: async (opts: any) => {
            if (seed.customer && opts.where.id === seed.customer.id) return seed.customer;
            if (seed.driverUser && opts.where.id === seed.driverUser.id) return seed.driverUser;
            return null;
          },
        };
      }
      if (EntityClass === OrderStatusEvent) return { find: async () => seed.statusEvents ?? [] };
      if (EntityClass === DispatchAlert) return { find: async () => seed.dispatchAlerts ?? [] };
      if (EntityClass === OrderItem) {
        return {
          createQueryBuilder: () => {
            const qb: any = { where: () => qb, getMany: async () => seed.items ?? [] };
            return qb;
          },
        };
      }
      throw new Error(`unhandled getRepository ${EntityClass.name}`);
    },
  };
  const financialEventService = { findByOrderId: jest.fn(async () => seed.financialEvents ?? []) };
  const driverCashRemainderService = { findByOrderId: jest.fn(async () => seed.driverCashRemainders ?? []) };
  const adHocPurchaseRecordService = { findByOrderId: jest.fn(async () => seed.adHocPurchaseRecords ?? []) };

  const service = new AdminOrdersService(
    dataSource as any,
    financialEventService as any,
    driverCashRemainderService as any,
    adHocPurchaseRecordService as any,
  );
  return { service };
}

function makeOrder(overrides: Partial<any> = {}) {
  return {
    id: 'order-1',
    status: 'DELIVERED',
    customerId: 'customer-1',
    fulfillmentType: 'DELIVERY',
    paymentMethod: 'COD',
    subtotalMinor: 10000,
    deliveryFeeMinor: 2000,
    discountMinor: 0,
    totalMinor: 12000,
    hasPendingAdHocPricing: false,
    cancellationReason: null,
    cancelledByRole: null,
    failureReason: null,
    failedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    ...overrides,
  };
}

describe('AdminOrdersService.getOne', () => {
  it('an authorized Admin can retrieve an existing Order', async () => {
    const { service } = buildHarness({ order: makeOrder() });
    const result = await service.getOne('order-1');
    expect(result.id).toBe('order-1');
    expect(result.status).toBe('DELIVERED');
  });

  it('an unknown Order id throws NotFoundException', async () => {
    const { service } = buildHarness({ order: null });
    await expect(service.getOne('missing-order')).rejects.toThrow(NotFoundException);
  });

  it('response contains failure metadata when present', async () => {
    const { service } = buildHarness({
      order: makeOrder({ status: 'FAILED_DELIVERY', failureReason: 'Customer not reachable', failedAt: new Date('2026-01-03') }),
    });
    const result = await service.getOne('order-1');
    expect(result.failureReason).toBe('Customer not reachable');
    expect(result.failedAt).toEqual(new Date('2026-01-03'));
  });

  it('response contains Payment when present', async () => {
    const { service } = buildHarness({
      order: makeOrder({ paymentMethod: 'MANUAL_TRANSFER' }),
      payment: { id: 'payment-1', method: 'MANUAL_TRANSFER', status: 'PAID', amountMinor: 12000, createdAt: new Date(), updatedAt: new Date() },
    });
    const result = await service.getOne('order-1');
    expect(result.payment).not.toBeNull();
    expect(result.payment!.status).toBe('PAID');
    expect(result.payment!.amountMinor).toBe(12000);
  });

  it('response contains Financial Events when present', async () => {
    const { service } = buildHarness({
      order: makeOrder(),
      financialEvents: [{ id: 'event-1', type: 'DRIVER_REIMBURSEMENT_OWED', amountMinor: 5000 }],
    });
    const result = await service.getOne('order-1');
    expect(result.financialEvents).toHaveLength(1);
    expect((result.financialEvents[0] as any).type).toBe('DRIVER_REIMBURSEMENT_OWED');
  });

  it('CRITICAL: a Custom Request item exposes text/images/pricing information', async () => {
    const { service } = buildHarness({
      order: makeOrder(),
      segments: [{ id: 'seg-1', orderId: 'order-1', groupType: 'CATALOG', vendorBranchId: 'branch-1', status: 'PICKED_UP', subtotalMinor: 5000 }],
      items: [
        {
          id: 'item-1',
          orderVendorSegmentId: 'seg-1',
          productId: null,
          productNameSnapshot: null,
          freeTextDescriptionSnapshot: 'Panadol Extra 500mg',
          imageUrlsSnapshot: ['https://cdn/rx.jpg'],
          quantity: 1,
          unitPriceMinor: null,
          actualAmountMinor: 4500,
          requestedWeightGrams: null,
          actualWeightGrams: null,
          offerDiscountAmountMinor: null,
        },
      ],
    });
    const result = await service.getOne('order-1');
    const item = result.segments[0].items[0];
    expect(item.freeTextDescription).toBe('Panadol Extra 500mg');
    expect(item.imageUrls).toEqual(['https://cdn/rx.jpg']);
    expect(item.unitPriceMinor).toBeNull();
    expect(item.actualAmountMinor).toBe(4500);
  });

  it('Driver Cash Remainder is visible when associated with the Order', async () => {
    const { service } = buildHarness({
      order: makeOrder(),
      driverCashRemainders: [{ id: 'remainder-1', orderId: 'order-1', remainderAmountMinor: 1500, status: 'PENDING_REVIEW' }],
    });
    const result = await service.getOne('order-1');
    expect(result.driverCashRemainders).toHaveLength(1);
  });

  it('AdHocPurchaseRecord information is visible when associated with Custom Request items', async () => {
    const { service } = buildHarness({
      order: makeOrder(),
      adHocPurchaseRecords: [{ id: 'record-1', orderItemId: 'item-1', amountMinor: 4500, recordedByRole: 'VENDOR' }],
    });
    const result = await service.getOne('order-1');
    expect(result.adHocPurchaseRecords).toHaveLength(1);
  });

  it('includes Driver information when a Delivery/Driver is assigned', async () => {
    const { service } = buildHarness({
      order: makeOrder(),
      delivery: { id: 'delivery-1', orderId: 'order-1', driverId: 'driver-1' },
      driver: { id: 'driver-1', userId: 'driver-user-1' },
      driverUser: { id: 'driver-user-1', fullName: 'Ahmed Driver', phone: '+201000000000' },
    });
    const result = await service.getOne('order-1');
    expect(result.driver).toEqual({ id: 'driver-1', fullName: 'Ahmed Driver', phone: '+201000000000' });
  });

  it('includes customer identification when the customer exists', async () => {
    const { service } = buildHarness({
      order: makeOrder(),
      customer: { id: 'customer-1', fullName: 'Sara Customer', phone: '+201111111111' },
    });
    const result = await service.getOne('order-1');
    expect(result.customer).toEqual({ id: 'customer-1', fullName: 'Sara Customer', phone: '+201111111111' });
  });

  it('does not leak password hashes or unrelated sensitive User fields', async () => {
    const { service } = buildHarness({
      order: makeOrder(),
      customer: { id: 'customer-1', fullName: 'Sara Customer', phone: '+201111111111', passwordHash: 'secret-hash' },
    });
    const result = await service.getOne('order-1');
    expect((result.customer as any).passwordHash).toBeUndefined();
  });
});


describe('AdminOrdersService.getOne — operational facts (Control Tower milestone)', () => {
  const driverRow = { id: 'driver-1', userId: 'driver-user-1' };
  const driverUser = { id: 'driver-user-1', fullName: 'Driver One', phone: '+201000000010' };
  const delivery = { id: 'delivery-1', orderId: 'order-1', driverId: 'driver-1', assignedAt: new Date('2026-10-03T10:00:00Z'), acceptDeadlineAt: new Date('2026-10-03T10:00:30Z'), reassignmentCount: 1 };
  const order = (status: string) => ({ id: 'order-1', orderNumber: 'HT-100001', status, customerId: 'customer-1', paymentMethod: 'COD', subtotalMinor: 1, discountMinor: 0 });

  it('exposes the status timeline, the delivery dispatch facts and the dispatch alerts', async () => {
    const { service } = buildHarness({
      order: order('ASSIGNED_TO_DRIVER'),
      delivery,
      driver: driverRow,
      driverUser,
      statusEvents: [
        { toStatus: 'PENDING', createdAt: new Date('2026-10-03T09:00:00Z'), actorRole: 'CUSTOMER' },
        { toStatus: 'READY_FOR_PICKUP', createdAt: new Date('2026-10-03T09:30:00Z'), actorRole: 'ADMIN' },
        { toStatus: 'ASSIGNED_TO_DRIVER', createdAt: new Date('2026-10-03T10:00:00Z'), actorRole: 'ADMIN' },
      ],
      dispatchAlerts: [{ id: 'alert-1', reason: 'NO_ELIGIBLE_DRIVER', createdAt: new Date('2026-10-03T09:31:00Z'), resolvedAt: new Date('2026-10-03T10:00:00Z') }],
    });
    const detail = await service.getOne('order-1');
    expect(detail.timeline.map((t) => t.status)).toEqual(['PENDING', 'READY_FOR_PICKUP', 'ASSIGNED_TO_DRIVER']);
    expect(detail.delivery).toMatchObject({ assignedAt: delivery.assignedAt, acceptDeadlineAt: delivery.acceptDeadlineAt, reassignmentCount: 1 });
    expect(detail.dispatchAlerts).toEqual([{ id: 'alert-1', reason: 'NO_ELIGIBLE_DRIVER', detail: null, createdAt: new Date('2026-10-03T09:31:00Z'), resolvedAt: new Date('2026-10-03T10:00:00Z') }]);
    expect(detail.driver).toMatchObject({ id: 'driver-1', fullName: 'Driver One' });
  });

  it('a RELEASED order (back to READY_FOR_PICKUP) does not report the driver it was taken from as its driver', async () => {
    const { service } = buildHarness({ order: order('READY_FOR_PICKUP'), delivery, driver: driverRow, driverUser });
    const detail = await service.getOne('order-1');
    expect(detail.driver).toBeNull();
    expect(detail.delivery).toMatchObject({ assignedAt: null, acceptDeadlineAt: null, reassignmentCount: 1 });
  });

  it.each(['PICKED_UP', 'ON_THE_WAY', 'DELIVERED', 'FAILED_DELIVERY'])('a %s order keeps its driver of record', async (status) => {
    const { service } = buildHarness({ order: order(status), delivery, driver: driverRow, driverUser });
    const detail = await service.getOne('order-1');
    expect(detail.driver).toMatchObject({ id: 'driver-1' });
    expect(detail.delivery?.acceptDeadlineAt).toBeNull(); // the accept window only matters while ASSIGNED_TO_DRIVER
  });
});
