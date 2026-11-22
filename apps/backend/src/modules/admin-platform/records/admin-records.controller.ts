import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsPhoneNumber, IsString, MaxLength, MinLength } from 'class-validator';
import { RequiresAnyPermission, RequiresPermission } from '../../permissions/decorators/requires-permission.decorator';
import { BranchReadinessService } from './branch-readiness.service';
import { Permission } from '../../permissions/permission.enum';
import { AdminRecordsService, DeletableKind } from './admin-records.service';

class EditPersonDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(150) fullName?: string;
  @IsOptional() @IsPhoneNumber() phone?: string;
}

class ResetPersonPasswordDto {
  @IsString() @MinLength(8) @MaxLength(128) newPassword: string;
}

class EditVendorStaffDto extends EditPersonDto {
  @IsOptional() @IsIn(['VENDOR', 'VENDOR_MANAGER']) role?: 'VENDOR' | 'VENDOR_MANAGER';
}

/**
 * Delete (safe soft delete — see AdminRecordsService) for every admin-managed record, plus the edits that had no endpoint yet (driver and
 * store-staff details). Each route requires the SAME permission that already manages that record; SUPER_ADMIN passes as everywhere.
 * Every call is recorded by the global admin mutation audit interceptor.
 */
@ApiTags('admin-records')
@Controller('admin')
export class AdminRecordsController {
  constructor(
    private readonly records: AdminRecordsService,
    private readonly readiness: BranchReadinessService,
  ) {}

  /** The branch's go-live checklist (read-only). */
  @Get('vendor-branches/:id/readiness')
  @RequiresAnyPermission(Permission.MANAGE_VENDORS, Permission.VENDORS_VIEW)
  async branchReadiness(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.readiness.check(id) };
  }

  private async del(kind: DeletableKind, id: string) {
    return { data: await this.records.remove(kind, id) };
  }

  @Delete('vendors/:id')
  @RequiresPermission(Permission.MANAGE_VENDORS, Permission.DELETE_RECORDS)
  deleteVendor(@Param('id', ParseUUIDPipe) id: string) {
    return this.del('vendor', id);
  }

  @Delete('vendor-branches/:id')
  @RequiresPermission(Permission.MANAGE_VENDORS, Permission.DELETE_RECORDS)
  deleteBranch(@Param('id', ParseUUIDPipe) id: string) {
    return this.del('branch', id);
  }

  @Delete('products/:id')
  @RequiresPermission(Permission.MANAGE_CATALOG, Permission.DELETE_RECORDS)
  deleteProduct(@Param('id', ParseUUIDPipe) id: string) {
    return this.del('product', id);
  }

  @Delete('product-categories/:id')
  @RequiresPermission(Permission.MANAGE_CATALOG, Permission.DELETE_RECORDS)
  deleteProductCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.del('product-category', id);
  }

  @Delete('sectors/:id')
  @RequiresPermission(Permission.MANAGE_MARKETPLACE_SECTORS, Permission.DELETE_RECORDS)
  deleteSector(@Param('id', ParseUUIDPipe) id: string) {
    return this.del('sector', id);
  }

  @Delete('subcategories/:id')
  @RequiresPermission(Permission.MANAGE_MARKETPLACE_SECTORS, Permission.DELETE_RECORDS)
  deleteSubcategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.del('subcategory', id);
  }

  @Delete('offers/:id')
  @RequiresPermission(Permission.MANAGE_OFFERS, Permission.DELETE_RECORDS)
  deleteOffer(@Param('id', ParseUUIDPipe) id: string) {
    return this.del('offer', id);
  }

  // Delivery zones are never deleted (owner decision 2026-11-22: zones are required to operate) — deactivate or edit them instead.

  @Delete('service-areas/:id')
  @RequiresPermission(Permission.MANAGE_SERVICE_AREAS, Permission.DELETE_RECORDS)
  deleteServiceArea(@Param('id', ParseUUIDPipe) id: string) {
    return this.del('service-area', id);
  }

  @Delete('vehicle-types/:id')
  @RequiresPermission(Permission.MANAGE_VEHICLE_TYPES, Permission.DELETE_RECORDS)
  deleteVehicleType(@Param('id', ParseUUIDPipe) id: string) {
    return this.del('vehicle-type', id);
  }

  @Delete('drivers/:id')
  @RequiresPermission(Permission.MANAGE_DRIVERS, Permission.DELETE_RECORDS)
  deleteDriver(@Param('id', ParseUUIDPipe) id: string) {
    return this.del('driver', id);
  }

  @Delete('vendor-staff/:id')
  @RequiresPermission(Permission.MANAGE_VENDOR_STAFF, Permission.DELETE_RECORDS)
  deleteVendorStaff(@Param('id', ParseUUIDPipe) id: string) {
    return this.del('vendor-staff', id);
  }

  @Patch('drivers/:id/profile')
  @RequiresPermission(Permission.MANAGE_DRIVERS)
  async editDriver(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EditPersonDto) {
    return { data: await this.records.editDriver(id, dto) };
  }

  /** A driver who forgot their password: set a temporary one (they are signed out everywhere). Supervisors can do this too. */
  @Post('drivers/:id/reset-password')
  @HttpCode(204)
  @RequiresAnyPermission(Permission.MANAGE_DRIVERS, Permission.CHANGE_DRIVER_ONLINE_STATUS)
  async resetDriverPassword(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetPersonPasswordDto) {
    await this.records.resetPersonPassword('driver', id, dto.newPassword);
  }

  @Post('vendor-staff/:id/reset-password')
  @HttpCode(204)
  @RequiresPermission(Permission.MANAGE_VENDOR_STAFF)
  async resetVendorStaffPassword(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetPersonPasswordDto) {
    await this.records.resetPersonPassword('vendor-staff', id, dto.newPassword);
  }

  @Patch('vendor-staff/:id')
  @RequiresPermission(Permission.MANAGE_VENDOR_STAFF)
  async editVendorStaff(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EditVendorStaffDto) {
    return { data: await this.records.editVendorStaff(id, dto) };
  }
}
