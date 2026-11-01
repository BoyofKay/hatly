import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'fs';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RequiresPermission } from '../../permissions/decorators/requires-permission.decorator';
import { Permission } from '../../permissions/permission.enum';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AdminAuditAction, AdminAuditService } from '../../audit/admin-audit.service';
import { ExplicitlyAudited } from '../../audit/admin-mutation-audit.interceptor';
import { ReportsService } from './reports.service';

/**
 * Reports & exports. The route guard only requires an admin with VIEW_REPORTS (SUPER_ADMIN-only reports aside): the PER-REPORT permissions
 * (family view permission, money permission, PII, export permission) are evaluated by ReportsService for the specific report, at request
 * time AND again at download time.
 */
@ApiTags('admin-reports')
@Controller('admin')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get('reports')
  @RequiresPermission(Permission.VIEW_REPORTS)
  async catalogue(@CurrentUser() actor: AuthenticatedUser) {
    return { data: await this.reports.catalogue(actor) };
  }

  @Get('reports/:report')
  @RequiresPermission(Permission.VIEW_REPORTS)
  async definition(@CurrentUser() actor: AuthenticatedUser, @Param('report') id: string) {
    return { data: await this.reports.definition(actor, id) };
  }

  @Post('reports/:report/run')
  @RequiresPermission(Permission.VIEW_REPORTS)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async run(@CurrentUser() actor: AuthenticatedUser, @Param('report') id: string, @Body() body: { params?: Record<string, unknown>; page?: number; limit?: number }) {
    return { data: await this.reports.run(actor, id, body?.params, Number(body?.page) || 1, Number(body?.limit) || 50) };
  }

  @Post('reports/:report/exports')
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ExplicitlyAudited()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async createExport(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('report') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: { params?: Record<string, unknown>; format: string; locale?: string; includeMinor?: boolean },
  ) {
    if (key && (key.length < 8 || key.length > 128)) throw new BadRequestException({ message: 'Idempotency-Key must be 8–128 characters.', details: { code: 'VALIDATION_FAILED' } });
    const result = await this.reports.createExport(actor, id, body ?? ({} as never), key);
    if (!result.replayed) {
      await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.EXPORT_REQUESTED, targetType: 'report_export', targetId: result.export.id, metadata: { reportId: id, format: result.export.format, rows: result.export.rowCount ?? 0, params: JSON.stringify(result.export.params).slice(0, 190) } });
    }
    return { data: result };
  }

  @Get('exports')
  @RequiresPermission(Permission.VIEW_REPORTS)
  async list(@CurrentUser() actor: AuthenticatedUser, @Query() q: Record<string, string>) {
    const r = await this.reports.listExports(actor, q);
    return { data: r.items, meta: { page: r.page, limit: r.limit, total: r.total } };
  }

  @Get('exports/:id')
  @RequiresPermission(Permission.VIEW_REPORTS)
  async get(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.reports.getExport(actor, id) };
  }

  /** Streams the file: private (never publicly served), attachment, no-store, nosniff. Permission is re-checked here; every download is audited. */
  @Get('exports/:id/download')
  @RequiresPermission(Permission.VIEW_REPORTS)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async download(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Res() res: Response) {
    const prepared = await this.reports.prepareDownload(actor, id);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.EXPORT_DOWNLOADED, targetType: 'report_export', targetId: id, metadata: { reportId: prepared.reportId } });
    res.setHeader('Content-Type', prepared.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${prepared.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (prepared.checksum) res.setHeader('X-Checksum-SHA256', prepared.checksum);
    createReadStream(prepared.file).on('error', () => res.destroy()).pipe(res);
  }

  @Post('exports/:id/cancel')
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ExplicitlyAudited()
  async cancel(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    const data = await this.reports.cancelExport(actor, id);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.EXPORT_CANCELLED, targetType: 'report_export', targetId: id });
    return { data };
  }

  @Delete('exports/:id')
  @RequiresPermission(Permission.VIEW_REPORTS)
  async expire(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    await this.reports.expireExport(actor, id);
    return { message: 'Export removed.' };
  }
}
