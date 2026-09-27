import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { ProductsService } from './products.service';
import { CreateProductCategoryDto } from './dto/create-product-category.dto';
import { UpdateProductCategoryDto } from './dto/update-product-category.dto';

/**
 * CONFIRMED (Phase I-A, Chunk 2): Admin-only — no Vendor/Vendor Staff
 * catalog-write access exists or is added here (the open RBAC
 * decision from the Design Review stays open). Distinct route family
 * from the existing public `vendor-branches/:branchId/categories`
 * read endpoint (ProductsController) — no collision, no duplicate
 * read endpoint created.
 */
@ApiTags('admin-product-categories')
@Controller('admin/product-categories')
export class AdminProductCategoriesController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async create(@Body() dto: CreateProductCategoryDto) {
    const category = await this.productsService.adminCreateCategory(dto);
    return { data: category };
  }

  @Get()
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async list(@Query('vendorBranchId') vendorBranchId?: string) {
    const categories = await this.productsService.adminListCategories(vendorBranchId);
    return { data: categories };
  }

  @Get(':id')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async getOne(@Param('id') id: string) {
    const category = await this.productsService.adminGetCategory(id);
    return { data: category };
  }

  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async update(@Param('id') id: string, @Body() dto: UpdateProductCategoryDto) {
    const category = await this.productsService.adminUpdateCategory(id, dto);
    return { data: category };
  }

  @Patch(':id/activate')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async activate(@Param('id') id: string) {
    const category = await this.productsService.adminActivateCategory(id);
    return { data: category };
  }

  @Patch(':id/deactivate')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async deactivate(@Param('id') id: string) {
    const category = await this.productsService.adminDeactivateCategory(id);
    return { data: category };
  }
}
