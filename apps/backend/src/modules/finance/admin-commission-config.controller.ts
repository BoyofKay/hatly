import { Body, Controller, NotFoundException, Param, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { Driver } from '../delivery/entities/driver.entity';
import { SetCommissionRateDto } from './dto/set-commission-rate.dto';
import { SetAutoAcceptDto } from './dto/set-auto-accept.dto';

/**
 * CONFIRMED (Phase F): commission is per-vendor/per-branch and
 * per-driver, never one global percentage — these are the two
 * endpoints that set those rates. Reuses the two pre-existing
 * financial permissions exactly as instructed
 * (MANAGE_VENDOR_COMMISSION / MANAGE_DRIVER_COMMISSION) — no new
 * permission introduced here.
 *
 * Setting a rate here NEVER touches any already-recorded
 * FinancialEvent — every event snapshots the rate that applied at
 * recognition time (see OrderFinancialEventsService), so changing the
 * rate here only affects events recognized AFTER this call.
 */
@ApiTags('admin-commission-config')
@Controller('admin')
export class AdminCommissionConfigController {
  constructor(
    @InjectRepository(VendorBranch) private readonly vendorBranchesRepository: Repository<VendorBranch>,
    @InjectRepository(Driver) private readonly driversRepository: Repository<Driver>,
  ) {}

  @Patch('vendor-branches/:branchId/commission-rate')
  @RequiresPermission(Permission.MANAGE_VENDOR_COMMISSION)
  async setVendorCommissionRate(@Param('branchId') branchId: string, @Body() dto: SetCommissionRateDto) {
    const branch = await this.vendorBranchesRepository.findOne({ where: { id: branchId } });
    if (!branch) {
      throw new NotFoundException('Vendor branch not found.');
    }
    branch.commissionRateBasisPoints = dto.commissionRateBasisPoints;
    await this.vendorBranchesRepository.save(branch);
    return { data: branch };
  }

  @Patch('drivers/:driverId/commission-rate')
  @RequiresPermission(Permission.MANAGE_DRIVER_COMMISSION)
  async setDriverCommissionRate(@Param('driverId') driverId: string, @Body() dto: SetCommissionRateDto) {
    const driver = await this.driversRepository.findOne({ where: { id: driverId } });
    if (!driver) {
      throw new NotFoundException('Driver not found.');
    }
    driver.commissionRateBasisPoints = dto.commissionRateBasisPoints;
    await this.driversRepository.save(driver);
    return { data: driver };
  }

  /**
   * PHASE G fix. CONFIRMED: auto-accept must be per-Vendor/Branch,
   * never global — see VendorBranch.autoAcceptEnabled's own comment.
   * Reuses MANAGE_VENDOR_COMMISSION — no new permission introduced,
   * since this is the same "admin configuring one operational field on
   * one vendor branch" action as the commission endpoint above.
   */
  @Patch('vendor-branches/:branchId/auto-accept')
  @RequiresPermission(Permission.MANAGE_VENDOR_COMMISSION)
  async setAutoAccept(@Param('branchId') branchId: string, @Body() dto: SetAutoAcceptDto) {
    const branch = await this.vendorBranchesRepository.findOne({ where: { id: branchId } });
    if (!branch) {
      throw new NotFoundException('Vendor branch not found.');
    }
    branch.autoAcceptEnabled = dto.autoAcceptEnabled;
    await this.vendorBranchesRepository.save(branch);
    return { data: branch };
  }
}
