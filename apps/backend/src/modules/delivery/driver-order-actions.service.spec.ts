import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DriverOrderActionsService } from './driver-order-actions.service';
import { OrderStatus } from '../orders/order-status.enum';
import { DriverFailedDeliveryReason } from './driver-failed-delivery-reason.enum';

describe('DriverOrderActionsService', () => {
  it("resolves the order via the driver's owned delivery and delegates to the unmodified OrderStateMachineService", async () => {
    const driverAuthorizationService = {
      getDriverForUser: jest.fn(async () => ({ id: 'driver-1' })),
      assertOwnsDelivery: jest.fn(async () => ({ id: 'delivery-1', orderId: 'order-1' })),
    };
    const orderStateMachine = {
      transition: jest.fn(async () => ({ id: 'order-1', status: OrderStatus.PICKED_UP })),
    };
    const service = new DriverOrderActionsService(driverAuthorizationService as any, orderStateMachine as any);

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
    const service = new DriverOrderActionsService(driverAuthorizationService as any, orderStateMachine as any);

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
    const service = new DriverOrderActionsService(driverAuthorizationService as any, orderStateMachine as any);

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
    const service = new DriverOrderActionsService(driverAuthorizationService as any, orderStateMachine as any);

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
    const service = new DriverOrderActionsService(driverAuthorizationService as any, orderStateMachine as any);

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
    const service = new DriverOrderActionsService(driverAuthorizationService as any, orderStateMachine as any);

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
    const service = new DriverOrderActionsService(driverAuthorizationService as any, orderStateMachine as any);

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
    const service = new DriverOrderActionsService(driverAuthorizationService as any, orderStateMachine as any);

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
    const service = new DriverOrderActionsService(driverAuthorizationService as any, orderStateMachine as any);

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
    const service = new DriverOrderActionsService(driverAuthorizationService as any, orderStateMachine as any);

    await expect(
      service.updateStatus({
        userId: 'user-1',
        deliveryId: 'delivery-1',
        to: OrderStatus.FAILED_DELIVERY,
        failureReason: DriverFailedDeliveryReason.OTHER,
      }),
    ).rejects.toThrow('simulated state machine rejection');
  });
});
