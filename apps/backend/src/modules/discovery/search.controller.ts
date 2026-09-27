import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';

/**
 * Customer Search. Public — CONFIRMED, matches the existing
 * public discovery/catalog browsing convention exactly (same
 * @Public() decorator already used by `GET vendors` and
 * `GET vendor-branches/:branchId/products`) — no new authentication
 * requirement introduced.
 */
@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Public()
  @Get()
  async search(@Query() query: SearchQueryDto) {
    const result = await this.searchService.search({
      q: query.q,
      latitude: query.latitude,
      longitude: query.longitude,
      vendorPage: query.vendorPage,
      vendorLimit: query.vendorLimit,
      productPage: query.productPage,
      productLimit: query.productLimit,
    });
    return { data: result };
  }
}
