import { DriverPurchaseService } from './driver-purchase.service';

describe('DriverPurchaseService', () => {
  it('delegates to AdHocPurchaseRecordService.recordDriverPurchase with the raw userId — ownership/eligibility now live entirely inside that service', async () => {
    const adHocPurchaseRecordService = {
      recordDriverPurchase: jest.fn(async (orderItemId: string, amountMinor: number, driverUserId: string) => ({
        id: 'record-1',
        orderItemId,
        amountMinor,
        recordedByDriverId: 'driver-1',
      })),
    };
    const service = new DriverPurchaseService(adHocPurchaseRecordService as any);

    const result = await service.recordPurchase({ userId: 'user-1', orderItemId: 'item-1', amountMinor: 4500 });

    expect(adHocPurchaseRecordService.recordDriverPurchase).toHaveBeenCalledWith('item-1', 4500, 'user-1');
    expect(result.amountMinor).toBe(4500);
  });
});
