import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { AdminManualTransferService } from './admin-manual-transfer.service';
import { RejectManualTransferDto } from './dto/reject-manual-transfer.dto';
import { ManualTransferRefundService } from './manual-transfer-refund.service';
import { RecordRefundDto } from './dto/record-refund.dto';

/**
 * No @UseGuards here — PermissionsGuard is global, same pattern as
 * every other admin-facing controller in this codebase.
 */
@ApiTags('admin-manual-transfer')
@Controller('admin/manual-transfer-payments')
export class AdminManualTransferController {
  constructor(
    private readonly adminManualTransferService: AdminManualTransferService,
    private readonly manualTransferRefundService: ManualTransferRefundService,
  ) {}

  @Get()
  @RequiresPermission(Permission.VERIFY_MANUAL_PAYMENTS)
  async list() {
    const payments = await this.adminManualTransferService.listUnderReview();
    return { data: payments };
  }

  @Post(':paymentId/approve')
  @RequiresPermission(Permission.VERIFY_MANUAL_PAYMENTS)
  async approve(@CurrentUser() user: AuthenticatedUser, @Param('paymentId') paymentId: string) {
    const payment = await this.adminManualTransferService.approve(paymentId, user.id);
    return { data: payment };
  }

  @Post(':paymentId/reject')
  @RequiresPermission(Permission.VERIFY_MANUAL_PAYMENTS)
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('paymentId') paymentId: string,
    @Body() dto: RejectManualTransferDto,
  ) {
    const payment = await this.adminManualTransferService.reject(paymentId, user.id, dto.reason);
    return { data: payment };
  }

  /**
   * PHASE F addition. Reuses VERIFY_MANUAL_PAYMENTS — the same Admin
   * authority that verifies a transfer is the natural one to record a
   * refund against it; no new permission introduced.
   */
  @Post(':paymentId/refund')
  @RequiresPermission(Permission.VERIFY_MANUAL_PAYMENTS)
  async refund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('paymentId') paymentId: string,
    @Body() dto: RecordRefundDto,
  ) {
    await this.manualTransferRefundService.recordRefund({
      paymentId,
      amountMinor: dto.amountMinor,
      reason: dto.reason,
      actorUserId: user.id,
    });
    return { data: { recorded: true } };
  }
}
