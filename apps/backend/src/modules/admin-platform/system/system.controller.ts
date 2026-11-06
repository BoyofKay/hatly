import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, BadRequestException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { Public } from '../../../common/decorators/public.decorator';
import { RequiresAnyPermission, RequiresPermission } from '../../permissions/decorators/requires-permission.decorator';
import { Permission } from '../../permissions/permission.enum';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AdminAuditAction, AdminAuditService } from '../../audit/admin-audit.service';
import { ExplicitlyAudited } from '../../audit/admin-mutation-audit.interceptor';
import { BusinessConfigService } from '../../business-config/business-config.service';
import { BusinessConfigKey } from '../../business-config/business-config-key.enum';
import { MetricsRecorder, SystemService } from './system.service';
import { pageParams } from '../common/platform-sql';

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

@ApiTags('admin-system')
@Controller('admin/system')
export class SystemController {
  constructor(
    private readonly system: SystemService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get('overview')
  @RequiresPermission(Permission.VIEW_SYSTEM_HEALTH)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async overview() {
    return { data: await this.system.overview(true) };
  }

  @Get('integrations/:key/history')
  @RequiresPermission(Permission.VIEW_SYSTEM_HEALTH)
  async history(@Param('key') key: string) {
    return { data: await this.system.history(key) };
  }

  @Post('check')
  @RequiresPermission(Permission.MANAGE_SYSTEM_JOBS)
  @ExplicitlyAudited()
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async check(@CurrentUser() actor: AuthenticatedUser) {
    const data = await this.system.overview(true);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.INTEGRATION_CHECK_RUN, targetType: 'system', metadata: { overall: data.overall } });
    return { data };
  }

  @Get('metrics/requests')
  @RequiresPermission(Permission.VIEW_SYSTEM_HEALTH)
  async requests(@Query('hours') hours?: string) {
    return { data: await this.system.requests(Number(hours) || 24) };
  }

  @Get('metrics/database-cache')
  @RequiresPermission(Permission.VIEW_SYSTEM_HEALTH)
  async databaseCache() {
    return { data: await this.system.databaseAndCache() };
  }

  @Get('metrics/client')
  @RequiresPermission(Permission.VIEW_SYSTEM_HEALTH)
  async client(@Query() q: Record<string, string>) {
    return { data: await this.system.clientMetrics(q) };
  }

  @Get('jobs')
  @RequiresPermission(Permission.VIEW_SYSTEM_HEALTH)
  async jobs(@Query() q: Record<string, string>) {
    const r = await this.system.jobs(q);
    return { data: r.items, meta: { page: r.page, limit: r.limit, total: r.total } };
  }

  @Post(`jobs/:id(${UUID})/retry`)
  @RequiresPermission(Permission.MANAGE_SYSTEM_JOBS)
  @ExplicitlyAudited()
  async retry(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    const data = await this.system.retryJob(id);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.BULK_ACTION, targetType: 'job', targetId: id, metadata: { action: 'retry' } });
    return { data };
  }
}

/** Client telemetry ingestion: public, throttled, size-limited, whitelisted keys, no identifiers; debug builds are tagged and excluded from every view. */
@ApiTags('telemetry')
@Controller()
export class TelemetryController {
  constructor(
    private readonly system: SystemService,
    private readonly recorder: MetricsRecorder,
  ) {}

  @Post('telemetry/client-metrics')
  @Public()
  @HttpCode(202)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async ingest(@Body() body: unknown) {
    if (JSON.stringify(body ?? {}).length > 4096) throw new BadRequestException({ message: 'Payload too large.', details: { code: 'VALIDATION_FAILED' } });
    return { data: await this.system.ingestClient(body, this.recorder) };
  }

  @Get('config/client')
  @Public()
  clientConfig() {
    return { data: { telemetrySampleRate: Number(process.env.CLIENT_TELEMETRY_SAMPLE_RATE ?? 0.1) } };
  }
}

