import { IsInt, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const NOT_BLANK = /\S/;

/**
 * Name / place / order / representative-point edits. Deliberately NOT here:
 *  - `isActive` — dedicated activate/deactivate endpoints (the Vendor/Sector/ServiceArea convention);
 *  - `deliveryFeeMinor` — its own endpoint, because changing a price also needs the delivery-pricing permission.
 * `representativeLatitude/Longitude: null` (both) removes the point.
 */
export class UpdateDeliveryZoneDto {
  @IsOptional()
  @IsUUID()
  serviceAreaId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(NOT_BLANK)
  governorate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(NOT_BLANK)
  governorateAr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(NOT_BLANK)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(NOT_BLANK)
  cityAr?: string;

  /** Parent delivery zone name, separate from exactly ONE child neighborhood/village. */
  @IsOptional()
  @IsString()
  @MaxLength(150)
  @Matches(NOT_BLANK)
  @Matches(/^[^,،;|\\r\\n]+$/, { message: 'Enter a single name, not a list.' })
  zoneName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  @Matches(NOT_BLANK)
  @Matches(/^[^,،;|\\r\\n]+$/, { message: 'Enter a single name, not a list.' })
  zoneNameAr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  @Matches(NOT_BLANK)
  @Matches(/^[^,،;|\\r\\n]+$/, { message: 'Enter one neighborhood/village per record.' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  @Matches(NOT_BLANK)
  @Matches(/^[^,،;|\\r\\n]+$/, { message: 'Enter one neighborhood/village per record.' })
  nameAr?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  displayOrder?: number;

  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsLatitude()
  representativeLatitude?: number | null;

  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsLongitude()
  representativeLongitude?: number | null;
}
