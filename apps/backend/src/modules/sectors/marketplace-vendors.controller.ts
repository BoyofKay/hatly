import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Public } from '../../common/decorators/public.decorator';
import { MarketplaceVendorsService } from './marketplace-vendors.service';

/**
 * CONFIRMED (Discovery & Ranking, decision 9): extends the existing
 * `GET /vendors` endpoint rather than creating a parallel one. No
 * `bestSelling` option here — CONFIRMED out of scope (Best Selling is
 * product-level only in this chunk).
 *
 * PHASE I-B addition: `latitude`/`longitude` are OPTIONAL — see
 * MarketplaceVendorsService.listBySector's own comment for why
 * (backward-conscious; the customer app doesn't send these yet).
 */
class ListVendorsQueryDto {
  @IsUUID()
  sectorId: string;

  @IsOptional()
  @IsIn(['highestRated', 'newest'])
  sort?: 'highestRated' | 'newest';

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;
}

@ApiTags('vendors')
@Controller('vendors')
export class MarketplaceVendorsController {
  constructor(private readonly marketplaceVendorsService: MarketplaceVendorsService) {}

  @Public()
  @Get()
  async list(@Query() query: ListVendorsQueryDto) {
    const result = await this.marketplaceVendorsService.listBySector(query.sectorId, {
      sort: query.sort,
      search: query.search,
      page: query.page,
      limit: query.limit,
      latitude: query.latitude,
      longitude: query.longitude,
    });
    return { data: result.data, meta: { page: result.page, limit: result.limit, total: result.total } };
  }
}
