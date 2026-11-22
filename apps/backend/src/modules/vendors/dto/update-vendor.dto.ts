import { IsIn, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

/**
 * CONFIRMED (Phase I-A, Chunk 1): mirrors CreateVendorDto's own scope
 * — `category`/`commissionPercent` are never touched here either;
 * `isActive` has its own dedicated activate/deactivate endpoints, not
 * a generic PATCH field, matching the established
 * Offers/MarketplaceSector convention.
 */
export class UpdateVendorDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  nameAr?: string;

  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  /** Only '' (remove the banner) — a banner is set by uploading it (POST admin/vendors/:id/cover). */
  @IsOptional()
  @IsIn([''])
  coverImageUrl?: string;
}
