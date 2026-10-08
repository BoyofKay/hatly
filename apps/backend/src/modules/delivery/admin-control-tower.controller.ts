import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { PermissionsService } from '../permissions/permissions.service';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { AdminControlTowerService } from './admin-control-tower.service';
import { DriversService } from './drivers.service';
import { ControlTowerDeliveriesQueryDto } from './dto/control-tower-deliveries-query.dto';

const DEFAULT_LIMIT = 25;

/**
 * Admin Control Tower — read-only operational views. Viewing needs VIEW_ORDERS (the existing order-visibility permission);
 * acting stays on the existing endpoints and their own permissions (assign/reassign: ASSIGN_REASSIGN_ORDERS, failed
 * deliveries: MANAGE_ORDER_ISSUES). Driver data is shown only to callers who may already see drivers.
 */
@ApiTags('admin-control-tower')
@Controller('admin/control-tower')
export class AdminControlTowerController {
  constructor(
    private readonly controlTowerService: AdminControlTowerService,
    private readonly driversService: DriversService,
    private readonly permissionsService: PermissionsService,
  ) {}

  @Get('summary')
  @RequiresPermission(Permission.VIEW_ORDERS)
  async summary(@CurrentUser() user: AuthenticatedUser) {
    const includeDrivers =
      (await this.permissionsService.actorHolds(user, Permission.MANAGE_DRIVERS)) ||
      (await this.permissionsService.actorHolds(user, Permission.ASSIGN_REASSIGN_ORDERS));
    return { data: await this.controlTowerService.summary({ includeDrivers }) };
  }

  @Get('deliveries')
  @RequiresPermission(Permission.VIEW_ORDERS)
  async deliveries(@Query() query: ControlTowerDeliveriesQueryDto) {
    const result = await this.controlTowerService.listDeliveries({
      stage: query.stage ?? 'ALL',
      search: query.search,
      driverId: query.driverId,
      releasedOnly: query.releasedOnly,
      page: query.page ?? 1,
      limit: query.limit ?? DEFAULT_LIMIT,
    });
    return { data: result.data, meta: { page: result.page, limit: result.limit, total: result.total } };
  }

  /**
   * The dispatcher's driver picker: APPROVED drivers with online/available state, vehicle and the order they are on.
   * Needs ASSIGN_REASSIGN_ORDERS (the permission of the actions it serves) — before this, the Dispatch page loaded drivers
   * from `GET admin/drivers` (MANAGE_DRIVERS), so a dispatcher without MANAGE_DRIVERS could not use the page at all.
   */
  @Get('drivers')
  @RequiresPermission(Permission.ASSIGN_REASSIGN_ORDERS)
  async drivers() {
    return { data: await this.driversService.listAll({ approvedOnly: true }) };
  }
}
