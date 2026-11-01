import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { StaffAlertsService } from './staff-alerts.service';

/**
 * The in-app inbox of Operations and vendor staff. Every query is scoped to the authenticated caller (never a client-supplied user id);
 * an Operations employee needs the order-viewing permission, a vendor user only sees alerts of the branches they are linked to.
 * These handlers change only the caller's own inbox state; for an ADMIN the generic admin-mutation audit still records them (field names only),
 * exactly like every other privileged write.
 */
@ApiTags('staff-notifications')
@Controller('staff/notifications')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.VENDOR, Role.VENDOR_MANAGER)
export class StaffNotificationsController {
  constructor(private readonly alerts: StaffAlertsService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query() q: { page?: string; limit?: string; unread?: string }) {
    const r = await this.alerts.list(user, q);
    return { data: r.items, meta: { page: r.page, limit: r.limit, total: r.total, unreadCount: r.unreadCount } };
  }

  @Get('unread-count')
  async unread(@CurrentUser() user: AuthenticatedUser) {
    return { data: { unreadCount: await this.alerts.unreadCount(user) } };
  }

  @Get('preferences')
  async preferences(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.alerts.preferences(user) };
  }

  @Put('preferences')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async setPreference(@CurrentUser() user: AuthenticatedUser, @Body() body: { category: string; channel: string; enabled: boolean }) {
    return { data: await this.alerts.setPreference(user, body) };
  }

  @Post('read-all')
  async readAll(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.alerts.markAllRead(user) };
  }

  @Post(':id/read')
  async read(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.alerts.markRead(user, id) };
  }
}
