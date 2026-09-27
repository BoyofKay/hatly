import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { VendorStaffService } from './vendor-staff.service';
import { CreateVendorStaffDto } from './dto/create-vendor-staff.dto';

/**
 * No @UseGuards here — PermissionsGuard is global (Phase 1 hardening),
 * so @RequiresPermission alone is sufficient; SUPER_ADMIN bypasses,
 * an ADMIN needs MANAGE_VENDOR_STAFF explicitly granted.
 */
@ApiTags('admin-vendor-staff')
@Controller('admin/vendor-staff')
export class AdminVendorStaffController {
  constructor(private readonly vendorStaffService: VendorStaffService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_VENDOR_STAFF)
  async create(@Body() dto: CreateVendorStaffDto) {
    const staff = await this.vendorStaffService.create(dto);
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
  @RequiresPermission(Permission.MANAGE_VENDOR_STAFF)
  async activate(@Param('id') id: string) {
    const staff = await this.vendorStaffService.activate(id);
    return { data: staff };
  }

  @Patch(':id/deactivate')
  @RequiresPermission(Permission.MANAGE_VENDOR_STAFF)
  async deactivate(@Param('id') id: string) {
    const staff = await this.vendorStaffService.deactivate(id);
    return { data: staff };
  }
}
