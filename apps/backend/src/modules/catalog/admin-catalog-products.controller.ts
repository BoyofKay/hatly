import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { CatalogProductsService } from './catalog-products.service';
import { CreateCatalogProductDto } from './dto/create-catalog-product.dto';
import { UpdateCatalogProductDto } from './dto/update-catalog-product.dto';
import { ListCatalogProductsQueryDto } from './dto/list-catalog-products-query.dto';
import { LinkListingDto } from './dto/link-listing.dto';

/**
 * Admin-only catalog identity management, gated by the existing MANAGE_CATALOG permission (same as
 * `admin/products`). Linking a vendor listing is always an explicit call here.
 */
@ApiTags('admin-catalog-products')
@Controller('admin/catalog-products')
export class AdminCatalogProductsController {
  constructor(private readonly catalogProductsService: CatalogProductsService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async create(@Body() dto: CreateCatalogProductDto) {
    return { data: await this.catalogProductsService.create(dto) };
  }

  @Get()
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async list(@Query() query: ListCatalogProductsQueryDto) {
    const result = await this.catalogProductsService.list(query);
    return { data: result.data, meta: { page: result.page, limit: result.limit, total: result.total } };
  }

  @Get(':id')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async getOne(@Param('id', ParseUUIDPipe) id: string) {
    const { catalogProduct, listings } = await this.catalogProductsService.getWithListings(id);
    return { data: { ...catalogProduct, listings } };
  }

  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCatalogProductDto) {
    return { data: await this.catalogProductsService.update(id, dto) };
  }

  @Patch(':id/activate')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async activate(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.catalogProductsService.setActive(id, true) };
  }

  @Patch(':id/deactivate')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.catalogProductsService.setActive(id, false) };
  }

  /** Explicitly link an existing vendor listing (products.id) to this catalog product. */
  @Post(':id/listings')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async linkListing(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkListingDto) {
    return { data: await this.catalogProductsService.linkListing(id, dto.productId) };
  }

  @Delete(':id/listings/:productId')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async unlinkListing(@Param('id', ParseUUIDPipe) id: string, @Param('productId', ParseUUIDPipe) productId: string) {
    return { data: await this.catalogProductsService.unlinkListing(id, productId) };
  }
}
