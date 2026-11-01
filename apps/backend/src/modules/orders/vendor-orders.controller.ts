import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { VENDOR_ORDERS_LIST_MAX_SEGMENTS, VendorOrdersService } from './vendor-orders.service';
import { OrderVendorSegmentStateMachineService } from './order-vendor-segment-state-machine.service';
import { UpdateSegmentStatusDto } from './dto/update-segment-status.dto';
import { VendorWeightRecordService } from './vendor-weight-record.service';
import { RecordWeightDto } from './dto/record-weight.dto';
import { AdHocPurchaseRecordService } from './ad-hoc-purchase-record.service';
import { PriceCustomItemDto } from './dto/price-custom-item.dto';

/**
 * Phase B. Every endpoint here is scoped to the caller's own
 * VendorStaff-linked branches — see VendorOrdersService/
 * VendorStaffAuthorizationService's own doc comments for exactly how.
 * Role-gated the same way OrdersController already is (RolesGuard +
 * @Roles), since this is "a vendor acting on their own data," not an
 * admin-permission-gated operation — no Permission enum entry is
 * needed here, matching the design review's own conclusion.
 */
@ApiTags('vendor-orders')
@Controller('vendor/orders')
@UseGuards(RolesGuard)
@Roles(Role.VENDOR, Role.VENDOR_MANAGER)
export class VendorOrdersController {
  constructor(
    private readonly vendorOrdersService: VendorOrdersService,
    private readonly segmentStateMachine: OrderVendorSegmentStateMachineService,
    private readonly vendorWeightRecordService: VendorWeightRecordService,
    private readonly adHocPurchaseRecordService: AdHocPurchaseRecordService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    const orders = await this.vendorOrdersService.listForUser(user.id);
    return { data: orders, meta: { maxSegments: VENDOR_ORDERS_LIST_MAX_SEGMENTS } };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const order = await this.vendorOrdersService.getForUser(user.id, id);
    return { data: order };
  }

  @Patch('segments/:segmentId/status')
  async updateSegmentStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('segmentId') segmentId: string,
    @Body() dto: UpdateSegmentStatusDto,
  ) {
    const segment = await this.segmentStateMachine.transition({
      segmentId,
      to: dto.status,
      actorUserId: user.id,
      actorRole: user.role as Role,
      expectedReadyAt: dto.expectedReadyAt ? new Date(dto.expectedReadyAt) : undefined,
      reason: dto.reason,
    });
    return { data: segment };
  }

  /**
   * Phase G (Weighted Products). First authorized actor — Vendor
   * (here) OR Driver (see DriverController) — to record wins; see
   * OrderItemWeightRecordService's own doc comment for the full
   * immutability rule.
   */
  @Post('order-items/:itemId/weight')
  async recordWeight(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId') itemId: string,
    @Body() dto: RecordWeightDto,
  ) {
    const record = await this.vendorWeightRecordService.recordWeight({
      userId: user.id,
      orderItemId: itemId,
      weightGrams: dto.weightGrams,
    });
    return { data: record };
  }

  /**
   * Vendor Custom Item Pricing Endpoint (Chunk 4A). CONFIRMED
   * pure delegation — every rule beyond "positive integer" (item
   * ownership, item state, duplicate-pricing rejection, branch
   * ownership, transaction behavior) is enforced entirely inside the
   * existing, unchanged `AdHocPurchaseRecordService.recordVendorPrice`.
   * This closes the previously-confirmed deadlock: a Custom Item with
   * no price could never let its segment reach READY_FOR_PICKUP,
   * since no controller reached this method before now.
   */
  @Post('order-items/:itemId/price')
  async priceCustomItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId') itemId: string,
    @Body() dto: PriceCustomItemDto,
  ) {
    const record = await this.adHocPurchaseRecordService.recordVendorPrice(itemId, dto.amountMinor, user.id);
    return { data: record };
  }
}
