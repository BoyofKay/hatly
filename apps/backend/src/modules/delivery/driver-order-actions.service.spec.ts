import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DriverOrderActionsService } from './driver-order-actions.service';
import { OrderStatus } from '../orders/order-status.enum';
import { DriverFailedDeliveryReason } from './driver-failed-delivery-reason.enum';

const noRedispatch = { redispatchAfterDriverRelease: jest.fn(async () => undefined) };

describe('DriverOrderActionsService', () => {
  it("resolves the order via the driver's owned delivery and delegates to the unmodified OrderStateMachineService", async () => {
    const driverAuthorizationService = {
      getDriverForUser: jest.fn(async () => ({ id: 'driver-1' })),
      assertOwnsDelivery: jest.fn(async () => ({ id: 'delivery-1', orderId: 'order-1' })),
    };
    const orderStateMachine = {
      transition: jest.fn(async () => ({ id: 'order-1', status: OrderStatus.PICKED_UP })),
    };
    const proofOfDeliveryService = { recordForDelivery: jest.fn() };
    const service = new DriverOrderActionsService(driverAuthorizationService as any, orderStateMachine as any, proofOfDeliveryService as any, noRedispatch as any);

    const result = await service.updateStatus({
      userId: 'user-1',
      deliveryId: 'delivery-1',
      to: OrderStatus.PICKED_UP,
    });

    expect(driverAuthorizationService.assertOwnsDelivery).toHaveBeenCalledWith('driver-1', 'delivery-1');
    expect(orderStateMachine.transition).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', to: OrderStatus.PICKED_UP }),
    );
    expect(result.status).toBe(OrderStatus.PICKED_UP);
  });

  it("propagates the ownership rejection — never reaches OrderStateMachineService for another driver's delivery", async () => {
    const driverAuthorizationService = {
      getDriverForUser: jest.fn(async () => ({ id: 'driver-1' })),
      assertOwnsDelivery: jest.fn(async () => {
        throw new NotFoundException('Delivery not found.');
      }),
    };
    const orderStateMachine = { transition: jest.fn() };
    const proofOfDeliveryService = { recordForDelivery: jest.fn() };
    const service = new DriverOrderActionsService(driverAuthorizationService as any, orderStateMachine as any, proofOfDeliveryService as any, noRedispatch as any);

    await expect(
      service.updateStatus({ userId: 'user-1', deliveryId: 'not-mine', to: OrderStatus.PICKED_UP }),
    ).rejects.toThrow(NotFoundException);
    expect(orderStateMachine.transition).not.toHaveBeenCalled();
  });

  it('CRITICAL: Driver FAILED_DELIVERY with a failure reason forwards that exact reason to OrderStateMachineService.transition()', async () => {
    const driverAuthorizationService = {
      getDriverForUser: jest.fn(async () => ({ id: 'driver-1' })),
      assertOwnsDelivery: jest.fn(async () => ({ id: 'delivery-1', orderId: 'order-1' })),
    };
    const orderStateMachine = {
      transition: jest.fn(async () => ({
        id: 'order-1',
        status: OrderStatus.FAILED_DELIVERY,
        failureReason: DriverFailedDeliveryReason.CUSTOMER_UNREACHABLE,
      })),
    };
    const proofOfDeliveryService = { recordForDelivery: jest.fn() };
    const service = new DriverOrderActionsService(driverAuthorizationService as any, orderStateMachine as any, proofOfDeliveryService as any, noRedispatch as any);

    const result = await service.updateStatus({
      userId: 'user-1',
      deliveryId: 'delivery-1',
      to: OrderStatus.FAILED_DELIVERY,
      failureReason: DriverFailedDeliveryReason.CUSTOMER_UNREACHABLE,
    });

    expect(orderStateMachine.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        to: OrderStatus.FAILED_DELIVERY,
        failureReason: DriverFailedDeliveryReason.CUSTOMER_UNREACHABLE,
      }),
    );
    expect(result.failureReason).toBe(DriverFailedDeliveryReason.CUSTOMER_UNREACHABLE);
  });

  it('Driver Core + Dispatch Foundation milestone: a driver-supplied reason must be one of the controlled values — an unrecognized one is rejected before ownership/state-machine work', async () => {
    const driverAuthorizationService = { getDriverForUser: jest.fn(), assertOwnsDelivery: jest.fn() };
    const orderStateMachine = { transition: jest.fn() };
    const proofOfDeliveryService = { recordForDelivery: jest.fn() };
    const service = new DriverOrderActionsService(driverAuthorizationService as any, orderStateMachine as any, proofOfDeliveryService as any, noRedispatch as any);

    await expect(
      service.updateStatus({
        userId: 'user-1',
        deliveryId: 'delivery-1',
        to: OrderStatus.FAILED_DELIVERY,
        failureReason: 'the dog ate the order',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(driverAuthorizationService.getDriverForUser).not.toHaveBeenCalled();
    expect(orderStateMachine.transition).not.toHaveBeenCalled();
  });

  it('every DriverFailedDeliveryReason value is accepted', async () => {
    const driverAuthorizationService = {
      getDriverForUser: jest.fn(async () => ({ id: 'driver-1' })),
      assertOwnsDelivery: jest.fn(async () => ({ id: 'delivery-1', orderId: 'order-1' })),
    };
    const orderStateMachine = { transition: jest.fn(async () => ({ id: 'order-1', status: OrderStatus.FAILED_DELIVERY })) };
    const proofOfDeliveryService = { recordForDelivery: jest.fn() };
    const service = new DriverOrderActionsService(driverAuthorizationService as any, orderStateMachine as any, proofOfDeliveryService as any, noRedispatch as any);

    for (const reason of Object.values(DriverFailedDeliveryReason)) {
      await expect(
        service.updateStatus({ userId: 'user-1', deliveryId: 'delivery-1', to: OrderStatus.FAILED_DELIVERY, failureReason: reason }),
      ).resolves.toBeDefined();
    }
  });

  it('the controlled-reason check only applies to FAILED_DELIVERY — an arbitrary cancellationReason on CANCELLED is untouched', async () => {
    const driverAuthorizationService = {
      getDriverForUser: jest.fn(async () => ({ id: 'driver-1' })),
      assertOwnsDelivery: jest.fn(async () => ({ id: 'delivery-1', orderId: 'order-1' })),
    };
    const orderStateMachine = { transition: jest.fn(async () => ({ id: 'order-1', status: OrderStatus.CANCELLED })) };
    const proofOfDeliveryService = { recordForDelivery: jest.fn() };
    const service = new DriverOrderActionsService(driverAuthorizationService as any, orderStateMachine as any, proofOfDeliveryService as any, noRedispatch as any);

    await expect(
      service.updateStatus({
        userId: 'user-1',
        deliveryId: 'delivery-1',
        to: OrderStatus.CANCELLED,
        cancellationReason: 'anything at all',
      }),
    ).resolves.toBeDefined();
  });

  it('Driver FAILED_DELIVERY without a failure reason preserves the existing optional behavior (forwarded as undefined, never fabricated)', async () => {
    const driverAuthorizationService = {
      getDriverForUser: jest.fn(async () => ({ id: 'driver-1' })),
      assertOwnsDelivery: jest.fn(async () => ({ id: 'delivery-1', orderId: 'order-1' })),
    };
    const orderStateMachine = {
      transition: jest.fn(async (_params: { failureReason?: string }) => ({ id: 'order-1', status: OrderStatus.FAILED_DELIVERY })),
    };
    const proofOfDeliveryService = { recordForDelivery: jest.fn() };
    const service = new DriverOrderActionsService(driverAuthorizationService as any, orderStateMachine as any, proofOfDeliveryService as any, noRedispatch as any);

    await service.updateStatus({ userId: 'user-1', deliveryId: 'delivery-1', to: OrderStatus.FAILED_DELIVERY });

    const callArgs = orderStateMachine.transition.mock.calls[0][0];
    expect(callArgs.failureReason).toBeUndefined();
  });

  it('existing userId/deliveryId/to/cancellationReason forwarding remains unchanged for CANCELLED', async () => {
    const driverAuthorizationService = {
      getDriverForUser: jest.fn(async () => ({ id: 'driver-1' })),
      assertOwnsDelivery: jest.fn(async () => ({ id: 'delivery-1', orderId: 'order-1' })),
    };
    const orderStateMachine = { transition: jest.fn(async () => ({ id: 'order-1', status: OrderStatus.CANCELLED })) };
    const proofOfDeliveryService = { recordForDelivery: jest.fn() };
    const service = new DriverOrderActionsService(driverAuthorizationService as any, orderStateMachine as any, proofOfDeliveryService as any, noRedispatch as any);

    await service.updateStatus({
      userId: 'user-1',
      deliveryId: 'delivery-1',
      to: OrderStatus.CANCELLED,
      cancellationReason: 'Customer requested cancellation',
    });

    expect(orderStateMachine.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        to: OrderStatus.CANCELLED,
        cancellationReason: 'Customer requested cancellation',
      }),
    );
  });

  it('other Driver transitions (e.g. PICKED_UP) are unaffected by the failureReason addition', async () => {
    const driverAuthorizationService = {
      getDriverForUser: jest.fn(async () => ({ id: 'driver-1' })),
      assertOwnsDelivery: jest.fn(async () => ({ id: 'delivery-1', orderId: 'order-1' })),
    };
    const orderStateMachine = {
      transition: jest.fn(async (_params: { failureReason?: string }) => ({ id: 'order-1', status: OrderStatus.PICKED_UP })),
    };
    const proofOfDeliveryService = { recordForDelivery: jest.fn() };
    const service = new DriverOrderActionsService(driverAuthorizationService as any, orderStateMachine as any, proofOfDeliveryService as any, noRedispatch as any);

    const result = await service.updateStatus({ userId: 'user-1', deliveryId: 'delivery-1', to: OrderStatus.PICKED_UP });

    expect(result.status).toBe(OrderStatus.PICKED_UP);
    const callArgs = orderStateMachine.transition.mock.calls[0][0];
    expect(callArgs.failureReason).toBeUndefined();
  });

  it('existing service errors propagate unchanged when failureReason is supplied', async () => {
    const driverAuthorizationService = {
      getDriverForUser: jest.fn(async () => ({ id: 'driver-1' })),
      assertOwnsDelivery: jest.fn(async () => ({ id: 'delivery-1', orderId: 'order-1' })),
    };
    const orderStateMachine = {
      transition: jest.fn(async () => {
        throw new Error('simulated state machine rejection');
      }),
    };
    const proofOfDeliveryService = { recordForDelivery: jest.fn() };
    const service = new DriverOrderActionsService(driverAuthorizationService as any, orderStateMachine as any, proofOfDeliveryService as any, noRedispatch as any);

    await expect(
      service.updateStatus({
        userId: 'user-1',
        deliveryId: 'delivery-1',
        to: OrderStatus.FAILED_DELIVERY,
        failureReason: DriverFailedDeliveryReason.OTHER,
      }),
    ).rejects.toThrow('simulated state machine rejection');
  });

  it('M4: a DELIVERED transition records Proof of Delivery (with the exact photo/recipient supplied) BEFORE calling OrderStateMachineService.transition()', async () => {
    const driverAuthorizationService = {
      getDriverForUser: jest.fn(async () => ({ id: 'driver-1' })),
      assertOwnsDelivery: jest.fn(async () => ({ id: 'delivery-1', orderId: 'order-1' })),
    };
    const callOrder: string[] = [];
    const proofOfDeliveryService = {
      recordForDelivery: jest.fn(async () => {
        callOrder.push('pod');
        return { id: 'pod-1' };
      }),
    };
    const orderStateMachine = {
      transition: jest.fn(async () => {
        callOrder.push('transition');
        return { id: 'order-1', status: OrderStatus.DELIVERED };
      }),
    };
    const service = new DriverOrderActionsService(driverAuthorizationService as any, orderStateMachine as any, proofOfDeliveryService as any, noRedispatch as any);

    await service.updateStatus({
      userId: 'user-1',
      deliveryId: 'delivery-1',
      to: OrderStatus.DELIVERED,
      proofPhotoUrl: 'https://hatly.example/uploads/photo.jpg',
      recipientName: 'Ahmed',
    });

    expect(proofOfDeliveryService.recordForDelivery).toHaveBeenCalledWith({
      driverUserId: 'user-1',
      driverId: 'driver-1',
      deliveryId: 'delivery-1',
      orderId: 'order-1',
      photoUrl: 'https://hatly.example/uploads/photo.jpg',
      recipientName: 'Ahmed',
    });
    expect(callOrder).toEqual(['pod', 'transition']);
  });

  it("M4: CRITICAL — a DELIVERED transition NEVER reaches OrderStateMachineService.transition() when Proof of Delivery validation rejects (e.g. missing/invalid photo) — a driver cannot bypass POD", async () => {
    const driverAuthorizationService = {
      getDriverForUser: jest.fn(async () => ({ id: 'driver-1' })),
      assertOwnsDelivery: jest.fn(async () => ({ id: 'delivery-1', orderId: 'order-1' })),
    };
    const proofOfDeliveryService = {
      recordForDelivery: jest.fn(async () => {
        throw new BadRequestException({ message: 'A delivery photo is required.', details: { code: 'PROOF_PHOTO_REQUIRED' } });
      }),
    };
    const orderStateMachine = { transition: jest.fn() };
    const service = new DriverOrderActionsService(driverAuthorizationService as any, orderStateMachine as any, proofOfDeliveryService as any, noRedispatch as any);

    await expect(
      service.updateStatus({ userId: 'user-1', deliveryId: 'delivery-1', to: OrderStatus.DELIVERED }),
    ).rejects.toThrow(BadRequestException);
    expect(orderStateMachine.transition).not.toHaveBeenCalled();
  });

  it('M4: non-DELIVERED transitions never touch ProofOfDeliveryService at all', async () => {
    const driverAuthorizationService = {
      getDriverForUser: jest.fn(async () => ({ id: 'driver-1' })),
      assertOwnsDelivery: jest.fn(async () => ({ id: 'delivery-1', orderId: 'order-1' })),
    };
    const proofOfDeliveryService = { recordForDelivery: jest.fn() };
    const orderStateMachine = { transition: jest.fn(async () => ({ id: 'order-1', status: OrderStatus.ON_THE_WAY })) };
    const service = new DriverOrderActionsService(driverAuthorizationService as any, orderStateMachine as any, proofOfDeliveryService as any, noRedispatch as any);

    await service.updateStatus({ userId: 'user-1', deliveryId: 'delivery-1', to: OrderStatus.ON_THE_WAY });

    expect(proofOfDeliveryService.recordForDelivery).not.toHaveBeenCalled();
  });
});

