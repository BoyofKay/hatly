import { Body, Controller, Get, Header, Param, Patch, Post, Query, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { VendorProductsService } from './vendor-products.service';
import { VendorUpdateProductDto } from './dto/vendor-update-product.dto';
import { VendorCreateProductDto } from './dto/vendor-create-product.dto';
import { EXCEL_IMPORT_MAX_FILE_SIZE_BYTES } from './product-excel-import.service';
import { requireUploadedFile, singleFileMultipartLimits } from './multipart-limits';
import { RateLimitPolicies, Throttled } from '../../common/throttling/rate-limit-policies';

/**
 * CHUNK 12B-1. Every endpoint is scoped to the caller's own
 * VendorStaff-linked branches — see VendorProductsService's own doc
 * comment for exactly how. Role-gated the same way
 * VendorOrdersController already is (RolesGuard + @Roles) — this is
 * "a vendor acting on their own data," not an admin-permission-gated
 * operation, matching the Chunk 12B design review's own conclusion
 * (MANAGE_CATALOG deliberately NOT used here). VENDOR and
 * VENDOR_MANAGER are treated identically — confirmed, no distinction
 * exists anywhere in this codebase for either role.
 *
 * CHUNK 12B-3 note: category read access lives on a SECOND, small
 * controller class below (`VendorCategoriesController`) in this same
 * file — NOT a new file/module, and NOT a new service (both
 * controllers inject the exact same `VendorProductsService`, per the
 * approved design's Option B). A route required at `vendor/categories`
 * cannot live on THIS class without collision/incorrect nesting,
 * since this class's own `@Controller('vendor/products')` prefix
 * would be prepended to any method path here (NestJS/Express route
 * joining does not treat a leading `/` on a method path as an escape
 * from the controller's own prefix) — a second `@Controller()`
 * declaration is the correct, standard way to expose a sibling route
 * from the same service, not a routing hack. READ-ONLY: no
 * create/update/delete/activate/deactivate category method exists
 * anywhere in this file.
 */
@ApiTags('vendor-products')
@Controller('vendor/products')
@UseGuards(RolesGuard)
@Roles(Role.VENDOR, Role.VENDOR_MANAGER)
export class VendorProductsController {
  constructor(private readonly vendorProductsService: VendorProductsService) {}

  /**
   * CHUNK 12B-2. Image is deliberately NOT part of this request —
   * see `POST :id/image` below (Chunk 12B-1, unchanged) for the
   * required follow-up call.
   */
  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: VendorCreateProductDto) {
    const product = await this.vendorProductsService.createForUser(user.id, dto);
    return { data: product };
  }

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query('vendorBranchId') vendorBranchId?: string) {
    const products = await this.vendorProductsService.listForUser(user.id, vendorBranchId);
    return { data: products };
  }

  /**
   * Excel Inventory & Price Management. CRITICAL: this literal route
   * MUST be declared before `@Get(':id')` below — NestJS/Express match
   * routes in declaration order, so `import-template` would otherwise
   * be incorrectly captured as an `:id` value by the earlier route.
   * `prefilled` (default true) downloads the current branch catalog;
   * `?prefilled=false` returns an empty (headers-only) template.
   * Ownership checked before any product is read.
   */
  @Get('import-template')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="hatly-products-template.xlsx"')
  async downloadImportTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Query('vendorBranchId') vendorBranchId: string,
    @Query('prefilled') prefilled?: string,
  ): Promise<StreamableFile> {
    const buffer =
      prefilled === 'false'
        ? await this.vendorProductsService.getEmptyImportTemplate(user.id, vendorBranchId)
        : await this.vendorProductsService.getImportTemplate(user.id, vendorBranchId);
    return new StreamableFile(buffer);
  }

  /**
   * Validate-only — CONFIRMED never modifies the database. Same
   * "literal before :id" ordering requirement as import-template
   * above — `import/validate` must not be swallowed by `@Get(':id')`
   * (different HTTP method here, POST vs GET, so this specific pair
   * doesn't actually collide, but kept adjacent to import-template
   * for clarity and consistency).
   */
  @Post('import/validate')
  @Throttled(RateLimitPolicies.fileImport)
  @UseInterceptors(FileInterceptor('file', { limits: singleFileMultipartLimits(EXCEL_IMPORT_MAX_FILE_SIZE_BYTES) }))
  async validateImport(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file: Express.Multer.File) {
    const summary = await this.vendorProductsService.validateImport(user.id, requireUploadedFile(file, 'file').buffer);
    return { data: summary };
  }

  /**
   * Apply — the ORIGINAL file is submitted again here (never a
   * client-echoed preview payload) and fully re-validated server-side
   * before anything is written, inside one all-or-nothing transaction.
   */
  @Post('import/apply')
  @Throttled(RateLimitPolicies.fileImport)
  @UseInterceptors(FileInterceptor('file', { limits: singleFileMultipartLimits(EXCEL_IMPORT_MAX_FILE_SIZE_BYTES) }))
  async applyImport(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file: Express.Multer.File) {
    const result = await this.vendorProductsService.applyImport(user.id, requireUploadedFile(file, 'file').buffer);
    return { data: result };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const product = await this.vendorProductsService.getForUser(user.id, id);
    return { data: product };
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: VendorUpdateProductDto) {
    const product = await this.vendorProductsService.updateForUser(user.id, id, dto);
    return { data: product };
  }

  /**
   * CHUNK 12B-1 CORRECTION. `multipart/form-data`, single file field
   * named `image`. Size limit enforced twice, deliberately: here at
   * the multer/interceptor level (rejects an oversized upload before
   * it's even fully buffered) and again in
   * `VendorProductsService.uploadImageForUser` (defense in depth,
   * keeps the size rule co-located with the MIME-type rule for a
   * single clear error path if the multer-level limit is ever
   * reconfigured without updating the service).
   */
  @Post(':id/image')
  @Throttled(RateLimitPolicies.productImageUpload)
  @UseInterceptors(FileInterceptor('image', { limits: singleFileMultipartLimits(5 * 1024 * 1024) }))
  async uploadImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const product = await this.vendorProductsService.uploadImageForUser(user.id, id, requireUploadedFile(file, 'image'));
    return { data: product };
  }

  @Patch(':id/activate')
  async activate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const product = await this.vendorProductsService.activateForUser(user.id, id);
    return { data: product };
  }

  @Patch(':id/deactivate')
  async deactivate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const product = await this.vendorProductsService.deactivateForUser(user.id, id);
    return { data: product };
  }

  /**
   * Tracked Inventory Order-Time Enforcement. Same ownership pattern
   * as every other write endpoint on this controller.
   */
  @Patch(':id/set-inventory-zero')
  async setInventoryToZero(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const product = await this.vendorProductsService.setInventoryToZeroForUser(user.id, id);
    return { data: product };
  }
}

/**
 * CHUNK 12B-3. A separate class purely for correct route placement
 * (`vendor/categories`, not nested under `vendor/products`) — same
 * file, same module, same injected `VendorProductsService`, same
 * role guard. NOT a new service, NOT a new category-management
 * surface — see `VendorProductsController`'s own comment above for
 * why this exists as its own class. Read-only: exactly one route.
 */
@ApiTags('vendor-products')
@Controller('vendor/categories')
@UseGuards(RolesGuard)
@Roles(Role.VENDOR, Role.VENDOR_MANAGER)
export class VendorCategoriesController {
  constructor(private readonly vendorProductsService: VendorProductsService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query('vendorBranchId') vendorBranchId?: string) {
    const categories = await this.vendorProductsService.listCategoriesForUser(user.id, vendorBranchId);
    return { data: categories };
  }
}
