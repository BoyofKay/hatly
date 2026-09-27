import { NotFoundException } from '@nestjs/common';
import { DriverWeightRecordService } from './driver-weight-record.service';

function buildHarness(items: any[], deliveries: any[], driverId = 'driver-1') {
  const orderItemsRepository = {
    findOne: jest.fn(async ({ where }: any) => items.find((i) => i.id === where.id) ?? null),
  };
  const deliveriesRepository = {
    findOne: jest.fn(async ({ where }: any) => deliveries.find((d) => d.orderId === where.orderId) ?? null),
  };
  const driverAuthorizationService = {
    getDriverForUser: jest.fn(async () => ({ id: driverId })),
  };
  const orderItemWeightRecordService = {
    record: jest.fn(async (params: any) => ({ id: 'record-1', ...params })),
  };
  const service = new DriverWeightRecordService(
    orderItemsRepository as any,
    deliveriesRepository as any,
    driverAuthorizationService as any,
    orderItemWeightRecordService as any,
  );
  return { service, orderItemWeightRecordService };
}

describe('DriverWeightRecordService', () => {
  it('delegates to OrderItemWeightRecordService once ownership via Delivery.driverId is confirmed', async () => {
    const item = { id: 'item-1', orderVendorSegment: { orderId: 'order-1' } };
    const delivery = { id: 'delivery-1', orderId: 'order-1', driverId: 'driver-1' };
    const { service, orderItemWeightRecordService } = buildHarness([item], [delivery], 'driver-1');

    const result = await service.recordWeight({ userId: 'user-1', orderItemId: 'item-1', weightGrams: 1150 });

    expect(orderItemWeightRecordService.record).toHaveBeenCalledWith({
      orderItemId: 'item-1',
      weightGrams: 1150,
      recordedByDriverId: 'driver-1',
    });
    expect(result.weightGrams).toBe(1150);
  });

  it('rejects when the order is not assigned to this driver — never reaches the core service', async () => {
    const item = { id: 'item-1', orderVendorSegment: { orderId: 'order-1' } };
    const delivery = { id: 'delivery-1', orderId: 'order-1', driverId: 'driver-2' }; // different driver
    const { service, orderItemWeightRecordService } = buildHarness([item], [delivery], 'driver-1');

    await expect(
      service.recordWeight({ userId: 'user-1', orderItemId: 'item-1', weightGrams: 1150 }),
    ).rejects.toThrow(NotFoundException);
    expect(orderItemWeightRecordService.record).not.toHaveBeenCalled();
  });

  it('rejects when no delivery exists for the order at all', async () => {
    const item = { id: 'item-1', orderVendorSegment: { orderId: 'order-1' } };
    const { service } = buildHarness([item], [], 'driver-1');

    await expect(
      service.recordWeight({ userId: 'user-1', orderItemId: 'item-1', weightGrams: 1150 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects when the order item does not exist', async () => {
    const { service } = buildHarness([], [], 'driver-1');

    await expect(
      service.recordWeight({ userId: 'user-1', orderItemId: 'missing', weightGrams: 1150 }),
    ).rejects.toThrow(NotFoundException);
  });
});
