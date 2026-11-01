import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresAnyPermission, RequiresPermission } from '../../permissions/decorators/requires-permission.decorator';
import { Permission } from '../../permissions/permission.enum';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AdminAuditAction, AdminAuditService } from '../../audit/admin-audit.service';
import { ExplicitlyAudited } from '../../audit/admin-mutation-audit.interceptor';
import { MarketingService } from './marketing.service';

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const VIEW = [Permission.MARKETING_VIEW, Permission.MANAGE_OFFERS, Permission.MANAGE_CAMPAIGNS, Permission.MANAGE_BROADCASTS] as const;

/** Marketing & growth, broadcasts (inbox + best-effort push), campaigns, offer edit/clone/performance. */
@ApiTags('admin-marketing')
@Controller('admin')
export class MarketingController {
  constructor(
    private readonly marketing: MarketingService,
    private readonly audit: AdminAuditService,
  ) {}

  // ---- growth ----
  @Get('growth/overview')
  @RequiresAnyPermission(Permission.MARKETING_VIEW, Permission.MANAGE_BROADCASTS, Permission.MANAGE_CAMPAIGNS)
  async growth(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.marketing.growth(from, to) };
  }

  @Get('growth/retention')
  @RequiresAnyPermission(Permission.MARKETING_VIEW, Permission.MANAGE_BROADCASTS, Permission.MANAGE_CAMPAIGNS)
  async retention(@Query('months') months?: string) {
    return { data: await this.marketing.retention(Number(months) || 6) };
  }

  // ---- audiences ----
  @Get('audiences')
  @RequiresAnyPermission(...VIEW)
  async audiences() {
    return { data: await this.marketing.listAudiences() };
  }

  @Post('audiences')
  @RequiresPermission(Permission.MANAGE_BROADCASTS)
  async createAudience(@CurrentUser() actor: AuthenticatedUser, @Body() body: { name: string; rules: any }) {
    return { data: await this.marketing.createAudience(body, actor.id) };
  }

  @Post('audiences/preview')
  @RequiresPermission(Permission.MANAGE_BROADCASTS)
  @HttpCode(200)
  async previewAudience(@Body() body: { rules: any }) {
    return { data: await this.marketing.previewAudience(body?.rules ?? {}) };
  }

  // ---- broadcasts ----
  @Get('broadcasts')
  @RequiresAnyPermission(...VIEW)
  async broadcasts(@Query() q: Record<string, string>) {
    const r = await this.marketing.listBroadcasts(q);
    return { data: r.items, meta: { page: r.page, limit: r.limit, total: r.total } };
  }

  @Post('broadcasts')
  @RequiresPermission(Permission.MANAGE_BROADCASTS)
  async createBroadcast(@CurrentUser() actor: AuthenticatedUser, @Body() body: any) {
    return { data: await this.marketing.createBroadcast(body, actor.id) };
  }

  @Get(`broadcasts/:id(${UUID})`)
  @RequiresAnyPermission(...VIEW)
  async broadcast(@Param('id') id: string) {
    return { data: await this.marketing.getBroadcast(id) };
  }

  @Patch(`broadcasts/:id(${UUID})`)
  @RequiresPermission(Permission.MANAGE_BROADCASTS)
  async updateBroadcast(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: any) {
    return { data: await this.marketing.updateBroadcast(id, body ?? {}, actor.id) };
  }

  private async bt(actor: AuthenticatedUser, id: string, to: string) {
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.BROADCAST_TRANSITION, targetType: 'broadcast', targetId: id, metadata: { to } });
  }

  @Post(`broadcasts/:id(${UUID})/submit`)
  @RequiresPermission(Permission.MANAGE_BROADCASTS)
  @ExplicitlyAudited()
  async submitBroadcast(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    const data = await this.marketing.submitBroadcast(id);
    await this.bt(actor, id, 'PENDING_APPROVAL');
    return { data };
  }

  @Post(`broadcasts/:id(${UUID})/approve`)
  @RequiresPermission(Permission.BROADCAST_APPROVE)
  @ExplicitlyAudited()
  async approveBroadcast(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: { overrideQuietHours?: boolean }) {
    const data = await this.marketing.approveBroadcast(id, actor.id, Boolean(body?.overrideQuietHours));
    await this.bt(actor, id, data.status);
    return { data };
  }

  @Post(`broadcasts/:id(${UUID})/reject`)
  @RequiresPermission(Permission.BROADCAST_APPROVE)
  @ExplicitlyAudited()
  async rejectBroadcast(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: { reason: string }) {
    const data = await this.marketing.rejectBroadcast(id, body?.reason, actor.id);
    await this.bt(actor, id, 'DRAFT');
    return { data };
  }

  @Post(`broadcasts/:id(${UUID})/cancel`)
  @RequiresPermission(Permission.MANAGE_BROADCASTS)
  @ExplicitlyAudited()
  async cancelBroadcast(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    const data = await this.marketing.cancelBroadcast(id);
    await this.bt(actor, id, 'CANCELLED');
    return { data };
  }

  @Get(`broadcasts/:id(${UUID})/recipients`)
  @RequiresAnyPermission(...VIEW)
  async recipients(@Param('id') id: string, @Query() q: Record<string, string>) {
    const r = await this.marketing.recipients(id, q);
    return { data: r.items, meta: { page: r.page, limit: r.limit, total: r.total } };
  }

  // ---- offers ----
  @Patch(`offers/:id(${UUID})`)
  @RequiresPermission(Permission.MANAGE_OFFERS)
  @ExplicitlyAudited()
  async editOffer(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const data = await this.marketing.editOffer(id, body ?? {}, actor.id);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.OFFER_UPDATED, targetType: 'offer', targetId: id, metadata: { fields: Object.keys(body ?? {}).join(',') } });
    return { data };
  }

  @Post(`offers/:id(${UUID})/clone`)
  @RequiresPermission(Permission.MANAGE_OFFERS)
  @ExplicitlyAudited()
  async cloneOffer(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: { name?: string; couponCode?: string | null }) {
    const data = await this.marketing.cloneOffer(id, body ?? {}, actor.id);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.OFFER_CLONED, targetType: 'offer', targetId: id, metadata: { cloneId: data.id } });
    return { data };
  }

  @Get(`offers/:id(${UUID})/performance`)
  @RequiresAnyPermission(Permission.MARKETING_VIEW, Permission.MANAGE_OFFERS)
  async offerPerformance(@Param('id') id: string) {
    return { data: await this.marketing.offerPerformance(id) };
  }

  @Get(`offers/:id(${UUID})/consumptions`)
  @RequiresAnyPermission(Permission.MARKETING_VIEW, Permission.MANAGE_OFFERS)
  async offerConsumptions(@Param('id') id: string, @Query() q: Record<string, string>) {
    const r = await this.marketing.offerConsumptions(id, q);
    return { data: r.items, meta: { page: r.page, limit: r.limit, total: r.total } };
  }

  // ---- campaigns ----
  @Get('campaigns')
  @RequiresAnyPermission(...VIEW)
  async campaigns(@Query() q: Record<string, string>) {
    const r = await this.marketing.listCampaigns(q);
    return { data: r.items, meta: { page: r.page, limit: r.limit, total: r.total } };
  }

  @Post('campaigns')
  @RequiresPermission(Permission.MANAGE_CAMPAIGNS)
  async createCampaign(@CurrentUser() actor: AuthenticatedUser, @Body() body: any) {
    return { data: await this.marketing.createCampaign(body, actor.id) };
  }

  @Get(`campaigns/:id(${UUID})`)
  @RequiresAnyPermission(...VIEW)
  async campaign(@Param('id') id: string) {
    return { data: await this.marketing.getCampaign(id) };
  }

  @Patch(`campaigns/:id(${UUID})`)
  @RequiresPermission(Permission.MANAGE_CAMPAIGNS)
  async updateCampaign(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: any) {
    return { data: await this.marketing.updateCampaign(id, body ?? {}, actor.id) };
  }

  @Put(`campaigns/:id(${UUID})/items`)
  @RequiresPermission(Permission.MANAGE_CAMPAIGNS)
  async setItems(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: { items: Array<{ type: string; id: string }> }) {
    return { data: await this.marketing.setCampaignItems(id, body?.items ?? [], actor.id) };
  }

  private async ct(actor: AuthenticatedUser, id: string, to: string) {
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.CAMPAIGN_TRANSITION, targetType: 'campaign', targetId: id, metadata: { to } });
  }

  @Post(`campaigns/:id(${UUID})/submit`)
  @RequiresPermission(Permission.MANAGE_CAMPAIGNS)
  @ExplicitlyAudited()
  async submitCampaign(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    const data = await this.marketing.submitCampaign(id, actor.id);
    await this.ct(actor, id, 'PENDING_APPROVAL');
    return { data };
  }

  @Post(`campaigns/:id(${UUID})/approve`)
  @RequiresPermission(Permission.CAMPAIGN_APPROVE)
  @ExplicitlyAudited()
  async approveCampaign(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    const data = await this.marketing.approveCampaign(id, actor.id);
    await this.ct(actor, id, 'SCHEDULED');
    return { data };
  }

  @Post(`campaigns/:id(${UUID})/reject`)
  @RequiresPermission(Permission.CAMPAIGN_APPROVE)
  @ExplicitlyAudited()
  async rejectCampaign(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: { reason: string }) {
    const data = await this.marketing.rejectCampaign(id, body?.reason, actor.id);
    await this.ct(actor, id, 'DRAFT');
    return { data };
  }

  @Post(`campaigns/:id(${UUID})/cancel`)
  @RequiresPermission(Permission.MANAGE_CAMPAIGNS)
  @ExplicitlyAudited()
  async cancelCampaign(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    const data = await this.marketing.cancelCampaign(id, actor.id);
    await this.ct(actor, id, 'CANCELLED');
    return { data };
  }

  @Get(`campaigns/:id(${UUID})/performance`)
  @RequiresAnyPermission(...VIEW)
  async campaignPerformance(@Param('id') id: string) {
    return { data: await this.marketing.campaignPerformance(id) };
  }
}

/** The customer's own inbox (additive API for the Customer app; older app builds simply never call it). */
@ApiTags('customer-inbox')
@Controller('customer/inbox')
@UseGuards(RolesGuard)
@Roles(Role.CUSTOMER)
export class CustomerInboxController {
  constructor(private readonly marketing: MarketingService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query() q: Record<string, string>) {
    const r = await this.marketing.inbox(user.id, q);
    return { data: r.items, meta: { page: r.page, limit: r.limit, total: r.total, unread: r.unread } };
  }

  @Get('unread-count')
  async unread(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.marketing.unread(user.id) };
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.marketing.markRead(user.id, null) };
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.marketing.markRead(user.id, id) };
  }
}
