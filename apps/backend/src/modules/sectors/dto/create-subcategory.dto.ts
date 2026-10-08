import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

/**
 * Mirrors `CreateSectorDto` exactly, minus `slug` (a Subcategory has
 * no standalone deep-link/identifier need of its own — it is always
 * addressed by `id`, scoped under its parent `sectorId`), plus
 * `sectorId` (the one required relationship every Subcategory must
 * have) and an optional `imageUrl` (a plain existing-upload-model URL
 * reference — see `MarketplaceSubcategory`'s own doc comment; never a
 * second asset pipeline).
 */
export class CreateSubcategoryDto {
  @IsUUID()
  sectorId: string;

  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameAr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
