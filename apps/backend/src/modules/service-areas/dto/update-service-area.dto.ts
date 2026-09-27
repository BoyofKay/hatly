import { IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** `isActive` has its own dedicated activate/deactivate endpoints, not a generic PATCH field — matches the established Vendor/Sector/Category convention. */
export class UpdateServiceAreaDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  nameAr?: string;

  @IsOptional()
  @IsLatitude()
  centerLatitude?: number;

  @IsOptional()
  @IsLongitude()
  centerLongitude?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200000)
  radiusMeters?: number;
}
