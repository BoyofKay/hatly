import { Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { SettlementService } from './settlement.service';

/**
 * Reuses the pre-existing CLOSE_VENDOR_SETTLEMENTS/CLOSE_DRIVER_SETTLEMENTS
 * permissions exactly as instructed — no new permission introduced.
 */
@ApiTags('admin-settlement')
@Controller('admin/settlement')
export class AdminSettlementController {
  constructor(private readonly settlementService: SettlementService) {}

  @Post('vendor-branches/:branchId/close')
  @RequiresPermission(Permission.CLOSE_VENDOR_SETTLEMENTS)
  async closeVendorPeriod(@CurrentUser() user: AuthenticatedUser, @Param('branchId') branchId: string) {
    const period = await this.settlementService.closeVendorPeriod(branchId, user.id);
    return { data: period };
  }

  @Post('drivers/:driverId/close')
  @RequiresPermission(Permission.CLOSE_DRIVER_SETTLEMENTS)
  async closeDriverPeriod(@CurrentUser() user: AuthenticatedUser, @Param('driverId') driverId: string) {
    const period = await this.settlementService.closeDriverPeriod(driverId, user.id);
    return { data: period };
  }
}
