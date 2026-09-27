import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { VendorWeightRecordService } from './vendor-weight-record.service';

function buildHarness(items: any[], ownedBranches: Record<string, string[]>) {
  const orderItemsRepository = {
    findOne: jest.fn(async ({ where }: any) => items.find((i) => i.id === where.id) ?? null),
  };
  const vendorStaffAuthorizationService = {
    assertOwnsBranch: jest.fn(async (userId: string, vendorBranchId: string) => {
      if (!(ownedBranches[userId] ?? []).includes(vendorBranchId)) {
        throw new ForbiddenException('You are not authorized to act on this vendor branch.');
      }
    }),
  };
  const orderItemWeightRecordService = {
    record: jest.fn(async (params: any) => ({ id: 'record-1', ...params })),
  };
  const service = new VendorWeightRecordService(
    orderItemsRepository as any,
    vendorStaffAuthorizationService as any,
    orderItemWeightRecordService as any,
  );
  return { service, orderItemWeightRecordService, vendorStaffAuthorizationService };
}

describe('VendorWeightRecordService', () => {
  it("delegates to OrderItemWeightRecordService once branch ownership is confirmed", async () => {
    const item = { id: 'item-1', orderVendorSegment: { vendorBranchId: 'branch-1' } };
    const { service, orderItemWeightRecordService } = buildHarness([item], { 'user-1': ['branch-1'] });

    const result = await service.recordWeight({ userId: 'user-1', orderItemId: 'item-1', weightGrams: 1150 });

    expect(orderItemWeightRecordService.record).toHaveBeenCalledWith({
      orderItemId: 'item-1',
      weightGrams: 1150,
      recordedByUserId: 'user-1',
    });
    expect(result.weightGrams).toBe(1150);
  });

  it('rejects when the user does not manage this branch — never reaches the core service', async () => {
    const item = { id: 'item-1', orderVendorSegment: { vendorBranchId: 'branch-1' } };
    const { service, orderItemWeightRecordService } = buildHarness([item], { 'user-1': ['branch-2'] });

    await expect(
      service.recordWeight({ userId: 'user-1', orderItemId: 'item-1', weightGrams: 1150 }),
    ).rejects.toThrow(ForbiddenException);
    expect(orderItemWeightRecordService.record).not.toHaveBeenCalled();
  });

  it('rejects for an AD_HOC_SERVICE item with no vendorBranchId', async () => {
    const item = { id: 'item-1', orderVendorSegment: { vendorBranchId: null } };
    const { service } = buildHarness([item], { 'user-1': [] });

    await expect(
      service.recordWeight({ userId: 'user-1', orderItemId: 'item-1', weightGrams: 1150 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects when the order item does not exist', async () => {
    const { service } = buildHarness([], {});

    await expect(
      service.recordWeight({ userId: 'user-1', orderItemId: 'missing', weightGrams: 1150 }),
    ).rejects.toThrow(NotFoundException);
  });
});
