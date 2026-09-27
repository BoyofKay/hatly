import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { AdminSettlementController } from './admin-settlement.controller';
import { Permission } from '../permissions/permission.enum';
import { REQUIRED_PERMISSIONS_KEY } from '../permissions/decorators/requires-permission.decorator';

function buildHarness(opts: {
  closeVendorPeriodImpl?: () => Promise<any>;
  closeDriverPeriodImpl?: () => Promise<any>;
}) {
  const settlementService = {
    closeVendorPeriod: jest.fn(opts.closeVendorPeriodImpl ?? (async () => ({ id: 'vp-1', status: 'CLOSED' }))),
    closeDriverPeriod: jest.fn(opts.closeDriverPeriodImpl ?? (async () => ({ id: 'dp-1', status: 'CLOSED' }))),
  };
  const controller = new AdminSettlementController(settlementService as any);
  return { controller, settlementService };
}

const adminUser = { id: 'admin-1', role: 'ADMIN' };

describe('AdminSettlementController', () => {
  describe('closeVendorPeriod', () => {
    it("delegates to SettlementService.closeVendorPeriod with the branch id and the acting admin's id", async () => {
      const { controller, settlementService } = buildHarness({});

      const result = await controller.closeVendorPeriod(adminUser as any, 'branch-1');

      expect(settlementService.closeVendorPeriod).toHaveBeenCalledWith('branch-1', 'admin-1');
      expect(result.data.status).toBe('CLOSED');
    });

    it('propagates an error from the service (e.g. no new activity to settle) rather than swallowing it', async () => {
      const { controller } = buildHarness({
        closeVendorPeriodImpl: async () => {
          throw new BadRequestException('No new activity to settle since the last closed period.');
        },
      });

      await expect(controller.closeVendorPeriod(adminUser as any, 'branch-1')).rejects.toThrow(BadRequestException);
    });

    it('is gated by exactly CLOSE_VENDOR_SETTLEMENTS', () => {
      const permissions = Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        AdminSettlementController.prototype.closeVendorPeriod,
      );
      expect(permissions).toEqual([Permission.CLOSE_VENDOR_SETTLEMENTS]);
    });
  });

  describe('closeDriverPeriod', () => {
    it("delegates to SettlementService.closeDriverPeriod with the driver id and the acting admin's id", async () => {
      const { controller, settlementService } = buildHarness({});

      const result = await controller.closeDriverPeriod(adminUser as any, 'driver-1');

      expect(settlementService.closeDriverPeriod).toHaveBeenCalledWith('driver-1', 'admin-1');
      expect(result.data.status).toBe('CLOSED');
    });

    it('propagates a service error rather than swallowing it', async () => {
      const { controller } = buildHarness({
        closeDriverPeriodImpl: async () => {
          throw new BadRequestException('No new activity to settle since the last closed period.');
        },
      });

      await expect(controller.closeDriverPeriod(adminUser as any, 'driver-1')).rejects.toThrow(BadRequestException);
    });

    it('is gated by exactly CLOSE_DRIVER_SETTLEMENTS', () => {
      const permissions = Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        AdminSettlementController.prototype.closeDriverPeriod,
      );
      expect(permissions).toEqual([Permission.CLOSE_DRIVER_SETTLEMENTS]);
    });
  });
});
