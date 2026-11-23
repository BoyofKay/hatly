import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

/**
 * `slug` is validated as a stable, URL/identifier-safe token (lowercase
 * letters, digits, hyphens) — matches the shape the Flutter fixture
 * already used (e.g. `'restaurants'`, `'fast_food'` — note: existing
 * fixture used underscores; hyphen-or-underscore both accepted here
 * since neither was ever a confirmed business decision, just a prior
 * UI-only convention).
 */
export class CreateSectorDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameAr?: string;

  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+([_-][a-z0-9]+)*$/, {
    message: 'slug must be lowercase letters, numbers, hyphens, or underscores only',
  })
  slug: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Part F (Marketplace image/asset readiness): a plain URL reference, same pattern as `Vendor.logoUrl`. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bannerUrl?: string | null;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  accentColor?: string;

  /** May customers send custom (free-text / photo) requests to vendors of this sector? Defaults to false. */
  @IsOptional()
  @IsBoolean()
  customRequestsEnabled?: boolean;
}
