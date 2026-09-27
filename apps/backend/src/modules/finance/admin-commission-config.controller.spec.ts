import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { AdminCommissionConfigController } from './admin-commission-config.controller';
import { Permission } from '../permissions/permission.enum';
import { REQUIRED_PERMISSIONS_KEY } from '../permissions/decorators/requires-permission.decorator';

function buildHarness(opts: { branch?: any; driver?: any }) {
  const vendorBranchesRepository = {
    findOne: jest.fn(async () => opts.branch ?? null),
    save: jest.fn(async (b: any) => b),
  };
  const driversRepository = {
    findOne: jest.fn(async () => opts.driver ?? null),
    save: jest.fn(async (d: any) => d),
  };
  const controller = new AdminCommissionConfigController(vendorBranchesRepository as any, driversRepository as any);
  return { controller, vendorBranchesRepository, driversRepository };
}

describe('AdminCommissionConfigController', () => {
  describe('setVendorCommissionRate', () => {
    it('updates and saves the branch, returning it in the response envelope', async () => {
      const { controller, vendorBranchesRepository } = buildHarness({
        branch: { id: 'branch-1', commissionRateBasisPoints: null },
      });

      const result = await controller.setVendorCommissionRate('branch-1', { commissionRateBasisPoints: 1000 });

      expect(vendorBranchesRepository.findOne).toHaveBeenCalledWith({ where: { id: 'branch-1' } });
      expect(vendorBranchesRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ commissionRateBasisPoints: 1000 }),
      );
      expect(result.data.commissionRateBasisPoints).toBe(1000);
    });

    it('throws NotFoundException for a non-existent branch, without attempting to save', async () => {
      const { controller, vendorBranchesRepository } = buildHarness({});

      await expect(
        controller.setVendorCommissionRate('missing-branch', { commissionRateBasisPoints: 1000 }),
      ).rejects.toThrow(NotFoundException);
      expect(vendorBranchesRepository.save).not.toHaveBeenCalled();
    });

    it('is gated by exactly MANAGE_VENDOR_COMMISSION', () => {
      const permissions = Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        AdminCommissionConfigController.prototype.setVendorCommissionRate,
      );
      expect(permissions).toEqual([Permission.MANAGE_VENDOR_COMMISSION]);
    });
  });

  describe('setDriverCommissionRate', () => {
    it('updates and saves the driver, returning it in the response envelope', async () => {
      const { controller, driversRepository } = buildHarness({
        driver: { id: 'driver-1', commissionRateBasisPoints: null },
      });

      const result = await controller.setDriverCommissionRate('driver-1', { commissionRateBasisPoints: 2000 });

      expect(driversRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ commissionRateBasisPoints: 2000 }),
      );
      expect(result.data.commissionRateBasisPoints).toBe(2000);
    });

    it('throws NotFoundException for a non-existent driver', async () => {
      const { controller, driversRepository } = buildHarness({});

      await expect(
        controller.setDriverCommissionRate('missing-driver', { commissionRateBasisPoints: 2000 }),
      ).rejects.toThrow(NotFoundException);
      expect(driversRepository.save).not.toHaveBeenCalled();
    });

    it('is gated by exactly MANAGE_DRIVER_COMMISSION', () => {
      const permissions = Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        AdminCommissionConfigController.prototype.setDriverCommissionRate,
      );
      expect(permissions).toEqual([Permission.MANAGE_DRIVER_COMMISSION]);
    });
  });
});
