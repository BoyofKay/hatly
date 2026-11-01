import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RequiresPermission } from '../../permissions/decorators/requires-permission.decorator';
import { Permission } from '../../permissions/permission.enum';
import { PermissionsService } from '../../permissions/permissions.service';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AdminAuditAction, AdminAuditService } from '../../audit/admin-audit.service';
import { ExplicitlyAudited } from '../../audit/admin-mutation-audit.interceptor';
import { AdminOrdersService } from '../../orders/admin-orders.service';
import { AdminCustomersExtService } from './admin-customers-ext.service';

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

function idempotencyKey(key: string | undefined): string {
  if (!key || key.length < 8 || key.length > 128) {
    throw new BadRequestException({ message: 'An Idempotency-Key header (8–128 characters) is required for this request.', details: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
  }
  return key;
}

/** Customer 360 additions, wallet adjustments (two-person control), review moderation. */
@ApiTags('admin-customers')
@Controller('admin')
export class AdminCustomersExtController {
  constructor(
    private readonly ext: AdminCustomersExtService,
    private readonly orders: AdminOrdersService,
    private readonly permissions: PermissionsService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get(`customers/:id(${UUID})/summary`)
  @RequiresPermission(Permission.VIEW_CUSTOMERS)
  async summary(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.ext.summary(id, await this.permissions.actorHolds(actor, Permission.VIEW_FINANCIALS)) };
  }

  @Get(`customers/:id(${UUID})/orders`)
  @RequiresPermission(Permission.VIEW_CUSTOMERS, Permission.VIEW_ORDERS)
  async customerOrders(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    const result = await this.orders.search({ customerId: id, page: Number(page) || 1, limit: Math.min(Number(limit) || 20, 50) });
    const pii = await this.permissions.actorHolds(actor, Permission.VIEW_CUSTOMER_PII);
    return { data: result.data.map((o) => ({ ...o, customer: o.customer && !pii ? { ...o.customer, phone: null, fullName: null } : o.customer })), meta: { page: result.page, limit: result.limit, total: result.total } };
  }

  @Get(`customers/:id(${UUID})/wallet`)
  @RequiresPermission(Permission.VIEW_CUSTOMERS, Permission.VIEW_FINANCIALS)
  async wallet(@Param('id') id: string, @Query() q: Record<string, string>) {
    const r = await this.ext.walletLedger(id, q);
    return { data: r, meta: { page: r.page, limit: r.limit, total: r.total } };
  }

  @Get(`customers/:id(${UUID})/loyalty`)
  @RequiresPermission(Permission.VIEW_CUSTOMERS)
  async loyalty(@Param('id') id: string, @Query() q: Record<string, string>) {
    return { data: await this.ext.loyalty(id, q) };
  }

  @Get(`customers/:id(${UUID})/addresses`)
  @RequiresPermission(Permission.VIEW_CUSTOMERS)
  async addresses(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.ext.addresses(id, await this.permissions.actorHolds(actor, Permission.VIEW_CUSTOMER_PII)) };
  }

  @Get(`customers/:id(${UUID})/ratings`)
  @RequiresPermission(Permission.VIEW_CUSTOMERS)
  async ratings(@Param('id') id: string) {
    return { data: await this.ext.ratingsOf(id) };
  }

  @Get(`customers/:id(${UUID})/coupons`)
  @RequiresPermission(Permission.VIEW_CUSTOMERS)
  async coupons(@Param('id') id: string) {
    return { data: await this.ext.couponsOf(id) };
  }

  @Get(`customers/:id(${UUID})/notes`)
  @RequiresPermission(Permission.VIEW_CUSTOMERS)
  async notes(@Param('id') id: string) {
    return { data: await this.ext.notes(id) };
  }

  @Post(`customers/:id(${UUID})/notes`)
  @RequiresPermission(Permission.MANAGE_CUSTOMERS)
  @ExplicitlyAudited()
  async addNote(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: { body: string }) {
    const data = await this.ext.addNote(id, body?.body, actor.id);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.CUSTOMER_NOTE_ADDED, targetType: 'customer', targetId: id, metadata: { noteId: data.id } });
    return { data };
  }

  @Post(`customers/:id(${UUID})/block`)
  @RequiresPermission(Permission.MANAGE_CUSTOMERS)
  @ExplicitlyAudited()
  async block(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: { reason: string }) {
    const data = await this.ext.setBlocked(id, true, body?.reason);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.CUSTOMER_BLOCKED, targetType: 'customer', targetId: id, metadata: { reason: body.reason, changed: data.changed } });
    return { data };
  }

  @Post(`customers/:id(${UUID})/unblock`)
  @RequiresPermission(Permission.MANAGE_CUSTOMERS)
  @ExplicitlyAudited()
  async unblock(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: { reason: string }) {
    const data = await this.ext.setBlocked(id, false, body?.reason);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.CUSTOMER_UNBLOCKED, targetType: 'customer', targetId: id, metadata: { reason: body.reason, changed: data.changed } });
    return { data };
  }

  /** Every reveal of a masked field is audited (who, which customer, which field) — never the value itself. */
  @Post(`customers/:id(${UUID})/reveal`)
  @RequiresPermission(Permission.VIEW_CUSTOMER_PII)
  @ExplicitlyAudited()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async reveal(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: { field: string }) {
    const data = await this.ext.reveal(id, body?.field);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.PII_REVEALED, targetType: 'customer', targetId: id, metadata: { field: data.field } });
    return { data: { ...data, expiresInSeconds: 60 } };
  }

  // ---- wallet adjustments ----

  @Post(`customers/:id(${UUID})/wallet/adjustments`)
  @RequiresPermission(Permission.MANAGE_CUSTOMER_WALLET)
  @ExplicitlyAudited()
  async requestAdjustment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: { amountMinor: number; reasonCode: string; note?: string },
  ) {
    const result = await this.ext.requestAdjustment(id, body ?? ({} as never), actor, idempotencyKey(key));
    if (!result.replayed) {
      await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.WALLET_ADJUSTMENT_REQUESTED, targetType: 'customer', targetId: id, metadata: { adjustmentId: result.adjustment.id, amountMinor: result.adjustment.amountMinor, reasonCode: result.adjustment.reasonCode, status: result.adjustment.status } });
      if (result.adjustment.status === 'APPLIED') {
        await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.WALLET_ADJUSTMENT_APPLIED, targetType: 'customer', targetId: id, metadata: { adjustmentId: result.adjustment.id, amountMinor: result.adjustment.amountMinor } });
      }
    }
    return { data: result };
  }

  @Get('wallet-adjustments')
  @RequiresPermission(Permission.VIEW_FINANCIALS)
  async adjustments(@Query() q: Record<string, string>) {
    const r = await this.ext.listAdjustments(q);
    return { data: r.items, meta: { page: r.page, limit: r.limit, total: r.total } };
  }

  @Post(`wallet-adjustments/:id(${UUID})/approve`)
  @RequiresPermission(Permission.WALLET_ADJUST_APPROVE)
  @ExplicitlyAudited()
  async approve(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: { note?: string }) {
    const r = await this.ext.decideAdjustment(id, 'APPROVE', actor, body?.note);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.WALLET_ADJUSTMENT_APPLIED, targetType: 'customer', targetId: r.adjustment.customerId, metadata: { adjustmentId: id, amountMinor: r.adjustment.amountMinor } });
    return { data: r };
  }

  @Post(`wallet-adjustments/:id(${UUID})/reject`)
  @RequiresPermission(Permission.WALLET_ADJUST_APPROVE)
  @ExplicitlyAudited()
  async reject(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: { note?: string }) {
    const r = await this.ext.decideAdjustment(id, 'REJECT', actor, body?.note);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.WALLET_ADJUSTMENT_REJECTED, targetType: 'customer', targetId: r.adjustment.customerId, metadata: { adjustmentId: id } });
    return { data: r };
  }

  // ---- ratings moderation ----

  @Get('ratings')
  @RequiresPermission(Permission.MODERATE_REVIEWS)
  async listRatings(@Query() q: Record<string, string>) {
    const r = await this.ext.listRatings(q);
    return { data: r.items, meta: { page: r.page, limit: r.limit, total: r.total } };
  }

  @Post('ratings/:target/:id/hide')
  @RequiresPermission(Permission.MODERATE_REVIEWS)
  @ExplicitlyAudited()
  async hide(@CurrentUser() actor: AuthenticatedUser, @Param('target') target: string, @Param('id') id: string, @Body() body: { reason: string }) {
    const data = await this.ext.setRatingHidden(target, id, true, body?.reason, actor.id);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.RATING_HIDDEN, targetType: `${target}_rating`, targetId: id, metadata: { reason: body.reason } });
    return { data };
  }

  @Post('ratings/:target/:id/unhide')
  @RequiresPermission(Permission.MODERATE_REVIEWS)
  @ExplicitlyAudited()
  async unhide(@CurrentUser() actor: AuthenticatedUser, @Param('target') target: string, @Param('id') id: string) {
    const data = await this.ext.setRatingHidden(target, id, false, undefined, actor.id);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.RATING_UNHIDDEN, targetType: `${target}_rating`, targetId: id });
    return { data };
  }
}
