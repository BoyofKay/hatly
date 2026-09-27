import { IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';

/**
 * CONFIRMED (Phase I-A, Chunk 2): `vendorBranchId` is deliberately NOT
 * editable — ownership stays immutable after creation. `isActive` has
 * its own dedicated activate/deactivate endpoints, not a generic
 * PATCH field, matching the established Offers/MarketplaceSector/
 * Vendor convention from Chunk 1.
 */
export class UpdateProductCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameAr?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
