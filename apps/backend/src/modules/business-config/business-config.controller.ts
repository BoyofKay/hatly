import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { BusinessConfigService } from './business-config.service';
import { UpsertBusinessConfigDto } from './dto/upsert-business-config.dto';

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
  constructor(private readonly businessConfigService: BusinessConfigService) {}

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
  @RequiresPermission(Permission.MANAGE_BUSINESS_CONFIG)
  async set(
    @Param('key') key: string,
    @Body() dto: UpsertBusinessConfigDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const row = await this.businessConfigService.set(key, dto.value, actor.id, dto.description);
    return { data: row };
  }
}
