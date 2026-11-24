import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RateLimitPolicies, Throttled } from '../../common/throttling/rate-limit-policies';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { requireUploadedFile, singleFileMultipartLimits } from '../products/multipart-limits';
import { HomeBannersService } from './home-banners.service';
import { CreateHomeBannerDto } from './dto/create-home-banner.dto';
import { UpdateHomeBannerDto } from './dto/update-home-banner.dto';

/**
 * Admin-only management of the customer Home banners. Every route needs MANAGE_HOME_BANNERS (SUPER_ADMIN bypasses as everywhere):
 * customers, vendors, drivers and admins without the permission are refused by the global guards before any handler runs.
 */
@ApiTags('admin-home-banners')
@Controller('admin/home-banners')
export class AdminHomeBannersController {
  constructor(private readonly banners: HomeBannersService) {}

  @Get()
  @RequiresPermission(Permission.MANAGE_HOME_BANNERS)
  async list() {
    return { data: await this.banners.listForAdmin() };
  }

  @Get(':id')
  @RequiresPermission(Permission.MANAGE_HOME_BANNERS)
  async getOne(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.banners.getForAdmin(id) };
  }

  @Post()
  @RequiresPermission(Permission.MANAGE_HOME_BANNERS)
  async create(@Body() dto: CreateHomeBannerDto) {
    return { data: await this.banners.create(dto) };
  }

  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_HOME_BANNERS)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateHomeBannerDto) {
    return { data: await this.banners.update(id, dto) };
  }

  /** English/legacy artwork: `multipart/form-data`, one file in the field `image` (JPEG/PNG/WebP, up to 5 MB) — the same contract as a product image. */
  @Post(':id/image')
  @RequiresPermission(Permission.MANAGE_HOME_BANNERS)
  @Throttled(RateLimitPolicies.productImageUpload)
  @UseInterceptors(FileInterceptor('image', { limits: singleFileMultipartLimits(5 * 1024 * 1024) }))
  async uploadImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return { data: await this.banners.uploadImage(id, requireUploadedFile(file, 'image'), user.id) };
  }

  @Post(':id/image/ar')
  @RequiresPermission(Permission.MANAGE_HOME_BANNERS)
  @Throttled(RateLimitPolicies.productImageUpload)
  @UseInterceptors(FileInterceptor('image', { limits: singleFileMultipartLimits(5 * 1024 * 1024) }))
  async uploadArabicImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return { data: await this.banners.uploadImage(id, requireUploadedFile(file, 'image'), user.id, 'ar') };
  }

  @Patch(':id/activate')
  @RequiresPermission(Permission.MANAGE_HOME_BANNERS)
  async activate(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.banners.activate(id) };
  }

  @Patch(':id/deactivate')
  @RequiresPermission(Permission.MANAGE_HOME_BANNERS)
  async deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.banners.deactivate(id) };
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_HOME_BANNERS, Permission.DELETE_RECORDS)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.banners.remove(id) };
  }
}
