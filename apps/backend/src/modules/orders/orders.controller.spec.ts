import { OrdersController } from './orders.controller';
import { OrderStatus } from './order-status.enum';
import { Role } from '../../common/enums/role.enum';

/**
 * M4 — Proof of Delivery. Focused coverage for the ONE new piece of
 * business logic this controller gained: the generic
 * `PATCH /orders/:id/status` endpoint also accepts Role.DRIVER (see
 * OrderActorAuthorizationService's own DRIVER branch), so it is a
 * SECOND real path to DELIVERED alongside DriverController's own
 * `/driver/deliveries/:id/status` — CONFIRMED this endpoint must
 * apply the exact same Proof-of-Delivery gate, or a driver could
 * bypass POD entirely just by calling this route instead.
 */
function buildHarness() {
  const orderStateMachine = { transition: jest.fn(async () => ({ id: 'order-1', status: OrderStatus.DELIVERED })) };
  const orderCreationService = {};
  const customerOrdersService = {};
  const orderActorAuthorizationService = {
    assertMayActOnOrder: jest.fn(async () => {}),
    assertVendorMayCancelWholeOrder: jest.fn(async () => {}),
  };
  const customerOrderCancellationService = {};
  const driverAuthorizationService = {
    getDriverForUser: jest.fn(async () => ({ id: 'driver-1' })),
    getOwnedDeliveryForOrder: jest.fn(async () => ({ id: 'delivery-1', orderId: 'order-1' })),
  };
  const proofOfDeliveryService = { recordForDelivery: jest.fn(async () => ({ id: 'pod-1' })) };
  const automaticDispatchService = { redispatchAfterDriverRelease: jest.fn(async () => undefined) };

  const controller = new OrdersController(
    orderStateMachine as any,
    orderCreationService as any,
    customerOrdersService as any,
    orderActorAuthorizationService as any,
    customerOrderCancellationService as any,
    driverAuthorizationService as any,
    proofOfDeliveryService as any,
    automaticDispatchService as any,
  );

  return { controller, orderStateMachine, driverAuthorizationService, proofOfDeliveryService, automaticDispatchService };
}

describe('OrdersController — PATCH :id/status', () => {
  it('CRITICAL: a DRIVER marking DELIVERED via the generic endpoint records Proof of Delivery BEFORE the transition — cannot bypass via this route', async () => {
    const { controller, orderStateMachine, driverAuthorizationService, proofOfDeliveryService } = buildHarness();
    const callOrder: string[] = [];
    proofOfDeliveryService.recordForDelivery.mockImplementation(async () => {
      callOrder.push('pod');
      return { id: 'pod-1' };
    });
    orderStateMachine.transition.mockImplementation(async () => {
      callOrder.push('transition');
      return { id: 'order-1', status: OrderStatus.DELIVERED };
    });

    await controller.updateStatus(
      'order-1',
      { status: OrderStatus.DELIVERED, proofPhotoUrl: 'https://hatly.example/uploads/p.jpg', recipientName: 'Ahmed' } as any,
      { id: 'user-1', role: Role.DRIVER } as any,
    );

    expect(driverAuthorizationService.getDriverForUser).toHaveBeenCalledWith('user-1');
    expect(driverAuthorizationService.getOwnedDeliveryForOrder).toHaveBeenCalledWith('driver-1', 'order-1');
    expect(proofOfDeliveryService.recordForDelivery).toHaveBeenCalledWith({
      driverUserId: 'user-1',
      driverId: 'driver-1',
      deliveryId: 'delivery-1',
      orderId: 'order-1',
      photoUrl: 'https://hatly.example/uploads/p.jpg',
      recipientName: 'Ahmed',
    });
    expect(callOrder).toEqual(['pod', 'transition']);
  });

  it('CRITICAL: when Proof of Delivery validation rejects, OrderStateMachineService.transition() is NEVER called', async () => {
    const { controller, orderStateMachine, proofOfDeliveryService } = buildHarness();
    proofOfDeliveryService.recordForDelivery.mockRejectedValue(new Error('PROOF_PHOTO_REQUIRED'));

    await expect(
      controller.updateStatus('order-1', { status: OrderStatus.DELIVERED } as any, { id: 'user-1', role: Role.DRIVER } as any),
    ).rejects.toThrow('PROOF_PHOTO_REQUIRED');
    expect(orderStateMachine.transition).not.toHaveBeenCalled();
  });

  it('a DRIVER transition to a non-DELIVERED status never touches ProofOfDeliveryService', async () => {
    const { controller, proofOfDeliveryService, orderStateMachine } = buildHarness();
    orderStateMachine.transition.mockResolvedValue({ id: 'order-1', status: OrderStatus.PICKED_UP });

    await controller.updateStatus('order-1', { status: OrderStatus.PICKED_UP } as any, { id: 'user-1', role: Role.DRIVER } as any);

    expect(proofOfDeliveryService.recordForDelivery).not.toHaveBeenCalled();
  });

  it('a non-DRIVER actor (e.g. ADMIN) reaching DELIVERED never touches ProofOfDeliveryService — the state machine itself has no ADMIN->DELIVERED rule, but this guard is role-scoped, not status-scoped, on purpose', async () => {
    const { controller, proofOfDeliveryService, driverAuthorizationService } = buildHarness();

    await controller.updateStatus('order-1', { status: OrderStatus.DELIVERED } as any, { id: 'admin-1', role: Role.ADMIN } as any);

    expect(proofOfDeliveryService.recordForDelivery).not.toHaveBeenCalled();
    expect(driverAuthorizationService.getDriverForUser).not.toHaveBeenCalled();
  });
});

describe('OrdersController — R17: no redispatch through the generic endpoint (driver release removed)', () => {
  it('neither a DRIVER nor an ADMIN moving the order back to READY_FOR_PICKUP triggers an automatic redispatch', async () => {
    const asDriver = buildHarness();
    await asDriver.controller.updateStatus('order-1', { status: OrderStatus.READY_FOR_PICKUP } as any, { id: 'user-1', role: Role.DRIVER } as any);
    expect(asDriver.automaticDispatchService.redispatchAfterDriverRelease).not.toHaveBeenCalled();

    const asAdmin = buildHarness();
    await asAdmin.controller.updateStatus('order-1', { status: OrderStatus.READY_FOR_PICKUP } as any, { id: 'admin-1', role: Role.ADMIN } as any);
    expect(asAdmin.automaticDispatchService.redispatchAfterDriverRelease).not.toHaveBeenCalled();
  });
});
