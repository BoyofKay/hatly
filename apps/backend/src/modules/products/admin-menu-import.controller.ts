import { Controller, Get, Header, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RateLimitPolicies, Throttled } from '../../common/throttling/rate-limit-policies';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { MENU_IMPORT_MAX_UPLOAD_BYTES, MenuImportService } from './menu-import.service';
import { requireUploadedFile, singleFileMultipartLimits } from './multipart-limits';

/**
 * Full menu import for a branch (see MenuImportService): download the template, fill it (new products, categories, options, photo names),
 * upload the .xlsx — or a .zip with the .xlsx and the photos — to check it, then apply it. MANAGE_CATALOG, like every catalogue change.
 */
@ApiTags('admin-menu-import')
@Controller('admin/menu-import')
export class AdminMenuImportController {
  constructor(private readonly menuImport: MenuImportService) {}

  @Get('template')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="hatly-menu-template.xlsx"')
  async template(@Query('vendorBranchId') vendorBranchId: string): Promise<StreamableFile> {
    return new StreamableFile(await this.menuImport.template(vendorBranchId));
  }

  @Post('validate')
  @Throttled(RateLimitPolicies.fileImport)
  @RequiresPermission(Permission.MANAGE_CATALOG)
  @UseInterceptors(FileInterceptor('file', { limits: singleFileMultipartLimits(MENU_IMPORT_MAX_UPLOAD_BYTES) }))
  async validate(@Query('vendorBranchId') vendorBranchId: string, @UploadedFile() file: Express.Multer.File) {
    return { data: await this.menuImport.validate(vendorBranchId, requireUploadedFile(file, 'file').buffer) };
  }

  @Post('apply')
  @Throttled(RateLimitPolicies.fileImport)
  @RequiresPermission(Permission.MANAGE_CATALOG)
  @UseInterceptors(FileInterceptor('file', { limits: singleFileMultipartLimits(MENU_IMPORT_MAX_UPLOAD_BYTES) }))
  async apply(@Query('vendorBranchId') vendorBranchId: string, @UploadedFile() file: Express.Multer.File, @CurrentUser() actor: AuthenticatedUser) {
    return { data: await this.menuImport.apply(vendorBranchId, requireUploadedFile(file, 'file').buffer, { userId: actor.id, role: actor.role }) };
  }
}
