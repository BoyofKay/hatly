import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
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
  constructor(private readonly adminCustomersService: AdminCustomersService) {}

  @Get()
  @RequiresPermission(Permission.VIEW_CUSTOMERS)
  async search(@Query() query: SearchAdminCustomersQueryDto) {
    const result = await this.adminCustomersService.search(query);
    return { data: result.data, meta: { page: result.page, limit: result.limit, total: result.total } };
  }

  // UUID-shaped segment constraint — same reason AdminOrdersController's own `:id` route documents
  // (a non-UUID segment falls through rather than crashing with an "invalid input syntax" 500).
  @Get(':id([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})')
  @RequiresPermission(Permission.VIEW_CUSTOMERS)
  async getOne(@Param('id') id: string) {
    const data = await this.adminCustomersService.getOne(id);
    return { data };
  }
}
