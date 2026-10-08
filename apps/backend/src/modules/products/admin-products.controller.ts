import { Body, Controller, Get, Header, Param, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductExcelImportService, EXCEL_IMPORT_MAX_FILE_SIZE_BYTES } from './product-excel-import.service';
import { requireUploadedFile, singleFileMultipartLimits } from './multipart-limits';
import { RateLimitPolicies, Throttled } from '../../common/throttling/rate-limit-policies';

/**
 * CONFIRMED (Phase I-A, Chunk 2): Admin-only management surface —
 * distinct from the existing public `products/:id` and
 * `vendor-branches/:branchId/products` read endpoints
 * (ProductsController), which remain untouched and are not
 * duplicated here.
 */
@ApiTags('admin-products')
@Controller('admin/products')
export class AdminProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly productExcelImportService: ProductExcelImportService,
  ) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async create(@Body() dto: CreateProductDto) {
    const product = await this.productsService.adminCreateProduct(dto);
    return { data: product };
  }

  @Get()
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async list(@Query('vendorBranchId') vendorBranchId?: string, @Query('categoryId') categoryId?: string) {
    const products = await this.productsService.adminListProducts(vendorBranchId, categoryId);
    return { data: products };
  }

  /**
   * Excel Inventory & Price Management. CRITICAL: declared before
   * `@Get(':id')` below — same NestJS/Express declaration-order
   * requirement already confirmed on the Vendor side. `authorize`
   * always resolves `true` — CONFIRMED, `MANAGE_CATALOG` above already
   * gates this entire controller, so no additional per-row check is
   * needed for Admin (unlike Vendor, which reuses
   * VendorStaffAuthorizationService per row).
   */
  @Get('import-template')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="hatly-products-template.xlsx"')
  async downloadImportTemplate(
    @Query('vendorBranchId') vendorBranchId: string,
    @Query('prefilled') prefilled?: string,
  ): Promise<StreamableFile> {
    const products = prefilled === 'false' ? [] : await this.productsService.adminListProducts(vendorBranchId);
    const buffer = this.productExcelImportService.generateTemplate(products);
    return new StreamableFile(buffer);
  }

  @Post('import/validate')
  @Throttled(RateLimitPolicies.fileImport)
  @RequiresPermission(Permission.MANAGE_CATALOG)
  @UseInterceptors(FileInterceptor('file', { limits: singleFileMultipartLimits(EXCEL_IMPORT_MAX_FILE_SIZE_BYTES) }))
  async validateImport(@UploadedFile() file: Express.Multer.File) {
    const { summary } = await this.productExcelImportService.validate(requireUploadedFile(file, 'file').buffer, async () => true);
    return { data: summary };
  }

  @Post('import/apply')
  @Throttled(RateLimitPolicies.fileImport)
  @RequiresPermission(Permission.MANAGE_CATALOG)
  @UseInterceptors(FileInterceptor('file', { limits: singleFileMultipartLimits(EXCEL_IMPORT_MAX_FILE_SIZE_BYTES) }))
  async applyImport(@UploadedFile() file: Express.Multer.File) {
    const result = await this.productExcelImportService.apply(requireUploadedFile(file, 'file').buffer, async () => true);
    return { data: result };
  }

  @Get(':id')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async getOne(@Param('id') id: string) {
    const product = await this.productsService.adminGetProduct(id);
    return { data: product };
  }

  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    const product = await this.productsService.adminUpdateProduct(id, dto);
    return { data: product };
  }

  @Patch(':id/activate')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async activate(@Param('id') id: string) {
    const product = await this.productsService.adminActivateProduct(id);
    return { data: product };
  }

  @Patch(':id/deactivate')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async deactivate(@Param('id') id: string) {
    const product = await this.productsService.adminDeactivateProduct(id);
    return { data: product };
  }

  /**
   * Tracked Inventory Order-Time Enforcement. Reuses MANAGE_CATALOG
   * exactly — no new permission, matching this chunk's own explicit
   * instruction.
   */
  @Patch(':id/set-inventory-zero')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async setInventoryToZero(@Param('id') id: string) {
    const product = await this.productsService.adminSetInventoryToZero(id);
    return { data: product };
  }
}
