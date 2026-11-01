import { Body, Controller, Get, Optional, Param, Patch, Post } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminAuditAction, AdminAuditService } from '../audit/admin-audit.service';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { VendorStaffService } from './vendor-staff.service';
import { CreateVendorStaffDto } from './dto/create-vendor-staff.dto';
import { ExplicitlyAudited } from '../audit/admin-mutation-audit.interceptor';

/**
 * No @UseGuards here — PermissionsGuard is global (Phase 1 hardening),
 * so @RequiresPermission alone is sufficient; SUPER_ADMIN bypasses,
 * an ADMIN needs MANAGE_VENDOR_STAFF explicitly granted.
 */
@ApiTags('admin-vendor-staff')
@Controller('admin/vendor-staff')
export class AdminVendorStaffController {
  constructor(
    private readonly vendorStaffService: VendorStaffService,
    @Optional() private readonly audit?: AdminAuditService,
  ) {}

  @Post()
  @ExplicitlyAudited()
  @RequiresPermission(Permission.MANAGE_VENDOR_STAFF)
  async create(@Body() dto: CreateVendorStaffDto, @CurrentUser() actor: AuthenticatedUser) {
    const staff = await this.vendorStaffService.create(dto);
    await this.audit?.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.VENDOR_STAFF_CREATED, targetType: 'vendor_staff', targetId: String((staff as { id?: string }).id ?? ''), metadata: { role: String((dto as { role?: string }).role ?? '') } });
    return { data: staff };
  }

  /**
   * CHUNK 10 addition — reuses MANAGE_VENDOR_STAFF exactly, no new
   * permission. Read-only.
   */
  @Get()
  @RequiresPermission(Permission.MANAGE_VENDOR_STAFF)
  async list() {
    const staff = await this.vendorStaffService.listAll();
    return { data: staff };
  }

  /**
   * CHUNK 11 addition. `:id` is the VendorStaff row id (matches the
   * id already shown in the list from Chunk 10) — never a raw User
   * id. Reuses MANAGE_VENDOR_STAFF exactly, no new permission.
   */
  @Patch(':id/activate')
  @ExplicitlyAudited()
  @RequiresPermission(Permission.MANAGE_VENDOR_STAFF)
  async activate(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    const staff = await this.vendorStaffService.activate(id);
    await this.audit?.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.VENDOR_STAFF_ACTIVATED, targetType: 'vendor_staff', targetId: id });
    return { data: staff };
  }

  @Patch(':id/deactivate')
  @ExplicitlyAudited()
  @RequiresPermission(Permission.MANAGE_VENDOR_STAFF)
  async deactivate(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    const staff = await this.vendorStaffService.deactivate(id);
    await this.audit?.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.VENDOR_STAFF_DEACTIVATED, targetType: 'vendor_staff', targetId: id });
    return { data: staff };
  }
}
