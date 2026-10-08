import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
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
 *
 * Filters V1 additions: `openNow`/`hasOffers`/`minRating`, plus
 * `'offers'` added to `sort` — all optional, backward compatible.
 */
export class ListVendorsQueryDto {
  @IsUUID()
  sectorId: string;

  @IsOptional()
  @IsIn(['highestRated', 'newest', 'offers'])
  sort?: 'highestRated' | 'newest' | 'offers';

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

  /**
   * Consolidated customer-commerce milestone (Part E — Sector
   * Subcategories): OPTIONAL, same backward-conscious discipline as
   * `latitude`/`longitude` above — omitted, behavior is unchanged
   * (every branch in the sector, as before this chunk).
   */
  @IsOptional()
  @IsUUID()
  subcategoryId?: string;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  openNow?: boolean;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  hasOffers?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  minRating?: number;
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
      subcategoryId: query.subcategoryId,
      openNow: query.openNow,
      hasOffers: query.hasOffers,
      minRating: query.minRating,
    });
    return { data: result.data, meta: { page: result.page, limit: result.limit, total: result.total } };
  }
}
