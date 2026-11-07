import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { AdminManualTransferService } from './admin-manual-transfer.service';
import { RejectManualTransferDto } from './dto/reject-manual-transfer.dto';
import { ManualTransferRefundService } from './manual-transfer-refund.service';
import { RecordRefundDto } from './dto/record-refund.dto';
import { MarkRefundSentDto } from './dto/mark-refund-sent.dto';

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

  /** The Manual Transfer payment of an order, by its number (HT-…) — what the refund form uses instead of an internal id. */
  @Get('by-order/:orderNumber')
  @RequiresPermission(Permission.VERIFY_MANUAL_PAYMENTS)
  async byOrder(@Param('orderNumber') orderNumber: string) {
    return { data: await this.adminManualTransferService.findByOrderNumber(orderNumber) };
  }

  /** Recorded refund obligations; `?sent=false` = still to be sent, `?sent=true` = already sent. */
  @Get('refunds')
  @RequiresPermission(Permission.VERIFY_MANUAL_PAYMENTS)
  async listRefunds(@Query('sent') sent?: string) {
    const filter = sent === 'true' ? { sent: true } : sent === 'false' ? { sent: false } : {};
    return { data: await this.adminManualTransferService.listRefunds(filter) };
  }

  /** Operations confirm the refund money was really sent to the customer (the ledger entry alone never says so). Audited as an admin mutation. */
  @Post('refunds/:eventId/mark-sent')
  @RequiresPermission(Permission.VERIFY_MANUAL_PAYMENTS)
  async markRefundSent(@CurrentUser() user: AuthenticatedUser, @Param('eventId') eventId: string, @Body() dto: MarkRefundSentDto) {
    return { data: await this.adminManualTransferService.markRefundSent(eventId, user.id, dto.note) };
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
