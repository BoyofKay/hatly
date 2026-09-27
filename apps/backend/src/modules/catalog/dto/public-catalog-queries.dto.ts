import { Type } from 'class-transformer';
import { IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/** `GET /products` — product-first listing of one sector. */
export class ListSectorProductsQueryDto {
  @IsUUID()
  sectorId: string;

  @IsOptional()
  @IsIn(['highestRated', 'bestSelling', 'newest', 'price_asc', 'price_desc'])
  sort?: 'highestRated' | 'bestSelling' | 'newest' | 'price_asc' | 'price_desc';

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

/** `GET /catalog-products/:id` — optional coordinates narrow the listings to the customer's service area. */
export class CatalogProductDetailsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;
}
