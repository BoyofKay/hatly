import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminDispatchService } from './admin-dispatch.service';
import { OrderNotAssignableException } from './delivery-assignment.service';

function buildHarness(opts: {
  status?: string;
  fulfillmentType?: string;
  rankedCandidateIds?: string[];
  eligibleDriverIds?: string[];
}) {
  const ordersRepository = {
    findOne: jest.fn(async () => ({ id: 'order-1', status: opts.status ?? 'READY_FOR_PICKUP', fulfillmentType: opts.fulfillmentType ?? 'DELIVERY', segments: [] })),
  };
  const deliveriesRepository = { findOne: jest.fn(), save: jest.fn() };
  const driverRankingService = {
    rankCandidates: jest.fn(async () => opts.rankedCandidateIds ?? []),
    isDriverEligibleForOrder: jest.fn(async (_order: any, driverId: string) =>
      (opts.eligibleDriverIds ?? []).includes(driverId),
    ),
  };
  const deliveryAssignmentService = {
    assignDriver: jest.fn(async (params: any) => ({ id: 'delivery-1', ...params })),
    reassignDriver: jest.fn(async (params: any) => ({ id: 'delivery-1', ...params })),
  };

  const service = new AdminDispatchService(
    ordersRepository as any,
    deliveriesRepository as any,
    driverRankingService as any,
    deliveryAssignmentService as any,
  );
  return { service, driverRankingService, deliveryAssignmentService, deliveriesRepository };
}

describe('AdminDispatchService', () => {
  it('assign() with no driverId runs the same ranking automatic dispatch uses', async () => {
    const { service, deliveryAssignmentService } = buildHarness({ rankedCandidateIds: ['driver-1', 'driver-2'] });

    await service.assign('order-1');

    expect(deliveryAssignmentService.assignDriver).toHaveBeenCalledWith({
      orderId: 'order-1',
      candidateDriverIds: ['driver-1', 'driver-2'],
    });
  });

  it('CONFIRMED DECISION 9: a named driver WITHOUT OVERRIDE_DISPATCH must still pass ranking/eligibility', async () => {
    const { service, driverRankingService, deliveryAssignmentService } = buildHarness({
      eligibleDriverIds: ['driver-eligible'],
    });

    await service.assign('order-1', 'driver-eligible', false);

    expect(driverRankingService.isDriverEligibleForOrder).toHaveBeenCalled();
    expect(deliveryAssignmentService.assignDriver).toHaveBeenCalledWith({
      orderId: 'order-1',
      candidateDriverIds: ['driver-eligible'],
    });
  });

  it('CONFIRMED DECISION 9: rejects a named driver who fails ranking/eligibility when the caller lacks OVERRIDE_DISPATCH', async () => {
    const { service, deliveryAssignmentService } = buildHarness({ eligibleDriverIds: [] });

    await expect(service.assign('order-1', 'driver-not-eligible', false)).rejects.toThrow(BadRequestException);
    expect(deliveryAssignmentService.assignDriver).not.toHaveBeenCalled();
  });

  it('CONFIRMED DECISION 9: OVERRIDE_DISPATCH bypasses the ranking/eligibility filter entirely for a named driver', async () => {
    const { service, driverRankingService, deliveryAssignmentService } = buildHarness({ eligibleDriverIds: [] });

    await service.assign('order-1', 'driver-not-eligible', true);

    expect(driverRankingService.isDriverEligibleForOrder).not.toHaveBeenCalled();
    expect(deliveryAssignmentService.assignDriver).toHaveBeenCalledWith({
      orderId: 'order-1',
      candidateDriverIds: ['driver-not-eligible'],
    });
  });

  it('reassign() validates everything first, then hands the release + new assignment to the ONE atomic primitive', async () => {
    const { service, deliveryAssignmentService, deliveriesRepository } = buildHarness({ status: 'ASSIGNED_TO_DRIVER', eligibleDriverIds: ['new-driver'] });

    await service.reassign('order-1', 'new-driver', false, 'old-driver');

    expect(deliveryAssignmentService.reassignDriver).toHaveBeenCalledWith({ orderId: 'order-1', newDriverId: 'new-driver', expectedCurrentDriverId: 'old-driver' });
    expect(deliveryAssignmentService.assignDriver).not.toHaveBeenCalled();
    // nothing is mutated here any more (the old non-atomic free → bump → release sequence is gone)
    expect(deliveriesRepository.save).not.toHaveBeenCalled();
  });

  it('reassign() also enforces OVERRIDE_DISPATCH for the new driver — and refuses BEFORE anything changes', async () => {
    const { service, deliveryAssignmentService } = buildHarness({ status: 'ASSIGNED_TO_DRIVER', eligibleDriverIds: [] });
    await expect(service.reassign('order-1', 'ineligible-driver', false)).rejects.toThrow(BadRequestException);
    expect(deliveryAssignmentService.reassignDriver).not.toHaveBeenCalled();
  });

  it.each(['READY_FOR_PICKUP', 'PICKED_UP', 'ON_THE_WAY', 'DELIVERED', 'CANCELLED'])(
    'reassign() of an order that is %s is refused (ORDER_NOT_REASSIGNABLE) without touching any driver',
    async (status) => {
      const { service, deliveryAssignmentService } = buildHarness({ status, eligibleDriverIds: ['new-driver'] });
      const error = await service.reassign('order-1', 'new-driver', true).catch((e) => e);
      expect(error).toBeInstanceOf(OrderNotAssignableException);
      expect(error.getResponse().details).toMatchObject({ code: 'ORDER_NOT_REASSIGNABLE', currentStatus: status });
      expect(deliveryAssignmentService.reassignDriver).not.toHaveBeenCalled();
    },
  );

  it.each(['PENDING', 'PREPARING', 'ASSIGNED_TO_DRIVER', 'PICKED_UP', 'CANCELLED'])(
    'assign() of an order that is %s is refused (ORDER_NOT_ASSIGNABLE) — never overwrites an existing assignment',
    async (status) => {
      const { service, deliveryAssignmentService } = buildHarness({ status, eligibleDriverIds: ['d'] });
      const error = await service.assign('order-1', 'd', true).catch((e) => e);
      expect(error).toBeInstanceOf(OrderNotAssignableException);
      expect(error.getResponse().details.code).toBe('ORDER_NOT_ASSIGNABLE');
      expect(deliveryAssignmentService.assignDriver).not.toHaveBeenCalled();
    },
  );

  it('a PICKUP order cannot be assigned to a driver (the customer collects it)', async () => {
    const { service, deliveryAssignmentService } = buildHarness({ fulfillmentType: 'PICKUP', eligibleDriverIds: ['d'] });
    await expect(service.assign('order-1', 'd', true)).rejects.toBeInstanceOf(OrderNotAssignableException);
    expect(deliveryAssignmentService.assignDriver).not.toHaveBeenCalled();
  });

  it('an unknown order is a 404, not a crash', async () => {
    const { service } = buildHarness({});
    (service as any).ordersRepository.findOne.mockResolvedValueOnce(null);
    await expect(service.assign('missing', 'd', true)).rejects.toThrow(NotFoundException);
  });
});

