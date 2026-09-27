import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { AdminVendorsService } from './admin-vendors.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';
import { CreateVendorBranchDto } from './dto/create-vendor-branch.dto';
import { UpdateVendorBranchDto } from './dto/update-vendor-branch.dto';

/**
 * CONFIRMED (Phase I-A, Chunk 1): Admin-only, no Vendor/Vendor Staff
 * write access exists or is added here. `admin/vendor-branches` is
 * shared with the existing, untouched `AdminVendorBranchSectorController`
 * (Sectors module) — no route collision: that controller only owns
 * `PATCH admin/vendor-branches/:id/sector`, none of the paths below.
 */
@ApiTags('admin-vendors')
@Controller('admin/vendors')
export class AdminVendorsController {
  constructor(private readonly adminVendorsService: AdminVendorsService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_VENDORS)
  async create(@Body() dto: CreateVendorDto) {
    const vendor = await this.adminVendorsService.createVendor(dto);
    return { data: vendor };
  }

  @Get()
  @RequiresPermission(Permission.MANAGE_VENDORS)
  async list() {
    const vendors = await this.adminVendorsService.listVendors();
    return { data: vendors };
  }

  @Get(':id')
  @RequiresPermission(Permission.MANAGE_VENDORS)
  async getOne(@Param('id') id: string) {
    const vendor = await this.adminVendorsService.getVendor(id);
    return { data: vendor };
  }

  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_VENDORS)
  async update(@Param('id') id: string, @Body() dto: UpdateVendorDto) {
    const vendor = await this.adminVendorsService.updateVendor(id, dto);
    return { data: vendor };
  }

  @Patch(':id/activate')
  @RequiresPermission(Permission.MANAGE_VENDORS)
  async activate(@Param('id') id: string) {
    const vendor = await this.adminVendorsService.activateVendor(id);
    return { data: vendor };
  }

  @Patch(':id/deactivate')
  @RequiresPermission(Permission.MANAGE_VENDORS)
  async deactivate(@Param('id') id: string) {
    const vendor = await this.adminVendorsService.deactivateVendor(id);
    return { data: vendor };
  }
}

@ApiTags('admin-vendor-branches')
@Controller('admin/vendor-branches')
export class AdminVendorBranchesController {
  constructor(private readonly adminVendorsService: AdminVendorsService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_VENDORS)
  async create(@Body() dto: CreateVendorBranchDto) {
    const branch = await this.adminVendorsService.createVendorBranch(dto);
    return { data: branch };
  }

  @Get()
  @RequiresPermission(Permission.MANAGE_VENDORS)
  async list(@Query('vendorId') vendorId?: string) {
    const branches = await this.adminVendorsService.listVendorBranches(vendorId);
    return { data: branches };
  }

  @Get(':id')
  @RequiresPermission(Permission.MANAGE_VENDORS)
  async getOne(@Param('id') id: string) {
    const branch = await this.adminVendorsService.getVendorBranch(id);
    return { data: branch };
  }

  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_VENDORS)
  async update(@Param('id') id: string, @Body() dto: UpdateVendorBranchDto) {
    const branch = await this.adminVendorsService.updateVendorBranch(id, dto);
    return { data: branch };
  }

  @Patch(':id/activate')
  @RequiresPermission(Permission.MANAGE_VENDORS)
  async activate(@Param('id') id: string) {
    const branch = await this.adminVendorsService.activateVendorBranch(id);
    return { data: branch };
  }

  @Patch(':id/deactivate')
  @RequiresPermission(Permission.MANAGE_VENDORS)
  async deactivate(@Param('id') id: string) {
    const branch = await this.adminVendorsService.deactivateVendorBranch(id);
    return { data: branch };
  }
}
