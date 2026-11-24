import { DriverCommissionRepairService } from './driver-commission-repair.service';
import { DriverCommissionRepairDto, DriverCommissionRepairPreviewDto } from './dto/driver-commission-repair.dto';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { SettlementService } from './settlement.service';
import { SettlementClosingService } from './settlement-closing.service';
import { CloseCourierDto, CloseVendorDto, StatementRangeQuery, VendorPreviewQuery } from './dto/settlement-closing.dto';

/**
 * Courier shift closing and vendor period closing. Reuses the pre-existing permissions exactly — no new permission:
 * CLOSE_DRIVER_SETTLEMENTS / CLOSE_VENDOR_SETTLEMENTS to preview and close, VIEW_DRIVER_SETTLEMENTS / VIEW_VENDOR_FINANCIAL_REPORTS to read
 * statements. A preview never writes anything.
 */
@ApiTags('admin-settlement')
@Controller('admin/settlement')
export class AdminSettlementController {
  constructor(
    private readonly settlementService: SettlementService,
    private readonly closing: SettlementClosingService,
    private readonly repairs: DriverCommissionRepairService,
  ) {}

  @Get('couriers/open')
  @RequiresPermission(Permission.CLOSE_DRIVER_SETTLEMENTS)
  async openCouriers() {
    return { data: await this.closing.openCouriers() };
  }

  /** Stage 3 "Drivers today": each courier's open closing figures and unpaid earlier closings, for the office. Read-only. */
  @Get('couriers/today')
  @RequiresPermission(Permission.CLOSE_DRIVER_SETTLEMENTS)
  async couriersToday() {
    return { data: await this.closing.couriersToday() };
  }

  @Get('vendor-branches/open')
  @RequiresPermission(Permission.CLOSE_VENDOR_SETTLEMENTS)
  async openVendorBranches() {
    return { data: await this.closing.openVendorBranches() };
  }

  @Get('drivers/:driverId/close-preview')
  @RequiresPermission(Permission.CLOSE_DRIVER_SETTLEMENTS)
  async courierPreview(@Param('driverId') driverId: string) {
    return { data: await this.closing.courierPreview(driverId) };
  }

  @Get('vendor-branches/:branchId/close-preview')
  @RequiresPermission(Permission.CLOSE_VENDOR_SETTLEMENTS)
  async vendorPreview(@Param('branchId') branchId: string, @Query() q: VendorPreviewQuery) {
    return { data: await this.closing.vendorPreview(branchId, q.periodEnd) };
  }

  @Post('vendor-branches/:branchId/close')
  @RequiresPermission(Permission.CLOSE_VENDOR_SETTLEMENTS)
  async closeVendorPeriod(@CurrentUser() user: AuthenticatedUser, @Param('branchId') branchId: string, @Body() body: CloseVendorDto = {}) {
    const period = await this.settlementService.closeVendorPeriod(branchId, user.id, body ?? {});
    return { data: period };
  }

  @Post('drivers/:driverId/close')
  @RequiresPermission(Permission.CLOSE_DRIVER_SETTLEMENTS)
  async closeDriverPeriod(@CurrentUser() user: AuthenticatedUser, @Param('driverId') driverId: string, @Body() body: CloseCourierDto = {}) {
    const period = await this.settlementService.closeDriverPeriod(driverId, user.id, body ?? {});
    return { data: period };
  }

  @Post('drivers/:driverId/commission-repair-preview')
  @RequiresPermission(Permission.ADJUST_DRIVER_FINANCES,Permission.CLOSE_DRIVER_SETTLEMENTS)
  async commissionRepairPreview(@CurrentUser() user:AuthenticatedUser,@Param('driverId') driverId:string,@Body() body:DriverCommissionRepairPreviewDto) {
    return {data:await this.repairs.preview(user,driverId,body.orderNumbers,body.rateBasisPoints)};
  }

  @Post('drivers/:driverId/commission-repair')
  @RequiresPermission(Permission.ADJUST_DRIVER_FINANCES,Permission.CLOSE_DRIVER_SETTLEMENTS)
  async commissionRepair(@CurrentUser() user:AuthenticatedUser,@Param('driverId') driverId:string,@Body() body:DriverCommissionRepairDto) {
    return {data:await this.repairs.apply(user,driverId,body.orderNumbers,body.rateBasisPoints,body.previewToken,body.reason)};
  }

  @Get('drivers/:driverId/statement')
  @RequiresPermission(Permission.VIEW_DRIVER_SETTLEMENTS)
  async courierStatement(@Param('driverId') driverId: string, @Query() q: StatementRangeQuery) {
    return { data: await this.closing.courierStatement(driverId, q.from, q.to) };
  }

  @Get('vendor-branches/:branchId/statement')
  @RequiresPermission(Permission.VIEW_VENDOR_FINANCIAL_REPORTS)
  async vendorStatement(@Param('branchId') branchId: string, @Query() q: StatementRangeQuery) {
    return { data: await this.closing.vendorStatement(branchId, q.from, q.to) };
  }
}
