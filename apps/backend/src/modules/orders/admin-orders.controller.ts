import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { PermissionsService } from '../permissions/permissions.service';
import { maskName, maskPhone } from '../admin-platform/common/platform-sql';
import { AdminOrdersService } from './admin-orders.service';
import { SearchAdminOrdersQueryDto } from './dto/search-admin-orders-query.dto';
import { PriceCustomItemDto } from './dto/price-custom-item.dto';
import { AdHocPurchaseRecordService } from './ad-hoc-purchase-record.service';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role.enum';
import { OrderVendorSegmentStateMachineService } from './order-vendor-segment-state-machine.service';
import { UpdateSegmentStatusDto } from './dto/update-segment-status.dto';
import { DriverNoteDto } from './dto/driver-note.dto';

/**
 * Admin Order Detail View (Chunk 2a). Read-only, general-purpose —
 * CONFIRMED never scoped by customer id (unlike `orders.controller.ts`'s
 * Customer-facing `GET :id`), gated by the new, dedicated `VIEW_ORDERS`
 * permission (never `MANAGE_CUSTOMER_WALLET`, which is a distinct,
 * narrower money-movement capability). No `@UseGuards` needed —
 * `PermissionsGuard` is global, same as every other Admin controller
 * in this codebase.
 */
@ApiTags('admin-orders')
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(
    private readonly adminOrdersService: AdminOrdersService,
    private readonly adHocPurchaseRecordService: AdHocPurchaseRecordService,
    private readonly segmentStateMachine: OrderVendorSegmentStateMachineService,
    private readonly permissionsService: PermissionsService,
  ) {}

  /** Customer name / phone are masked unless the caller holds VIEW_CUSTOMER_PII (SUPER_ADMIN always does). */
  private async maskCustomer<T extends { customer?: { fullName?: string | null; phone?: string | null } | null }>(user: AuthenticatedUser, row: T): Promise<T> {
    if (!row.customer || (await this.permissionsService.actorHolds(user, Permission.VIEW_CUSTOMER_PII))) return row;
    return { ...row, customer: { ...row.customer, fullName: maskName(row.customer.fullName ?? null), phone: maskPhone(row.customer.phone ?? null) } } as T;
  }

  /**
   * M3b (Launch-Readiness Gap Audit, G-04) — Admin Order Search/browse.
   * Same `VIEW_ORDERS` permission as the rest of this controller — no
   * new permission introduced. `GET admin/orders` (no path segment)
   * can never collide with the `:id(...)`/`by-number/:orderNumber`
   * routes below (different route shapes), so registration order
   * doesn't matter here the way this controller's own top comment
   * warns about for `:id` vs. a sibling module's static segment.
   */
  /**
   * Hatly operations handle a segment ON THE VENDOR'S BEHALF — accept (CONFIRMED), reject (CANCELLED + a required reason), PREPARING,
   * READY_FOR_PICKUP — for any branch and for Hatly/Wasally service segments. This is the SAME transition implementation the vendor
   * endpoint uses (state table, payment gate, partial-cancellation money, readiness, dispatch); the only difference is the actor, which
   * the segment history records with `onBehalfOfVendor = true`. Requires MANAGE_ORDER_FULFILMENT (SUPER_ADMIN always passes).
   */
  @Patch('segments/:segmentId/status')
  @RequiresPermission(Permission.MANAGE_ORDER_FULFILMENT)
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

  /** Owner decision 2026-11-27: Operations can write a note for the driver (shown in the driver app). An empty note clears it. */
  @Patch(':id([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/driver-note')
  @RequiresPermission(Permission.MANAGE_ORDER_FULFILMENT)
  async setDriverNote(@Param('id') id: string, @Body() dto: DriverNoteDto) {
    return { data: await this.adminOrdersService.setDriverNote(id, dto.note) };
  }

  @Get()
  @RequiresPermission(Permission.VIEW_ORDERS)
  async search(@CurrentUser() user: AuthenticatedUser, @Query() query: SearchAdminOrdersQueryDto) {
    const result = await this.adminOrdersService.search(query);
    const pii = await this.permissionsService.actorHolds(user, Permission.VIEW_CUSTOMER_PII);
    const data = pii ? result.data : await Promise.all(result.data.map((row) => this.maskCustomer(user, row)));
    return { data, meta: { page: result.page, limit: result.limit, total: result.total } };
  }

  // The id is constrained to a UUID-shaped segment. Without it `:id` also matches the static
  // sibling routes other modules register on the same prefix (`GET /admin/orders/dispatchable`,
  // `GET /admin/orders/failed-deliveries`): whichever module Nest happened to register FIRST won,
  // so `dispatchable` was answered by this handler — gated by the wrong permission and crashing
  // with a 500 ("invalid input syntax for type uuid"). Non-UUID segments now fall through.
  @Get(':id([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})')
  @RequiresPermission(Permission.VIEW_ORDERS)
  async getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const data = await this.maskCustomer(user, await this.adminOrdersService.getOne(id));
    return { data };
  }

  /** The same detail view, looked up by the customer-facing order number (`HT-100234`) — the reference support actually has. */
  @Get('by-number/:orderNumber')
  @RequiresPermission(Permission.VIEW_ORDERS)
  async getOneByOrderNumber(@CurrentUser() user: AuthenticatedUser, @Param('orderNumber') orderNumber: string) {
    const data = await this.maskCustomer(user, await this.adminOrdersService.getOneByIdOrOrderNumber(orderNumber));
    return { data };
  }

  /**
   * Hatly Service price confirmation (operations). Replaces the explicit PENDING price of a Hatly Service request with the
   * confirmed amount; the order's subtotal, total and amount due are recomputed on the backend (see
   * `AdHocPurchaseRecordService.confirmHatlyServicePrice`). Gated by `MANAGE_HATLY_SERVICE_PRICING` — the existing permission
   * for Hatly Service pricing, no new permission. 201 when the price was recorded; 200 with `alreadyApplied: true` when the same
   * confirmation is repeated (idempotent); 409 when a different amount was already recorded.
   */
  @Post('items/:itemId/confirm-price')
  @RequiresPermission(Permission.MANAGE_HATLY_SERVICE_PRICING)
  async confirmHatlyServicePrice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId') itemId: string,
    @Body() dto: PriceCustomItemDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { record, alreadyApplied } = await this.adHocPurchaseRecordService.confirmHatlyServicePrice(itemId, dto.amountMinor, user.id);
    if (alreadyApplied) res.status(200);
    return { data: { id: record.id, orderItemId: record.orderItemId, amountMinor: Number(record.amountMinor), recordedByRole: record.recordedByRole, alreadyApplied } };
  }
}
