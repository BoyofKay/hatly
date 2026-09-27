import { IsInt, IsOptional, IsString, IsUUID, Min, MaxLength } from 'class-validator';

/**
 * CONFIRMED (Phase I-A, Chunk 2): `isActive` is deliberately NOT
 * here — see AdminProductsService's own comment for why creation uses
 * the entity's own pre-existing default (active) rather than
 * inventing a new "starts inactive" rule Chunk 1 never established
 * for catalog resources.
 */
export class CreateProductCategoryDto {
  @IsUUID()
  vendorBranchId: string;

  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameAr?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
