import { NotFoundException } from '@nestjs/common';
import { DriverAuthorizationService } from './driver-authorization.service';

function buildHarness(drivers: any[], deliveries: any[]) {
  const driversRepository = {
    findOne: jest.fn(async ({ where }: any) => drivers.find((d) => d.userId === where.userId) ?? null),
  };
  const deliveriesRepository = {
    findOne: jest.fn(async ({ where }: any) => {
      if (where.id) return deliveries.find((d) => d.id === where.id) ?? null;
      if (where.orderId) return deliveries.find((d) => d.orderId === where.orderId) ?? null;
      return null;
    }),
  };
  const service = new DriverAuthorizationService(driversRepository as any, deliveriesRepository as any);
  return { service };
}

describe('DriverAuthorizationService', () => {
  it('getDriverForUser resolves the Driver profile for a given User id', async () => {
    const { service } = buildHarness([{ id: 'driver-1', userId: 'user-1' }], []);
    const driver = await service.getDriverForUser('user-1');
    expect(driver.id).toBe('driver-1');
  });

  it('getDriverForUser throws NotFoundException when the user has no Driver profile', async () => {
    const { service } = buildHarness([], []);
    await expect(service.getDriverForUser('user-1')).rejects.toThrow(NotFoundException);
  });

  it('assertOwnsDelivery returns the Delivery when it belongs to the driver', async () => {
    const { service } = buildHarness([], [{ id: 'delivery-1', driverId: 'driver-1' }]);
    const delivery = await service.assertOwnsDelivery('driver-1', 'delivery-1');
    expect(delivery.id).toBe('delivery-1');
  });

  it("rejects a driver acting on another driver's delivery — the core cross-driver isolation guarantee", async () => {
    const { service } = buildHarness([], [{ id: 'delivery-1', driverId: 'driver-2' }]);
    await expect(service.assertOwnsDelivery('driver-1', 'delivery-1')).rejects.toThrow(NotFoundException);
  });

  it('rejects a non-existent delivery with the same NotFoundException as an unowned one — does not leak which case it is', async () => {
    const { service } = buildHarness([], []);
    await expect(service.assertOwnsDelivery('driver-1', 'missing')).rejects.toThrow(NotFoundException);
  });

  it('M4: getOwnedDeliveryForOrder returns the Delivery when it belongs to the driver, resolved by orderId', async () => {
    const { service } = buildHarness([], [{ id: 'delivery-1', orderId: 'order-1', driverId: 'driver-1' }]);
    const delivery = await service.getOwnedDeliveryForOrder('driver-1', 'order-1');
    expect(delivery.id).toBe('delivery-1');
  });

  it("M4: getOwnedDeliveryForOrder rejects another driver's order — same cross-driver isolation as assertOwnsDelivery", async () => {
    const { service } = buildHarness([], [{ id: 'delivery-1', orderId: 'order-1', driverId: 'driver-2' }]);
    await expect(service.getOwnedDeliveryForOrder('driver-1', 'order-1')).rejects.toThrow(NotFoundException);
  });

  it('M4: getOwnedDeliveryForOrder rejects a non-existent order the same way', async () => {
    const { service } = buildHarness([], []);
    await expect(service.getOwnedDeliveryForOrder('driver-1', 'missing-order')).rejects.toThrow(NotFoundException);
  });
});
