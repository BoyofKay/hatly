import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RequiresAnyPermission, RequiresPermission } from '../../permissions/decorators/requires-permission.decorator';
import { Permission } from '../../permissions/permission.enum';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AdminAuditAction, AdminAuditService } from '../../audit/admin-audit.service';
import { ExplicitlyAudited } from '../../audit/admin-mutation-audit.interceptor';
import { singleFileMultipartLimits } from '../../products/multipart-limits';
import { MAX_FILE_BYTES, MediaService, PURPOSES } from './media.service';

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const ANY_MEDIA_USER = [Permission.MEDIA_VIEW, Permission.MANAGE_MEDIA, Permission.MANAGE_CATALOG, Permission.MANAGE_VENDORS, Permission.MANAGE_MARKETPLACE_SECTORS, Permission.MANAGE_HOME_BANNERS, Permission.MANAGE_CAMPAIGNS] as const;

/** Media library: direct upload through the sharp pipeline, reuse, usage, assignment to records, soft delete / restore / purge. */
@ApiTags('admin-media')
@Controller('admin')
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get('media-purposes')
  @RequiresAnyPermission(...ANY_MEDIA_USER)
  purposes() {
    return { data: Object.entries(PURPOSES).map(([purpose, p]) => ({ purpose, minWidth: p.minWidth, minHeight: p.minHeight, maxEdge: p.maxEdge, square: Boolean(p.square), aspect: p.aspect ?? null, maxBytes: MAX_FILE_BYTES })) };
  }

  @Post('media/uploads')
  @RequiresAnyPermission(...ANY_MEDIA_USER)
  @ExplicitlyAudited()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: singleFileMultipartLimits(MAX_FILE_BYTES) }))
  async upload(@CurrentUser() actor: AuthenticatedUser, @UploadedFile() file: { buffer: Buffer; originalname?: string } | undefined, @Body() body: Record<string, string>) {
    if (!file) throw new BadRequestException({ message: 'Attach the image as the "file" field.', details: { code: 'MEDIA_EMPTY' } });
    const data = await this.media.upload(file, { purpose: body?.purpose, crop: body?.crop, altEn: body?.altEn, altAr: body?.altAr }, actor);
    if (!data.deduplicated) {
      await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.MEDIA_UPLOADED, targetType: 'media_asset', targetId: data.id, metadata: { purpose: data.purpose, bytes: data.bytes, width: data.width, height: data.height } });
    }
    return { data };
  }

  @Get('media')
  @RequiresAnyPermission(...ANY_MEDIA_USER)
  async list(@Query() q: Record<string, string>) {
    const r = await this.media.list(q);
    return { data: r.items, meta: { page: r.page, limit: r.limit, total: r.total } };
  }

  @Get('media/stats')
  @RequiresAnyPermission(Permission.MEDIA_VIEW, Permission.MANAGE_MEDIA)
  async stats() {
    return { data: await this.media.stats() };
  }

  @Get(`media/:id(${UUID})`)
  @RequiresAnyPermission(...ANY_MEDIA_USER)
  async one(@Param('id') id: string) {
    return { data: await this.media.get(id) };
  }

  @Get(`media/:id(${UUID})/usage`)
  @RequiresAnyPermission(...ANY_MEDIA_USER)
  async usage(@Param('id') id: string) {
    return { data: await this.media.usage(id) };
  }

  @Patch(`media/:id(${UUID})`)
  @RequiresPermission(Permission.MANAGE_MEDIA)
  @ExplicitlyAudited()
  async update(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: { altEn?: string; altAr?: string; tags?: string[] }) {
    const data = await this.media.update(id, body ?? {});
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.MEDIA_UPDATED, targetType: 'media_asset', targetId: id });
    return { data };
  }

  @Delete(`media/:id(${UUID})`)
  @RequiresPermission(Permission.MEDIA_DELETE)
  @ExplicitlyAudited()
  async remove(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    const data = await this.media.remove(id, actor.id);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.MEDIA_DELETED, targetType: 'media_asset', targetId: id });
    return { data };
  }

  @Post(`media/:id(${UUID})/restore`)
  @RequiresPermission(Permission.MEDIA_DELETE)
  @ExplicitlyAudited()
  async restore(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    const data = await this.media.restore(id);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.MEDIA_RESTORED, targetType: 'media_asset', targetId: id });
    return { data };
  }

  /** Points a record at an asset: the asset FK and the legacy *_url column are written together, so every existing client keeps working. */
  @Post('media/assign')
  @RequiresAnyPermission(...ANY_MEDIA_USER)
  @ExplicitlyAudited()
  async assign(@CurrentUser() actor: AuthenticatedUser, @Body() body: { entity: string; entityId: string; assetId: string | null }) {
    const data = await this.media.assign(body?.entity, body?.entityId, body?.assetId ?? null, actor);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.MEDIA_UPDATED, targetType: body.entity, targetId: body.entityId, metadata: { assetId: body.assetId ?? 'none' } });
    return { data };
  }

  @Get(`products/:id(${UUID})/media`)
  @RequiresAnyPermission(Permission.CATALOG_VIEW, Permission.MANAGE_CATALOG)
  async productImages(@Param('id') id: string) {
    return { data: await this.media.productImages(id) };
  }

  @Put(`products/:id(${UUID})/media`)
  @RequiresPermission(Permission.MANAGE_CATALOG)
  @ExplicitlyAudited()
  async setProductImages(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: { assetIds: string[] }) {
    const data = await this.media.setProductImages(id, body?.assetIds ?? [], actor);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.PRODUCT_MEDIA_SET, targetType: 'product', targetId: id, metadata: { images: data.assetIds.length } });
    return { data };
  }

  @Post('media-purge')
  @RequiresPermission(Permission.MEDIA_DELETE)
  @ExplicitlyAudited()
  async purge(@CurrentUser() actor: AuthenticatedUser, @Body() body: { dryRun?: boolean }) {
    const data = await this.media.purge(body?.dryRun !== false);
    if (!data.dryRun) await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.MEDIA_PURGED, targetType: 'media_asset', metadata: { purged: data.purged.length, skipped: data.skipped.length } });
    return { data };
  }

  @Post('media-backfill')
  @RequiresPermission(Permission.MANAGE_MEDIA)
  @ExplicitlyAudited()
  async backfill(@CurrentUser() actor: AuthenticatedUser, @Body() body: { limit?: number }) {
    const data = await this.media.backfillLegacy(Number(body?.limit) || 25);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.MEDIA_BACKFILL, targetType: 'media_asset', metadata: { processed: data.processed, remaining: data.remaining } });
    return { data };
  }
}
