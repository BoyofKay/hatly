import { BadRequestException, Body, Controller, NotFoundException, Param, Patch } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminAuditAction, AdminAuditService } from '../audit/admin-audit.service';
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
    private readonly audit: AdminAuditService,
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
    // Column-targeted (Operational Completion milestone): a whole-row save() could write back a stale is_available.
    await this.driversRepository.update({ id: driverId }, { commissionRateBasisPoints: dto.commissionRateBasisPoints });
    return { data: await this.driversRepository.findOneOrFail({ where: { id: driverId } }) };
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
    // R12: the old switch maps onto the acceptance mode — on = AUTO; off = VENDOR (a HATLY branch stays HATLY).
    branch.acceptanceMode = dto.autoAcceptEnabled ? 'AUTO' : branch.acceptanceMode === 'HATLY' ? 'HATLY' : 'VENDOR';
    branch.autoAcceptEnabled = branch.acceptanceMode === 'AUTO';
    await this.vendorBranchesRepository.save(branch);
    return { data: branch };
  }

  /**
   * R12 (decision register 2026-11-06): who accepts this branch's new orders — AUTO, VENDOR (default) or HATLY. Applies to orders placed
   * from now on; an order already waiting follows the CURRENT mode when someone tries to accept it (a HATLY branch's vendor cannot). Audited.
   */
  @Patch('vendor-branches/:branchId/acceptance-mode')
  @RequiresPermission(Permission.MANAGE_VENDOR_COMMISSION)
  async setAcceptanceMode(@CurrentUser() user: AuthenticatedUser, @Param('branchId') branchId: string, @Body() body: { mode?: string }) {
    const mode = body?.mode;
    if (mode !== 'AUTO' && mode !== 'VENDOR' && mode !== 'HATLY') {
      throw new BadRequestException({ message: 'mode must be AUTO, VENDOR or HATLY.', details: { code: 'VALIDATION_FAILED' } });
    }
    if (!/^[0-9a-f-]{36}$/i.test(branchId ?? '')) throw new NotFoundException('Vendor branch not found.');
    const branch = await this.vendorBranchesRepository.findOne({ where: { id: branchId } });
    if (!branch) throw new NotFoundException('Vendor branch not found.');
    const before = branch.acceptanceMode;
    branch.acceptanceMode = mode;
    branch.autoAcceptEnabled = mode === 'AUTO';
    await this.vendorBranchesRepository.save(branch);
    await this.audit.record({ actorUserId: user.id, actorRole: user.role, action: AdminAuditAction.VENDOR_BRANCH_UPDATED, targetType: 'vendor_branch', targetId: branchId, metadata: { field: 'acceptanceMode', before, after: mode } } as never);
    return { data: branch };
  }
}
