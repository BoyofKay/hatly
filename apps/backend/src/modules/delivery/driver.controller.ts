import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { DriverProfileService } from './driver-profile.service';
import { DriverDeliveriesService } from './driver-deliveries.service';
import { DriverOrderActionsService } from './driver-order-actions.service';
import { DriverPurchaseService } from './driver-purchase.service';
import { DriverWeightRecordService } from './driver-weight-record.service';
import { DriverEarningsService } from './driver-earnings.service';
import { UpdateDriverOnlineStatusDto } from './dto/update-driver-online-status.dto';
import { UpdateDriverLocationDto } from './dto/update-driver-location.dto';
import { UpdateOrderStatusDto } from '../orders/dto/update-order-status.dto';
import { OrderStatus } from '../orders/order-status.enum';
import { RecordPurchaseAmountDto } from './dto/record-purchase-amount.dto';
import { RecordWeightDto } from '../orders/dto/record-weight.dto';

/**
 * Phase C. Role-gated the same way VendorOrdersController already is
 * (Phase B precedent) — a driver acting on their own data, not an
 * admin-permission-gated operation. Every endpoint additionally goes
 * through DriverAuthorizationService (via the services below) for
 * ownership — role gating alone was confirmed insufficient in the
 * Phase C design review, mirroring the exact gap Phase B found and
 * fixed for vendors.
 */
@ApiTags('driver')
@Controller('driver')
@UseGuards(RolesGuard)
@Roles(Role.DRIVER)
export class DriverController {
  constructor(
    private readonly driverProfileService: DriverProfileService,
    private readonly driverDeliveriesService: DriverDeliveriesService,
    private readonly driverOrderActionsService: DriverOrderActionsService,
    private readonly driverPurchaseService: DriverPurchaseService,
    private readonly driverWeightRecordService: DriverWeightRecordService,
    private readonly driverEarningsService: DriverEarningsService,
  ) {}

  @Patch('online-status')
  async setOnlineStatus(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateDriverOnlineStatusDto) {
    const driver = await this.driverProfileService.setOnlineStatus(user.id, dto.isOnline);
    return { data: driver };
  }

  @Patch('location')
  async updateLocation(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateDriverLocationDto) {
    const driver = await this.driverProfileService.updateLocation(user.id, dto.latitude, dto.longitude);
    return { data: driver };
  }

  /** The driver's own recorded money: the open-period preview, closed settlement periods and their payments. */
  @Get('earnings')
  async earnings(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.driverEarningsService.summary(user.id) };
  }

  /** One row per credited delivery, newest first (paginated). */
  @Get('transactions')
  async transactions(@CurrentUser() user: AuthenticatedUser, @Query() q: { page?: string; limit?: string }) {
    const r = await this.driverEarningsService.transactions(user.id, q);
    return { data: r.items, meta: { page: r.page, limit: r.limit, total: r.total } };
  }

  @Get('deliveries')
  async listDeliveries(@CurrentUser() user: AuthenticatedUser) {
    const deliveries = await this.driverDeliveriesService.listForUser(user.id);
    return { data: deliveries };
  }

  @Get('deliveries/:id')
  async getDelivery(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const delivery = await this.driverDeliveriesService.getForUser(user.id, id);
    return { data: delivery };
  }

  @Patch('deliveries/:id/status')
  async updateDeliveryStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    const order = await this.driverOrderActionsService.updateStatus({
      userId: user.id,
      deliveryId: id,
      to: dto.status as OrderStatus,
      cancellationReason: dto.cancellationReason,
      failureReason: dto.failureReason,
      proofPhotoUrl: dto.proofPhotoUrl,
      recipientName: dto.recipientName,
    });
    return { data: order };
  }

  @Post('order-items/:id/purchase-amount')
  async recordPurchaseAmount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordPurchaseAmountDto,
  ) {
    const record = await this.driverPurchaseService.recordPurchase({
      userId: user.id,
      orderItemId: id,
      amountMinor: dto.amountMinor,
    });
    return { data: record };
  }

  /**
   * Phase G (Weighted Products). First authorized actor — Driver
   * (here) OR Vendor (see VendorOrdersController) — to record wins.
   */
  @Post('order-items/:id/weight')
  async recordWeight(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: RecordWeightDto) {
    const record = await this.driverWeightRecordService.recordWeight({
      userId: user.id,
      orderItemId: id,
      weightGrams: dto.weightGrams,
    });
    return { data: record };
  }
}
