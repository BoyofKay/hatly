import { OrderFinancialEventsService } from './order-financial-events.service';
import { OrderStatus } from '../orders/order-status.enum';
import { CartGroupType } from '../cart/cart-group-type.enum';
import { FinancialEventType } from './financial-event-type.enum';

function buildHarness(opts: {
  segments?: any[];
  branches?: any[];
  drivers?: any[];
  delivery?: any;
  existingEvents?: any[];
}) {
  const recordedEvents: any[] = [];
  const segmentsRepository = { find: jest.fn(async () => opts.segments ?? []) };
  const vendorBranchesRepository = {
    findOne: jest.fn(async ({ where }: any) => (opts.branches ?? []).find((b) => b.id === where.id) ?? null),
  };
  const driversRepository = {
    findOne: jest.fn(async ({ where }: any) => (opts.drivers ?? []).find((d) => d.id === where.id) ?? null),
  };
  const deliveriesRepository = { findOne: jest.fn(async () => opts.delivery ?? null) };
  const financialEventService = {
    record: jest.fn(async (params: any) => {
      const event = { id: `event-${recordedEvents.length + 1}`, ...params };
      recordedEvents.push(event);
      return event;
    }),
    findByOrderId: jest.fn(async () => opts.existingEvents ?? []),
  };

  const service = new OrderFinancialEventsService(
    segmentsRepository as any,
    vendorBranchesRepository as any,
    driversRepository as any,
    deliveriesRepository as any,
    financialEventService as any,
  );
  return { service, recordedEvents, financialEventService };
}

