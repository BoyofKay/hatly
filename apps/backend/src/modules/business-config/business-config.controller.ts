import { Optional } from '@nestjs/common';
import { AdminAuditAction, AdminAuditService } from '../audit/admin-audit.service';
import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { BusinessConfigService } from './business-config.service';
import { UpsertBusinessConfigDto } from './dto/upsert-business-config.dto';
import { ExplicitlyAudited } from '../audit/admin-mutation-audit.interceptor';

/**
 * No @UseGuards here — PermissionsGuard is global (Phase 1 hardening),
 * so @RequiresPermission alone is sufficient; it also independently
 * confirms the caller is ADMIN/SUPER_ADMIN before checking the grant.
 * SUPER_ADMIN always passes (bypass); an ADMIN needs an explicit
 * MANAGE_BUSINESS_CONFIG grant — including for the Automatic Dispatch
 * switch itself, which is just one key in this same generic store
 * (see the Phase 2 report for why this wasn't made a
 * SUPER_ADMIN-only special case).
 */
@ApiTags('admin-business-config')
@Controller('admin/business-config')
export class BusinessConfigController {
  constructor(
    private readonly businessConfigService: BusinessConfigService,
    @Optional() private readonly audit?: AdminAuditService,
  ) {}

  @Get()
  @RequiresPermission(Permission.MANAGE_BUSINESS_CONFIG)
  async list() {
    const rows = await this.businessConfigService.getAll();
    return { data: rows };
  }

  @Get(':key')
  @RequiresPermission(Permission.MANAGE_BUSINESS_CONFIG)
  async get(@Param('key') key: string) {
    const value = await this.businessConfigService.get(key, null);
    return { data: { key, value } };
  }

  @Put(':key')
  @ExplicitlyAudited()
  @RequiresPermission(Permission.MANAGE_BUSINESS_CONFIG)
  async set(
    @Param('key') key: string,
    @Body() dto: UpsertBusinessConfigDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const row = await this.businessConfigService.set(key, dto.value, actor.id, dto.description);
    // The setting's NAME is recorded, never its value (a value may be a payment destination or another sensitive detail).
    await this.audit?.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.BUSINESS_CONFIG_CHANGED, targetType: 'business_config', targetId: key });
    return { data: row };
  }

  /** Clears a Hatly / Wasally default route location (back to "not configured"). Other keys are refused. */
  @Delete(':key')
  @ExplicitlyAudited()
  @RequiresPermission(Permission.MANAGE_BUSINESS_CONFIG)
  async clear(@Param('key') key: string, @CurrentUser() actor: AuthenticatedUser) {
    const result = await this.businessConfigService.unset(key);
    await this.audit?.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.BUSINESS_CONFIG_CHANGED, targetType: 'business_config', targetId: key });
    return { data: result };
  }
}
