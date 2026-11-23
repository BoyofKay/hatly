import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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
import { DriverShiftService } from './driver-shift.service';
import { DriverOverviewService } from './driver-overview.service';
import { IsBoolean } from 'class-validator';

class AcceptingNewOrdersDto {
  @IsBoolean() accepting: boolean;
}
import { BusinessConfigService } from '../business-config/business-config.service';
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
    private readonly businessConfigService: BusinessConfigService,
    private readonly driverShiftService: DriverShiftService,
    private readonly driverOverviewService: DriverOverviewService,
  ) {}

  /** Read-only display name; only the Admin Panel may edit a driver's name. */
  @Get('profile')
  async profile(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.driverProfileService.getProfileName(user.id) };
  }

  /** Shift (owner decision 2026-11-22): on/off duty, the open shift, and whether the driver may end it now (and why not). */
  @Get('shift')
  async shift(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.driverShiftService.stateForUser(user.id) };
  }

  @Post('shift/start')
  async startShift(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.driverShiftService.start(user.id) };
  }

  /** Refused while an order is with the driver or something is still to settle (then the office closing ends the shift). */
  @Post('shift/end')
  async endShift(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.driverShiftService.end(user.id) };
  }

  /** "Stop new orders": keep the shift and current orders, receive nothing new. */
  @Patch('shift/accepting-new-orders')
  async acceptingNewOrders(@CurrentUser() user: AuthenticatedUser, @Body() dto: AcceptingNewOrdersDto) {
    return { data: await this.driverShiftService.setAcceptingNewOrders(user.id, dto.accepting) };
  }

  /**
   * The driver's own online switch as the SERVER holds it (2026-11-15). The app used to start every launch at "offline" without asking, so a
   * driver who was still online for dispatch saw "offline" after reopening the app. Read-only; the switch is still changed only by PATCH.
   */
  @Get('online-status')
  async getOnlineStatus(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.driverProfileService.getOnlineStatus(user.id) };
  }

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

  /** Driver app round 2 — Orders tab: `tab=today|previous`, `from`/`to` (Cairo dates, Previous; default this week), `status`, `q`, `page`. */
  @Get('orders/overview')
  async ordersOverview(
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: { tab?: string; from?: string; to?: string; status?: string; q?: string; page?: string; limit?: string },
  ) {
    return { data: await this.driverOverviewService.orders(user.id, q) };
  }

  /** Driver app round 2 — Earnings tab: `tab=current|previous`, `from`/`to` (Previous; default this week), `status=paid|unpaid`. */
  @Get('earnings/overview')
  async earningsOverview(@CurrentUser() user: AuthenticatedUser, @Query() q: { tab?: string; from?: string; to?: string; status?: string }) {
    return { data: await this.driverOverviewService.earnings(user.id, q) };
  }

  /** One row per credited delivery, newest first (paginated). */
  @Get('transactions')
  async transactions(@CurrentUser() user: AuthenticatedUser, @Query() q: { page?: string; limit?: string }) {
    const r = await this.driverEarningsService.transactions(user.id, q);
    return { data: r.items, meta: { page: r.page, limit: r.limit, total: r.total } };
  }

  /** `scope=active` (current apps): only orders that still need the driver; `finished`: history rows; omitted: both (older apps, R38). */
  @Get('deliveries')
  async listDeliveries(@CurrentUser() user: AuthenticatedUser, @Query('scope') scope?: string) {
    const deliveries = await this.driverDeliveriesService.listForUser(user.id, scope === 'active' || scope === 'finished' ? scope : 'all');
    return { data: deliveries };
  }

  @Get('deliveries/:id')
  async getDelivery(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Headers('x-hatly-driver-ack') ackMode?: string) {
    // R16/R38: an app with the acknowledge button says so; older apps acknowledge by opening the order.
    const delivery = await this.driverDeliveriesService.getForUser(user.id, id, { implicitAcknowledgement: ackMode !== 'explicit' });
    return { data: delivery };
  }

  /** R17: how a driver reaches Operations (they call; there is no release button). `null` hides the action in the app. */
  @Get('support-contact')
  async supportContact() {
    return { data: { operationsPhone: await this.businessConfigService.getOperationsContactPhone() } };
  }

  /** R16: acknowledge an assignment (no accept/reject exists). Opening the delivery acknowledges it too. */
  @Post('deliveries/:id/acknowledge')
  async acknowledgeDelivery(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const delivery = await this.driverDeliveriesService.acknowledgeForUser(user.id, id);
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
