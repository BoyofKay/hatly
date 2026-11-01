import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { NotificationOutboxService } from './outbox/notification-outbox.service';

/**
 * Read-only view of the notification outbox for Operations: how many deliveries are waiting / failed / dead / skipped (and why), and which
 * providers are actually configured. It shows delivery STATES only — SENT means "accepted by the provider"; there is no delivered or
 * opened state because push cannot evidence one. No message text, recipient name or token is exposed.
 */
@ApiTags('admin-notification-outbox')
@Controller('admin/notification-outbox')
export class AdminNotificationOutboxController {
  constructor(private readonly outbox: NotificationOutboxService) {}

  @Get('summary')
  @RequiresPermission(Permission.VIEW_SYSTEM_HEALTH)
  async summary() {
    return { data: await this.outbox.summary() };
  }

  @Get()
  @RequiresPermission(Permission.VIEW_SYSTEM_HEALTH)
  async list(@Query() q: { status?: string; page?: string; limit?: string }) {
    const r = await this.outbox.list(q);
    return { data: r.items, meta: { page: r.page, limit: r.limit, total: r.total } };
  }
}
