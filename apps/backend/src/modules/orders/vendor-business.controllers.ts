import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { VendorBusinessService } from './vendor-business.service';

/** Declared before VendorOrdersController so `history` is not read as an order id. Paginated, searchable order history of the caller's own branches. */
@ApiTags('vendor-business')
@Controller('vendor/orders')
@UseGuards(RolesGuard)
@Roles(Role.VENDOR, Role.VENDOR_MANAGER)
export class VendorOrderHistoryController {
  constructor(private readonly business: VendorBusinessService) {}

  @Get('history')
  async history(@CurrentUser() user: AuthenticatedUser, @Query() q: Record<string, string>) {
    const r = await this.business.history(user, q);
    return { data: r.items, meta: { page: r.page, limit: r.limit, total: r.total } };
  }
}

/** The Vendor Business Hub (overview, insights, earnings statement, team). Read-only; everything is scoped to the caller's own branches. */
@ApiTags('vendor-business')
@Controller('vendor')
@UseGuards(RolesGuard)
@Roles(Role.VENDOR, Role.VENDOR_MANAGER)
export class VendorBusinessController {
  constructor(private readonly business: VendorBusinessService) {}

  @Get('overview')
  async overview(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.business.overview(user) };
  }

  @Get('insights')
  async insights(@CurrentUser() user: AuthenticatedUser, @Query() q: { from?: string; to?: string; branchId?: string }) {
    return { data: await this.business.insights(user, q) };
  }

  @Get('earnings')
  async earnings(@CurrentUser() user: AuthenticatedUser, @Query() q: Record<string, string>) {
    const r = await this.business.earnings(user, q);
    return { data: { totals: r.totals, items: r.items, settlements: r.settlements }, meta: { page: r.page, limit: r.limit, total: r.total } };
  }

  @Get('team')
  async team(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.business.team(user) };
  }
}

/** A branch's own profile for its staff: open/closed (anyone linked), weekly hours and preparation time (managers). Another vendor's branch is a 404. */
@ApiTags('vendor-branches')
@Controller('vendor/branches')
@UseGuards(RolesGuard)
@Roles(Role.VENDOR, Role.VENDOR_MANAGER)
export class VendorBranchProfileController {
  constructor(private readonly business: VendorBusinessService) {}

  @Get(':branchId')
  async one(@CurrentUser() user: AuthenticatedUser, @Param('branchId') branchId: string) {
    return { data: await this.business.branch(user, branchId) };
  }

  @Patch(':branchId')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async update(@CurrentUser() user: AuthenticatedUser, @Param('branchId') branchId: string, @Body() body: { isOpen?: boolean; openingHours?: Record<string, { open: string; close: string }>; preparationTimeMinutes?: number | null }) {
    return { data: await this.business.updateBranch(user, branchId, body) };
  }
}
