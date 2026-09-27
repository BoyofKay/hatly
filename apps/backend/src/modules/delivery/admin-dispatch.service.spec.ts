import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminDispatchService } from './admin-dispatch.service';

function buildHarness(opts: {
  order?: any;
  delivery?: any;
  previousDriver?: any;
  rankedCandidateIds?: string[];
  eligibleDriverIds?: string[];
}) {
  const ordersRepository = { findOne: jest.fn(async () => opts.order ?? { id: 'order-1', segments: [] }) };
  const deliveriesRepository = {
    findOne: jest.fn(async () => opts.delivery ?? null),
    save: jest.fn(async (d: any) => d),
  };
  const driversRepository = {
    findOne: jest.fn(async () => opts.previousDriver ?? null),
    save: jest.fn(async (d: any) => d),
  };
  const driverRankingService = {
    rankCandidates: jest.fn(async () => opts.rankedCandidateIds ?? []),
    isDriverEligibleForOrder: jest.fn(async (_order: any, driverId: string) =>
      (opts.eligibleDriverIds ?? []).includes(driverId),
    ),
  };
  const deliveryAssignmentService = {
    assignDriver: jest.fn(async (params: any) => ({ id: 'delivery-1', ...params })),
  };
  const orderStateMachine = { transition: jest.fn(async () => ({ id: 'order-1' })) };

  const service = new AdminDispatchService(
    ordersRepository as any,
    deliveriesRepository as any,
    driversRepository as any,
    driverRankingService as any,
    deliveryAssignmentService as any,
    orderStateMachine as any,
  );
  return { service, driverRankingService, deliveryAssignmentService, orderStateMachine, driversRepository };
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

  it('reassign() releases the previous driver, moves the order back to READY_FOR_PICKUP, then assigns the new one', async () => {
    const { service, driversRepository, orderStateMachine, deliveryAssignmentService } = buildHarness({
      delivery: { id: 'delivery-1', orderId: 'order-1', driverId: 'old-driver', reassignmentCount: 0 },
      previousDriver: { id: 'old-driver', isAvailable: false },
      eligibleDriverIds: ['new-driver'],
    });

    await service.reassign('order-1', 'new-driver', false);

    expect(driversRepository.save).toHaveBeenCalledWith(expect.objectContaining({ isAvailable: true }));
    expect(orderStateMachine.transition).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', to: 'READY_FOR_PICKUP' }),
    );
    expect(deliveryAssignmentService.assignDriver).toHaveBeenCalledWith({
      orderId: 'order-1',
      candidateDriverIds: ['new-driver'],
    });
  });

  it('reassign() throws NotFoundException when no existing delivery exists for the order', async () => {
    const { service } = buildHarness({ delivery: null });
    await expect(service.reassign('order-1', 'new-driver')).rejects.toThrow(NotFoundException);
  });

  it('reassign() also enforces OVERRIDE_DISPATCH for the new driver, same as assign()', async () => {
    const { service, deliveryAssignmentService } = buildHarness({
      delivery: { id: 'delivery-1', orderId: 'order-1', driverId: 'old-driver', reassignmentCount: 0 },
      previousDriver: { id: 'old-driver', isAvailable: false },
      eligibleDriverIds: [],
    });

    await expect(service.reassign('order-1', 'ineligible-driver', false)).rejects.toThrow(BadRequestException);
    expect(deliveryAssignmentService.assignDriver).not.toHaveBeenCalled();
  });
});

describe('AdminDispatchService.listDispatchable (Phase I-A, Chunk 6)', () => {
  function buildListHarness(opts: { orders?: any[]; deliveries?: any[] }) {
    const orders = opts.orders ?? [];
    const deliveries = opts.deliveries ?? [];
    const ordersRepository = { find: jest.fn(async () => orders) };
    const deliveriesRepository = { find: jest.fn(async () => deliveries) };
    const driversRepository = {};
    const driverRankingService = {};
    const deliveryAssignmentService = {};
    const orderStateMachine = {};

    const service = new AdminDispatchService(
      ordersRepository as any,
      deliveriesRepository as any,
      driversRepository as any,
      driverRankingService as any,
      deliveryAssignmentService as any,
      orderStateMachine as any,
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
