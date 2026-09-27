import { IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Customer Search. `latitude`/`longitude` OPTIONAL — mirrors
 * `ListVendorsQueryDto`'s own exact pattern (Multi-City / Phase I-B),
 * same backward-conscious contract: omitted means unfiltered, never a
 * fake/hardcoded coordinate substituted here or anywhere downstream.
 */
export class SearchQueryDto {
  @IsString()
  q: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  vendorPage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  vendorLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productPage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productLimit?: number;
}
