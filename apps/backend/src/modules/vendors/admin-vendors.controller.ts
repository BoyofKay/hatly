import { Throttle } from '@nestjs/throttler';
import { resolveMapsLink } from '../../common/geo/maps-link';
import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RateLimitPolicies, Throttled } from '../../common/throttling/rate-limit-policies';
import { requireUploadedFile, singleFileMultipartLimits } from '../products/multipart-limits';
import { RequiresAnyPermission, RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
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
/** Owner request 2026-11-27: a branch location from a pasted Google / Apple Maps link (short share links are opened server-side). */
@ApiTags('admin-geo')
@Controller('admin/geo')
export class AdminGeoController {
  @Get('maps-link')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @RequiresAnyPermission(Permission.MANAGE_VENDORS, Permission.MANAGE_SERVICE_AREAS)
  async mapsLink(@Query('url') url: string) {
    const point = await resolveMapsLink(String(url ?? '').slice(0, 2000)).catch(() => null);
    if (!point) throw new BadRequestException({ message: 'No location found in this link. In Google Maps: Share → Copy link, or long-press the place and copy the coordinates.', details: { code: 'MAPS_LINK_NO_LOCATION' } });
    return { data: { latitude: point.lat, longitude: point.lng } };
  }
}

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

  /** `multipart/form-data`, one file in the field `image` (JPEG/PNG/WebP, up to 5 MB) — the same contract as a product / banner image. */
  @Post(':id/logo')
  @RequiresPermission(Permission.MANAGE_VENDORS)
  @Throttled(RateLimitPolicies.productImageUpload)
  @UseInterceptors(FileInterceptor('image', { limits: singleFileMultipartLimits(5 * 1024 * 1024) }))
  async uploadLogo(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const vendor = await this.adminVendorsService.uploadLogo(id, requireUploadedFile(file, 'image'), user.id);
    return { data: vendor };
  }

  /** The store banner — same contract as the logo (one `image`, JPEG/PNG/WebP, up to 5 MB). */
  @Post(':id/cover')
  @RequiresPermission(Permission.MANAGE_VENDORS)
  @Throttled(RateLimitPolicies.productImageUpload)
  @UseInterceptors(FileInterceptor('image', { limits: singleFileMultipartLimits(5 * 1024 * 1024) }))
  async uploadCover(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const vendor = await this.adminVendorsService.uploadLogo(id, requireUploadedFile(file, 'image'), user.id, 'cover');
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

  /**
   * M1 (Launch-Readiness Gap Audit, G-01). `isOpen` previously had no
   * write path anywhere in the backend — a branch created via
   * `createVendorBranch` (`isOpen: false`) could never be opened
   * except by the dev-seed script writing straight to the database.
   * Explicit open/close endpoints (not a blind toggle), matching this
   * controller's own `activate`/`deactivate` shape exactly — same
   * reasoning: an explicit target state is unambiguous under a retry
   * or a race between two admins, where a "toggle" would not be.
   * Deliberately gated by the existing, previously-unused
   * `OPEN_CLOSE_VENDOR_BRANCHES` permission (not `MANAGE_VENDORS`) —
   * `permission.enum.ts`'s own `MANAGE_VENDORS` doc comment already
   * describes `OPEN_CLOSE_VENDOR_BRANCHES` as scoped specifically to
   * "toggling a branch's open/active state", i.e. exactly this.
   */
  @Patch(':id/open')
  @RequiresPermission(Permission.OPEN_CLOSE_VENDOR_BRANCHES)
  async open(@Param('id') id: string) {
    const branch = await this.adminVendorsService.openVendorBranch(id);
    return { data: branch };
  }

  @Patch(':id/close')
  @RequiresPermission(Permission.OPEN_CLOSE_VENDOR_BRANCHES)
  async close(@Param('id') id: string) {
    const branch = await this.adminVendorsService.closeVendorBranch(id);
    return { data: branch };
  }
}
