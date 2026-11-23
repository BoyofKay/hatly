import { ArrayMaxSize, IsArray, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

/** The fee ceiling is a typo guard (100,000 EGP), not a business rule. */
export const MAX_ZONE_DELIVERY_FEE_MINOR = 10_000_000;
const NOT_BLANK = /\S/;

export class CreateDeliveryZoneDto {
  @IsUUID()
  serviceAreaId: string;

  @IsString()
  @MaxLength(80)
  @Matches(NOT_BLANK)
  governorate: string;

  @IsString()
  @MaxLength(80)
  @Matches(NOT_BLANK)
  governorateAr: string;

  @IsString()
  @MaxLength(80)
  @Matches(NOT_BLANK)
  city: string;

  @IsString()
  @MaxLength(80)
  @Matches(NOT_BLANK)
  cityAr: string;

  @IsString()
  @MaxLength(150)
  @Matches(NOT_BLANK)
  name: string;

  @IsString()
  @MaxLength(150)
  @Matches(NOT_BLANK)
  nameAr: string;

  /** Integer minor units. 0 is allowed (a free-delivery zone is a real business choice). */
  @IsInt()
  @Min(0)
  @Max(MAX_ZONE_DELIVERY_FEE_MINOR)
  deliveryFeeMinor: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  displayOrder?: number;

  /** Optional metadata only — both or neither. */
  @IsOptional()
  @IsLatitude()
  representativeLatitude?: number;

  @IsOptional()
  @IsLongitude()
  representativeLongitude?: number;

  /** Villages / neighbourhoods inside the zone (names, Arabic). Replaces the list when sent. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(300)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  areas?: string[];
}
