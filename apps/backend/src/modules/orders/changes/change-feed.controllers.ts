import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequiresPermission } from '../../permissions/decorators/requires-permission.decorator';
import { Permission } from '../../permissions/permission.enum';
import { VendorStaffAuthorizationService } from '../../vendors/vendor-staff-authorization.service';
import { ChangeEntity, ChangeFeedService } from './change-feed.service';

/**
 * D-72 for the Vendor app: "what changed in MY orders since my cursor". Without `since` it only returns a starting cursor (call it BEFORE
 * loading the list). Only events of branches the caller is linked to are ever returned. The answer is a few ids, so an unchanged feed is a
 * tiny response (and 304 with If-None-Match). The existing `GET vendor/orders` list stays the fallback: clients reload it on `reset`, on
 * error, and on a slow timer.
 * Declared before VendorOrdersController so `changes` is not read as an order id.
 */
@ApiTags('vendor-orders')
@Controller('vendor/orders')
@UseGuards(RolesGuard)
@Roles(Role.VENDOR, Role.VENDOR_MANAGER)
export class VendorChangesController {
  constructor(private readonly feed: ChangeFeedService, private readonly vendorAuth: VendorStaffAuthorizationService) {}

  @Get('changes')
  @Throttle({ default: { limit: 90, ttl: 60_000 } })
  async changes(@CurrentUser() user: AuthenticatedUser, @Query() q: { since?: string; limit?: string }) {
    const branchIds = await this.vendorAuth.getOwnedBranchIds(user.id);
    return { data: await this.feed.changes({ entities: ['SEGMENT', 'EXCEPTION'], branchIds }, q) };
  }
}

/** D-72 for the dashboard: changes of orders and/or exceptions. Needs the order-viewing permission (the same one the lists need). */
@ApiTags('admin-changes')
@Controller('admin/changes')
export class AdminChangesController {
  constructor(private readonly feed: ChangeFeedService) {}

  @Get()
  @RequiresPermission(Permission.VIEW_ORDERS)
  @Throttle({ default: { limit: 90, ttl: 60_000 } })
  async changes(@Query() q: { since?: string; limit?: string; topics?: string }) {
    const topics = (q.topics ?? 'orders,exceptions').split(',').map((t) => t.trim()).filter(Boolean);
    if (topics.some((t) => t !== 'orders' && t !== 'exceptions')) throw new BadRequestException({ message: 'Unknown topic.', details: { code: 'VALIDATION_FAILED' } });
    const entities: ChangeEntity[] = [...(topics.includes('orders') ? (['ORDER', 'SEGMENT'] as const) : []), ...(topics.includes('exceptions') ? (['EXCEPTION'] as const) : [])];
    return { data: await this.feed.changes({ entities, branchIds: null }, q) };
  }
}