describe('OrderFinancialEventsService', () => {
  describe('PICKED_UP — vendor commission', () => {
    it("recognizes commission per CATALOG segment, using that segment's own vendor rate — never collapsed across a multi-vendor order", async () => {
      const segments = [
        { id: 'seg-a', groupType: CartGroupType.CATALOG, vendorBranchId: 'branch-a', subtotalMinor: 1000 },
        { id: 'seg-b', groupType: CartGroupType.CATALOG, vendorBranchId: 'branch-b', subtotalMinor: 2000 },
      ];
      const branches = [
        { id: 'branch-a', commissionRateBasisPoints: 1000 }, // 10%
        { id: 'branch-b', commissionRateBasisPoints: 500 }, // 5%
      ];
      const { service, recordedEvents } = buildHarness({ segments, branches });

      await service.handleTransition({ id: 'order-1', paymentMethod: 'COD' } as any, OrderStatus.PICKED_UP);

      const commissionEvents = recordedEvents.filter(
        (e) => e.type === FinancialEventType.VENDOR_COMMISSION_RECOGNIZED,
      );
      expect(commissionEvents).toHaveLength(2);
      expect(commissionEvents.find((e) => e.orderVendorSegmentId === 'seg-a')?.amountMinor).toBe(100); // 10% of 1000
      expect(commissionEvents.find((e) => e.orderVendorSegmentId === 'seg-b')?.amountMinor).toBe(100); // 5% of 2000
      expect(commissionEvents[0].idempotencyKey).not.toBe(commissionEvents[1].idempotencyKey);
    });

    it('fails closed — skips a segment whose vendor has no configured commission rate, without erroring', async () => {
      const segments = [
        { id: 'seg-a', groupType: CartGroupType.CATALOG, vendorBranchId: 'branch-a', subtotalMinor: 1000 },
      ];
      const branches = [{ id: 'branch-a', commissionRateBasisPoints: null }];
      const { service, recordedEvents } = buildHarness({ segments, branches });

      await service.handleTransition({ id: 'order-1', paymentMethod: 'COD' } as any, OrderStatus.PICKED_UP);

      expect(recordedEvents.filter((e) => e.type === FinancialEventType.VENDOR_COMMISSION_RECOGNIZED)).toHaveLength(
        0,
      );
    });

    it('never recognizes commission for an AD_HOC_SERVICE segment (no vendor to owe commission)', async () => {
      const segments = [
        { id: 'seg-a', groupType: CartGroupType.AD_HOC_SERVICE, vendorBranchId: null, subtotalMinor: null },
      ];
      const { service, recordedEvents } = buildHarness({ segments });

      await service.handleTransition({ id: 'order-1', paymentMethod: 'COD' } as any, OrderStatus.PICKED_UP);

      expect(recordedEvents).toHaveLength(0);
    });
  });

  describe('PICKED_UP — vendor-cancelled segments (Group 8 regression)', () => {
    const segments = [
      { id: 'seg-a', groupType: CartGroupType.CATALOG, vendorBranchId: 'branch-a', subtotalMinor: 1000, status: 'READY_FOR_PICKUP' },
      { id: 'seg-b', groupType: CartGroupType.CATALOG, vendorBranchId: 'branch-b', subtotalMinor: 2000, status: 'CANCELLED' },
    ];
    const branches = [
      { id: 'branch-a', commissionRateBasisPoints: 1000 },
      { id: 'branch-b', commissionRateBasisPoints: 1000 },
    ];

    it('recognizes NO commission for a segment the vendor cancelled', async () => {
      const { service, recordedEvents } = buildHarness({ segments, branches });
      await service.handleTransition({ id: 'order-1', paymentMethod: 'COD' } as any, OrderStatus.PICKED_UP);
      const commission = recordedEvents.filter((e) => e.type === FinancialEventType.VENDOR_COMMISSION_RECOGNIZED);
      expect(commission.map((e) => e.orderVendorSegmentId)).toEqual(['seg-a']);
    });

    it('the Manual Transfer driver reimbursement excludes the cancelled vendor (the driver never paid them)', async () => {
      const { service, recordedEvents } = buildHarness({ segments, branches, delivery: { id: 'd1', driverId: 'driver-1' } });
      await service.handleTransition({ id: 'order-1', paymentMethod: 'MANUAL_TRANSFER' } as any, OrderStatus.PICKED_UP);
      const reimbursement = recordedEvents.find((e) => e.type === FinancialEventType.DRIVER_REIMBURSEMENT_OWED);
      expect(reimbursement.amountMinor).toBe(1000);
    });
  });

  describe('PICKED_UP — MANUAL_TRANSFER driver reimbursement (decision 6)', () => {
    it('creates a reimbursement event equal to the sum of vendor amounts, separate from any commission event', async () => {
      const segments = [
        { id: 'seg-a', groupType: CartGroupType.CATALOG, vendorBranchId: 'branch-a', subtotalMinor: 1000 },
        { id: 'seg-b', groupType: CartGroupType.CATALOG, vendorBranchId: 'branch-b', subtotalMinor: 2000 },
      ];
      const branches = [{ id: 'branch-a' }, { id: 'branch-b' }]; // no commission rate needed for this test
      const delivery = { id: 'delivery-1', driverId: 'driver-1' };
      const { service, recordedEvents } = buildHarness({ segments, branches, delivery });

      await service.handleTransition(
        { id: 'order-1', paymentMethod: 'MANUAL_TRANSFER' } as any,
        OrderStatus.PICKED_UP,
      );

      const reimbursement = recordedEvents.find((e) => e.type === FinancialEventType.DRIVER_REIMBURSEMENT_OWED);
      expect(reimbursement).toBeDefined();
      expect(reimbursement.amountMinor).toBe(3000); // 1000 + 2000, NOT including any delivery fee
      expect(reimbursement.driverId).toBe('driver-1');
    });

    it('does NOT create a reimbursement for COD — only MANUAL_TRANSFER triggers it', async () => {
      const segments = [
        { id: 'seg-a', groupType: CartGroupType.CATALOG, vendorBranchId: 'branch-a', subtotalMinor: 1000 },
      ];
      const delivery = { id: 'delivery-1', driverId: 'driver-1' };
      const { service, recordedEvents } = buildHarness({ segments, branches: [{ id: 'branch-a' }], delivery });

      await service.handleTransition({ id: 'order-1', paymentMethod: 'COD' } as any, OrderStatus.PICKED_UP);

      expect(recordedEvents.find((e) => e.type === FinancialEventType.DRIVER_REIMBURSEMENT_OWED)).toBeUndefined();
    });
  });

  describe('DELIVERED — driver commission', () => {
    it('recognizes commission on the full delivery fee, storing baseAmountMinor in the rate snapshot for later settlement derivation', async () => {
      const delivery = { id: 'delivery-1', driverId: 'driver-1' };
      const drivers = [{ id: 'driver-1', commissionRateBasisPoints: 2000 }]; // 20%
      const { service, recordedEvents } = buildHarness({ delivery, drivers });

      await service.handleTransition({ id: 'order-1', deliveryFeeMinor: 500 } as any, OrderStatus.DELIVERED);

      const event = recordedEvents.find((e) => e.type === FinancialEventType.DRIVER_COMMISSION_RECOGNIZED);
      expect(event.amountMinor).toBe(100); // 20% of 500
      expect(event.rateSnapshot).toEqual({ commissionRateBasisPoints: 2000, baseAmountMinor: 500 });
    });

    it('fails closed — skips when the driver has no configured commission rate', async () => {
      const delivery = { id: 'delivery-1', driverId: 'driver-1' };
      const drivers = [{ id: 'driver-1', commissionRateBasisPoints: null }];
      const { service, recordedEvents } = buildHarness({ delivery, drivers });

      await service.handleTransition({ id: 'order-1', deliveryFeeMinor: 500 } as any, OrderStatus.DELIVERED);

      expect(recordedEvents).toHaveLength(0);
    });

    it('does nothing when deliveryFeeMinor is null (unknown/unpriced)', async () => {
      const { service, recordedEvents } = buildHarness({});
      await service.handleTransition({ id: 'order-1', deliveryFeeMinor: null } as any, OrderStatus.DELIVERED);
      expect(recordedEvents).toHaveLength(0);
    });
  });

  describe('CANCELLED — cancellation-with-prior-expense (decision 7)', () => {
    it('records an informational, linked event when a prior reimbursement already exists — does NOT create a new reimbursement', async () => {
      const existingEvents = [
        { id: 'event-1', type: FinancialEventType.DRIVER_REIMBURSEMENT_OWED, amountMinor: 3000 },
      ];
      const { service, recordedEvents } = buildHarness({ existingEvents });

      await service.handleTransition({ id: 'order-1' } as any, OrderStatus.CANCELLED);

      expect(recordedEvents).toHaveLength(1);
      expect(recordedEvents[0].type).toBe(FinancialEventType.CANCELLATION_WITH_PRIOR_EXPENSE_RECORDED);
      expect(recordedEvents[0].relatedEventId).toBe('event-1');
      expect(recordedEvents[0].amountMinor).toBeUndefined(); // informational only, no new money event
    });

    it('records nothing when no prior expense exists', async () => {
      const { service, recordedEvents } = buildHarness({ existingEvents: [] });
      await service.handleTransition({ id: 'order-1' } as any, OrderStatus.CANCELLED);
      expect(recordedEvents).toHaveLength(0);
    });
  });

  describe('FAILED_DELIVERY (decision 8)', () => {
    it('records a purely informational event — never an invented financial penalty', async () => {
      const { service, recordedEvents } = buildHarness({});
      await service.handleTransition({ id: 'order-1' } as any, OrderStatus.FAILED_DELIVERY);

      expect(recordedEvents).toHaveLength(1);
      expect(recordedEvents[0].type).toBe(FinancialEventType.FAILED_DELIVERY_RECORDED);
      expect(recordedEvents[0].amountMinor).toBeUndefined();
    });
  });

  it('does nothing for every other order status', async () => {
    const { service, recordedEvents } = buildHarness({});
    for (const status of [
      OrderStatus.PENDING,
      OrderStatus.CONFIRMED,
      OrderStatus.READY_FOR_PICKUP,
      OrderStatus.ON_THE_WAY,
    ]) {
      await service.handleTransition({ id: 'order-1' } as any, status);
    }
    expect(recordedEvents).toHaveLength(0);
  });
});