describe('AdminDispatchService.listDispatchable (Phase I-A, Chunk 6)', () => {
  function buildListHarness(opts: { orders?: any[]; deliveries?: any[] }) {
    const orders = opts.orders ?? [];
    const deliveries = opts.deliveries ?? [];
    const ordersRepository = { find: jest.fn(async () => orders) };
    const deliveriesRepository = { find: jest.fn(async () => deliveries) };
    const driverRankingService = {};
    const deliveryAssignmentService = {};

    const service = new AdminDispatchService(
      ordersRepository as any,
      deliveriesRepository as any,
      driverRankingService as any,
      deliveryAssignmentService as any,
    );
    return { service };
  }

  it('returns READY_FOR_PICKUP and ASSIGNED_TO_DRIVER orders with their current delivery/driver, read-only', async () => {
    const { service } = buildListHarness({
      orders: [
        { id: 'order-1', status: 'READY_FOR_PICKUP', createdAt: new Date(), deliveryAddressSnapshot: { line1: 'X' } },
        { id: 'order-2', status: 'ASSIGNED_TO_DRIVER', createdAt: new Date(), deliveryAddressSnapshot: { line1: 'Y' } },
      ],
      deliveries: [{ id: 'delivery-1', orderId: 'order-2', driverId: 'driver-1', reassignmentCount: 0 }],
    });

    const result = await service.listDispatchable();

    expect(result).toHaveLength(2);
    const unassigned = result.find((o) => o.orderId === 'order-1')!;
    expect(unassigned.currentDeliveryId).toBeNull();
    expect(unassigned.currentDriverId).toBeNull();
    const assigned = result.find((o) => o.orderId === 'order-2')!;
    expect(assigned.currentDriverId).toBe('driver-1');
  });

  it('returns an empty list when nothing is dispatch-relevant', async () => {
    const { service } = buildListHarness({ orders: [] });
    expect(await service.listDispatchable()).toEqual([]);
  });
});
