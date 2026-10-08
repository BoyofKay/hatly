import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { AdminOrdersService } from './admin-orders.service';
import { SearchAdminOrdersQueryDto } from './dto/search-admin-orders-query.dto';
import { PriceCustomItemDto } from './dto/price-custom-item.dto';
import { AdHocPurchaseRecordService } from './ad-hoc-purchase-record.service';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

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
  ) {}

  /**
   * M3b (Launch-Readiness Gap Audit, G-04) — Admin Order Search/browse.
   * Same `VIEW_ORDERS` permission as the rest of this controller — no
   * new permission introduced. `GET admin/orders` (no path segment)
   * can never collide with the `:id(...)`/`by-number/:orderNumber`
   * routes below (different route shapes), so registration order
   * doesn't matter here the way this controller's own top comment
   * warns about for `:id` vs. a sibling module's static segment.
   */
  @Get()
  @RequiresPermission(Permission.VIEW_ORDERS)
  async search(@Query() query: SearchAdminOrdersQueryDto) {
    const result = await this.adminOrdersService.search(query);
    return { data: result.data, meta: { page: result.page, limit: result.limit, total: result.total } };
  }

  // The id is constrained to a UUID-shaped segment. Without it `:id` also matches the static
  // sibling routes other modules register on the same prefix (`GET /admin/orders/dispatchable`,
  // `GET /admin/orders/failed-deliveries`): whichever module Nest happened to register FIRST won,
  // so `dispatchable` was answered by this handler — gated by the wrong permission and crashing
  // with a 500 ("invalid input syntax for type uuid"). Non-UUID segments now fall through.
  @Get(':id([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})')
  @RequiresPermission(Permission.VIEW_ORDERS)
  async getOne(@Param('id') id: string) {
    const data = await this.adminOrdersService.getOne(id);
    return { data };
  }

  /** The same detail view, looked up by the customer-facing order number (`HT-100234`) — the reference support actually has. */
  @Get('by-number/:orderNumber')
  @RequiresPermission(Permission.VIEW_ORDERS)
  async getOneByOrderNumber(@Param('orderNumber') orderNumber: string) {
    const data = await this.adminOrdersService.getOneByIdOrOrderNumber(orderNumber);
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