/** Platform configuration: overview of every setting, who changed it (never the values), and the dedicated Automatic Dispatch control (B3). */
@ApiTags('admin-config')
@Controller('admin')
export class ConfigOverviewController {
  constructor(
    private readonly ds: DataSource,
    private readonly config: BusinessConfigService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get('config/overview')
  @RequiresAnyPermission(Permission.CONFIG_VIEW, Permission.MANAGE_BUSINESS_CONFIG)
  async overview() {
    const rows = await this.ds.query(`SELECT key, updated_at, description FROM business_config`);
    const byKey = new Map(rows.map((r: any) => [r.key, r]));
    const last = await this.ds.query(`SELECT DISTINCT ON (target_id) target_id, created_at, actor_user_id FROM admin_audit_logs WHERE action = 'business_config.changed' ORDER BY target_id, created_at DESC`);
    const lastBy = new Map(last.map((r: any) => [r.target_id, r]));
    return {
      data: Object.values(BusinessConfigKey).map((key) => {
        const r: any = byKey.get(key);
        const l: any = lastBy.get(key);
        return { key, isSet: Boolean(r), description: r?.description ?? null, updatedAt: r?.updated_at ?? null, lastChangeAt: l?.created_at ?? null };
      }),
    };
  }

  @Get('config/:key/history')
  @RequiresAnyPermission(Permission.CONFIG_VIEW, Permission.MANAGE_BUSINESS_CONFIG)
  async history(@Param('key') key: string) {
    const rows = await this.ds.query(`SELECT a.created_at, a.actor_role, u.full_name FROM admin_audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id WHERE a.action = 'business_config.changed' AND a.target_id = $1 ORDER BY a.created_at DESC LIMIT 50`, [key.slice(0, 120)]);
    return { data: rows.map((r: any) => ({ at: new Date(r.created_at).toISOString(), by: r.full_name, role: r.actor_role })), meta: { note: 'The values themselves are never recorded (a setting may hold a payment destination).' } };
  }

  /** The single, obvious switch for automatic dispatch. ON: eligible drivers are assigned automatically. OFF: assignment stops and admins assign/reassign manually. Existing orders and assignments are untouched either way (R13: switching never releases or reassigns; drivers acknowledge within the configured window in both modes, R16). */
  @Get('dispatch/automation')
  @RequiresAnyPermission(Permission.ASSIGN_REASSIGN_ORDERS, Permission.OVERRIDE_DISPATCH, Permission.MANAGE_BUSINESS_CONFIG)
  async automation() {
    const [open] = await this.ds.query(`SELECT count(*)::int AS n FROM dispatch_alerts WHERE resolved_at IS NULL AND deleted_at IS NULL AND reason = 'AUTO_ASSIGN_DISABLED'`);
    return { data: { enabled: await this.config.isAutomaticDispatchEnabled(), openAutoAssignDisabledAlerts: open.n } };
  }

  @Put('dispatch/automation')
  @RequiresAnyPermission(Permission.OVERRIDE_DISPATCH, Permission.MANAGE_BUSINESS_CONFIG)
  @ExplicitlyAudited()
  async setAutomation(@CurrentUser() actor: AuthenticatedUser, @Body() body: { enabled: boolean }) {
    if (typeof body?.enabled !== 'boolean') throw new BadRequestException({ message: 'enabled must be true or false.', details: { code: 'VALIDATION_FAILED' } });
    const before = await this.config.isAutomaticDispatchEnabled();
    await this.config.set(BusinessConfigKey.AUTOMATIC_DISPATCH_ENABLED, body.enabled, actor.id, 'Automatic dispatch (Admin control)');
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.DISPATCH_AUTOMATION_CHANGED, targetType: 'business_config', targetId: BusinessConfigKey.AUTOMATIC_DISPATCH_ENABLED, metadata: { from: before, to: body.enabled } });
    return { data: { enabled: body.enabled, previous: before } };
  }
}
