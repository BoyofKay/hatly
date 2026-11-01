import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { PermissionsService } from '../permissions/permissions.service';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { maskName, maskPhone } from '../admin-platform/common/platform-sql';
import { AdminCustomersService } from './admin-customers.service';
import { SearchAdminCustomersQueryDto } from './dto/search-admin-customers-query.dto';

/**
 * M3c (Launch-Readiness Gap Audit, G-10) — Admin Customer Management.
 * Read-only, gated by the new, dedicated `VIEW_CUSTOMERS` permission
 * (never `MANAGE_CUSTOMER_WALLET`) — same shape as
 * `AdminOrdersController`. No `@UseGuards` needed — `PermissionsGuard`
 * is global, same as every other Admin controller in this codebase.
 */
@ApiTags('admin-customers')
@Controller('admin/customers')
export class AdminCustomersController {
  constructor(
    private readonly adminCustomersService: AdminCustomersService,
    private readonly permissionsService: PermissionsService,
  ) {}

  private mask<T extends { fullName?: string | null; phone?: string | null }>(row: T): T {
    return { ...row, fullName: maskName(row.fullName ?? null), phone: maskPhone(row.phone ?? null) };
  }

  @Get()
  @RequiresPermission(Permission.VIEW_CUSTOMERS)
  async search(@CurrentUser() user: AuthenticatedUser, @Query() query: SearchAdminCustomersQueryDto) {
    const result = await this.adminCustomersService.search(query);
    const pii = await this.permissionsService.actorHolds(user, Permission.VIEW_CUSTOMER_PII);
    return { data: pii ? result.data : result.data.map((row) => this.mask(row)), meta: { page: result.page, limit: result.limit, total: result.total } };
  }

  // UUID-shaped segment constraint — same reason AdminOrdersController's own `:id` route documents
  // (a non-UUID segment falls through rather than crashing with an "invalid input syntax" 500).
  @Get(':id([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})')
  @RequiresPermission(Permission.VIEW_CUSTOMERS)
  async getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const detail = await this.adminCustomersService.getOne(id);
    const pii = await this.permissionsService.actorHolds(user, Permission.VIEW_CUSTOMER_PII);
    const data = pii
      ? detail
      : {
          ...this.mask(detail),
          address: detail.address ? { ...detail.address, line1: '••••' } : null,
          recentOrders: detail.recentOrders.map((o) => (o.customer ? { ...o, customer: { ...o.customer, fullName: maskName(o.customer.fullName), phone: maskPhone(o.customer.phone) } } : o)),
        };
    return { data };
  }
}
