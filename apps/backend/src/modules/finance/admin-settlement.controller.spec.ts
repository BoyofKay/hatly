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
  const closing = { courierPreview: jest.fn(async () => ({ lines: [] })), vendorPreview: jest.fn(async () => ({ lines: [] })), courierStatement: jest.fn(async () => ({})), vendorStatement: jest.fn(async () => ({})), openCouriers: jest.fn(async () => []), openVendorBranches: jest.fn(async () => []) };
  const controller = new AdminSettlementController(settlementService as any, closing as any);
  return { controller, settlementService, closing };
}

const adminUser = { id: 'admin-1', role: 'ADMIN' };

describe('AdminSettlementController', () => {
  describe('closeVendorPeriod', () => {
    it("delegates to SettlementService.closeVendorPeriod with the branch id and the acting admin's id", async () => {
      const { controller, settlementService } = buildHarness({});

      const result = await controller.closeVendorPeriod(adminUser as any, 'branch-1');

      expect(settlementService.closeVendorPeriod).toHaveBeenCalledWith('branch-1', 'admin-1', {});
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

      expect(settlementService.closeDriverPeriod).toHaveBeenCalledWith('driver-1', 'admin-1', {});
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

  describe('preview, statements and lists', () => {
    it('passes the preview token and period end through to the close', async () => {
      const { controller, settlementService } = buildHarness({});
      await controller.closeVendorPeriod(adminUser as any, 'branch-1', { previewToken: 't', periodEnd: '2026-11-01' });
      expect(settlementService.closeVendorPeriod).toHaveBeenCalledWith('branch-1', 'admin-1', { previewToken: 't', periodEnd: '2026-11-01' });
      await controller.closeDriverPeriod(adminUser as any, 'driver-1', { previewToken: 'x' });
      expect(settlementService.closeDriverPeriod).toHaveBeenCalledWith('driver-1', 'admin-1', { previewToken: 'x' });
    });

    it.each([
      ['courierPreview', Permission.CLOSE_DRIVER_SETTLEMENTS],
      ['openCouriers', Permission.CLOSE_DRIVER_SETTLEMENTS],
      ['vendorPreview', Permission.CLOSE_VENDOR_SETTLEMENTS],
      ['openVendorBranches', Permission.CLOSE_VENDOR_SETTLEMENTS],
      ['courierStatement', Permission.VIEW_DRIVER_SETTLEMENTS],
      ['vendorStatement', Permission.VIEW_VENDOR_FINANCIAL_REPORTS],
    ])('%s is gated by exactly %s (no new permission)', (method, permission) => {
      expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, (AdminSettlementController.prototype as any)[method])).toEqual([permission]);
    });
  });
});
