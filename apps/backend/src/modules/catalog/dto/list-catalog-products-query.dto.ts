import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ListCatalogProductsQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  /** Exact barcode lookup — information for the admin ("is there already a catalog product for this GTIN?"). */
  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  isActive?: boolean;

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
}
