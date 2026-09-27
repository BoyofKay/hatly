import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { FailedDeliveryResolutionService } from './failed-delivery-resolution.service';
import { CreateFailedDeliveryResolutionDto } from './dto/create-failed-delivery-resolution.dto';

/**
 * Failed Delivery Resolution (Chunk 2b). Gated by the new
 * `MANAGE_ORDER_ISSUES` permission — deliberately distinct from
 * `VIEW_ORDERS` (Chunk 2a's read-only Order detail) and
 * `MANAGE_CUSTOMER_WALLET` (a different money-movement capability).
 * No `@UseGuards` — `PermissionsGuard` is global, same as every other
 * Admin controller in this codebase.
 */
@ApiTags('admin-failed-delivery')
@Controller('admin/orders')
export class FailedDeliveryResolutionController {
  constructor(private readonly failedDeliveryResolutionService: FailedDeliveryResolutionService) {}

  @Get('failed-deliveries')
  @RequiresPermission(Permission.MANAGE_ORDER_ISSUES)
  async listQueue() {
    const data = await this.failedDeliveryResolutionService.listQueue();
    return { data };
  }

  @Post(':id/failed-delivery-resolution')
  @RequiresPermission(Permission.MANAGE_ORDER_ISSUES)
  async resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateFailedDeliveryResolutionDto,
  ) {
    const data = await this.failedDeliveryResolutionService.resolve(
      id,
      {
        outcome: dto.outcome,
        refundAmountMinor: dto.refundAmountMinor,
        driverReviewNeeded: dto.driverReviewNeeded,
        driverReviewNotes: dto.driverReviewNotes,
        notes: dto.notes,
      },
      user.id,
    );
    return { data };
  }

  /**
   * Failed Delivery — Manual Transfer Refund Execution (Chunk 2c).
   * Same permission as resolution creation — CONFIRMED deliberately,
   * per the approved design: this is the execution of a decision
   * already gated by MANAGE_ORDER_ISSUES, not a general Wallet-money
   * operation (never MANAGE_CUSTOMER_WALLET).
   */
  @Post(':id/failed-delivery-refund')
  @RequiresPermission(Permission.MANAGE_ORDER_ISSUES)
  async executeRefund(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const data = await this.failedDeliveryResolutionService.executeManualTransferRefund(id, user.id);
    return { data };
  }
}
