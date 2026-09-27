import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { AdminOrdersService } from './admin-orders.service';

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
  constructor(private readonly adminOrdersService: AdminOrdersService) {}

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
}
