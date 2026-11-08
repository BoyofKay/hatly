import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CsrfMode } from '../../common/decorators/csrf-mfa.decorators';
import { OpsAlertsService } from './ops-alerts.service';
import { AdminPushService } from './web-push/admin-push.service';

/**
 * Operations alerts (Admin only — PermissionsGuard is global and refuses every non-admin role). Anyone who may view orders sees them;
 * acknowledging — "I have seen it, stop the alarm" — needs the order-fulfilment permission (the people the alarm is for).
 */
@ApiTags('admin-ops-alerts')
@Controller('admin/ops-alerts')
export class AdminOpsAlertsController {
  constructor(private readonly alerts: OpsAlertsService) {}

  @Get()
  @RequiresPermission(Permission.VIEW_ORDERS)
  async list(@Query('state') state?: string) {
    const r = await this.alerts.list(state);
    return { data: r.items, meta: { serverTime: r.serverTime } };
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  @RequiresPermission(Permission.MANAGE_ORDER_FULFILMENT)
  async acknowledge(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return { data: await this.alerts.acknowledge(id, user.id) };
  }
}

/**
 * The caller's own Web Push devices. Every query is scoped to the authenticated admin; a device id of another admin answers 404.
 * The public VAPID key is public by design; the private key never leaves the server.
 */
@ApiTags('admin-push')
@Controller('admin/push')
export class AdminPushController {
  constructor(
    private readonly push: AdminPushService,
    private readonly alerts: OpsAlertsService,
  ) {}

  @Get('config')
  @RequiresPermission(Permission.VIEW_ORDERS)
  async config(@CurrentUser() user: AuthenticatedUser) {
    return { data: { ...this.push.config(), lastAcknowledgedAt: await this.alerts.lastAcknowledgedBy(user.id) } };
  }

  @Get('subscriptions')
  @RequiresPermission(Permission.VIEW_ORDERS)
  async list(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.push.listFor(user.id) };
  }

  /** "Is THIS browser registered for me?" — the endpoint is sent in the body (it is a capability URL; never in a query string). */
  @Post('subscriptions/lookup')
  @HttpCode(200)
  @RequiresPermission(Permission.VIEW_ORDERS)
  async lookup(@CurrentUser() user: AuthenticatedUser, @Body() body: { endpoint?: string }) {
    return { data: typeof body?.endpoint === 'string' ? await this.push.findOwnByEndpoint(user.id, body.endpoint) : null };
  }

  @Post('subscriptions')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequiresPermission(Permission.VIEW_ORDERS)
  async subscribe(@CurrentUser() user: AuthenticatedUser, @Body() body: any, @Req() req: Request) {
    return { data: await this.push.subscribe(user.id, body, req.headers['user-agent']) };
  }

  @Delete('subscriptions/:id')
  @RequiresPermission(Permission.VIEW_ORDERS)
  async unsubscribe(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.push.unsubscribe(user.id, id) };
  }

  @Post('subscriptions/:id/test')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequiresPermission(Permission.VIEW_ORDERS)
  async test(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.push.sendTest(user.id, id) };
  }

  @Get('deliveries/:id')
  @RequiresPermission(Permission.VIEW_ORDERS)
  async delivery(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.push.deliveryFor(user.id, id) };
  }

  @Get('stats')
  @RequiresPermission(Permission.VIEW_ORDERS)
  async stats() {
    return { data: await this.push.stats() };
  }
}

/**
 * Receipts from a device's service worker ("this message was displayed / clicked"). A service worker has no session, so the proof is the
 * one-time random token carried inside that encrypted push message (stored only hashed). It can only mark that one delivery; it reveals
 * nothing (unknown ids, wrong tokens and bad input all answer the same 404).
 */
@ApiTags('push-receipts')
@Controller('push-receipts')
export class PushReceiptsController {
  constructor(private readonly push: AdminPushService) {}

  @Post()
  @Public()
  @CsrfMode('skip')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async receipt(@Body() body: { deliveryId?: string; token?: string; event?: string }) {
    return { data: await this.push.receipt(body) };
  }
}
