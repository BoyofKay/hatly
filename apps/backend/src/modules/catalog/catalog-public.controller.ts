import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CatalogDiscoveryService } from './catalog-discovery.service';
import { CatalogProductDetailsQueryDto, ListSectorProductsQueryDto } from './dto/public-catalog-queries.dto';

/**
 * Public, product-first discovery. Additive: the vendor-scoped `vendor-branches/:id/products` and
 * `products/:id` endpoints are untouched (except that `products/:id` gains two extra fields).
 */
@ApiTags('catalog')
@Controller()
export class CatalogPublicController {
  constructor(private readonly discovery: CatalogDiscoveryService) {}

  @Public()
  @Get('products')
  async listBySector(@Query() query: ListSectorProductsQueryDto) {
    const result = await this.discovery.listBySector(query);
    return { data: result.data, meta: { page: result.page, limit: result.limit, total: result.total } };
  }

  @Public()
  @Get('catalog-products/:id')
  async getDetails(@Param('id', ParseUUIDPipe) id: string, @Query() query: CatalogProductDetailsQueryDto) {
    return { data: await this.discovery.getDetails(id, query) };
  }
}
