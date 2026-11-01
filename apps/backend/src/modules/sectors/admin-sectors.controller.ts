import { Body, Controller, Get, Optional, Param, Patch, Post } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminAuditAction, AdminAuditService } from '../audit/admin-audit.service';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { SectorsService } from './sectors.service';
import { CreateSectorDto } from './dto/create-sector.dto';
import { UpdateSectorDto } from './dto/update-sector.dto';

/**
 * FINAL DECISION: Admin-only — Vendors/Vendor Staff cannot create,
 * edit, activate, deactivate, or assign sectors; no Vendor-facing
 * endpoint or permission exists anywhere for this. `@RequiresPermission`
 * alone is sufficient — PermissionsGuard is global (same established
 * pattern as AdminOffersController/AdminCommissionConfigController).
 *
 * Deliberately no arbitrary/unrestricted PATCH — `update` only touches
 * name/nameAr/sortOrder (see UpdateSectorDto's own comment); active
 * state has its own dedicated activate/deactivate endpoints.
 */
@ApiTags('admin-sectors')
@Controller('admin/sectors')
export class AdminSectorsController {
  constructor(
    private readonly sectorsService: SectorsService,
    @Optional() private readonly audit?: AdminAuditService,
  ) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_MARKETPLACE_SECTORS)
  async create(@Body() dto: CreateSectorDto) {
    const sector = await this.sectorsService.create(dto);
    return { data: sector };
  }

  @Get()
  @RequiresPermission(Permission.MANAGE_MARKETPLACE_SECTORS)
  async list() {
    const sectors = await this.sectorsService.listAllForAdmin();
    return { data: sectors };
  }

  @Get(':id')
  @RequiresPermission(Permission.MANAGE_MARKETPLACE_SECTORS)
  async getOne(@Param('id') id: string) {
    const sector = await this.sectorsService.getOne(id);
    return { data: sector };
  }

  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_MARKETPLACE_SECTORS)
  async update(@Param('id') id: string, @Body() dto: UpdateSectorDto, @CurrentUser() actor: AuthenticatedUser) {
    const sector = await this.sectorsService.update(id, dto);
    if (dto.customRequestsEnabled !== undefined) {
      await this.audit?.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.SECTOR_CUSTOM_REQUESTS_CHANGED, targetType: 'sector', targetId: id, metadata: { enabled: dto.customRequestsEnabled } });
    }
    return { data: sector };
  }

  @Patch(':id/activate')
  @RequiresPermission(Permission.MANAGE_MARKETPLACE_SECTORS)
  async activate(@Param('id') id: string) {
    const sector = await this.sectorsService.activate(id);
    return { data: sector };
  }

  @Patch(':id/deactivate')
  @RequiresPermission(Permission.MANAGE_MARKETPLACE_SECTORS)
  async deactivate(@Param('id') id: string) {
    const sector = await this.sectorsService.deactivate(id);
    return { data: sector };
  }
}