describe('DriverOrderActionsService — redispatch after a driver release (U3)', () => {
  function harness(to: OrderStatus) {
    const driverAuthorizationService = {
      getDriverForUser: jest.fn(async () => ({ id: 'driver-1' })),
      assertOwnsDelivery: jest.fn(async () => ({ id: 'delivery-1', orderId: 'order-1' })),
    };
    const calls: string[] = [];
    const orderStateMachine = {
      transition: jest.fn(async () => {
        calls.push('transition');
        return { id: 'order-1', status: to };
      }),
    };
    const automaticDispatch = {
      redispatchAfterDriverRelease: jest.fn(async () => {
        calls.push('redispatch');
      }),
    };
    const service = new DriverOrderActionsService(
      driverAuthorizationService as any,
      orderStateMachine as any,
      { recordForDelivery: jest.fn() } as any,
      automaticDispatch as any,
    );
    return { service, automaticDispatch, calls };
  }

  it('a release redispatches once, AFTER the release committed, excluding the releasing driver', async () => {
    const { service, automaticDispatch, calls } = harness(OrderStatus.READY_FOR_PICKUP);
    await service.updateStatus({ userId: 'user-1', deliveryId: 'delivery-1', to: OrderStatus.READY_FOR_PICKUP });
    expect(automaticDispatch.redispatchAfterDriverRelease).toHaveBeenCalledTimes(1);
    expect(automaticDispatch.redispatchAfterDriverRelease).toHaveBeenCalledWith('order-1', 'driver-1');
    expect(calls).toEqual(['transition', 'redispatch']);
  });

  it('no other driver transition redispatches', async () => {
    for (const to of [OrderStatus.PICKED_UP, OrderStatus.ON_THE_WAY]) {
      const { service, automaticDispatch } = harness(to);
      await service.updateStatus({ userId: 'user-1', deliveryId: 'delivery-1', to });
      expect(automaticDispatch.redispatchAfterDriverRelease).not.toHaveBeenCalled();
    }
  });

  it('a refused release (transition throws) never redispatches', async () => {
    const { service, automaticDispatch } = harness(OrderStatus.READY_FOR_PICKUP);
    (service as any).orderStateMachine.transition = jest.fn(async () => {
      throw new BadRequestException('Cannot transition order from READY_FOR_PICKUP to READY_FOR_PICKUP.');
    });
    await expect(service.updateStatus({ userId: 'user-1', deliveryId: 'delivery-1', to: OrderStatus.READY_FOR_PICKUP })).rejects.toThrow();
    expect(automaticDispatch.redispatchAfterDriverRelease).not.toHaveBeenCalled();
  });

  describe('retry safety (idempotency)', () => {
    const build = (currentStatus: OrderStatus) => {
      const driverAuthorizationService = {
        getDriverForUser: jest.fn(async () => ({ id: 'driver-1' })),
        assertOwnsDelivery: jest.fn(async () => ({ id: 'delivery-1', orderId: 'order-1' })),
      };
      const orderStateMachine = { transition: jest.fn(async () => ({ id: 'order-1', status: OrderStatus.DELIVERED })) };
      const proofOfDeliveryService = { recordForDelivery: jest.fn() };
      const dataSource = { getRepository: () => ({ findOne: jest.fn(async () => ({ id: 'order-1', status: currentStatus })) }) };
      const service = new DriverOrderActionsService(driverAuthorizationService as any, orderStateMachine as any, proofOfDeliveryService as any, noRedispatch as any, dataSource as any);
      return { service, orderStateMachine, proofOfDeliveryService };
    };

    it('repeating DELIVERED after it was applied returns the order and runs NOTHING again (no second proof, no second transition)', async () => {
      const { service, orderStateMachine, proofOfDeliveryService } = build(OrderStatus.DELIVERED);
      const result = await service.updateStatus({ userId: 'u', deliveryId: 'delivery-1', to: OrderStatus.DELIVERED, proofPhotoUrl: 'x', recipientName: 'y' });
      expect(result.status).toBe(OrderStatus.DELIVERED);
      expect(proofOfDeliveryService.recordForDelivery).not.toHaveBeenCalled();
      expect(orderStateMachine.transition).not.toHaveBeenCalled();
    });

    it('a real transition (the order is in another status) still goes through the state machine as before', async () => {
      const { service, orderStateMachine, proofOfDeliveryService } = build(OrderStatus.ON_THE_WAY);
      await service.updateStatus({ userId: 'u', deliveryId: 'delivery-1', to: OrderStatus.DELIVERED, proofPhotoUrl: 'x', recipientName: 'y' });
      expect(proofOfDeliveryService.recordForDelivery).toHaveBeenCalledTimes(1);
      expect(orderStateMachine.transition).toHaveBeenCalledTimes(1);
    });
  });
});
