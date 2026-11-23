import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { MAX_ZONE_DELIVERY_FEE_MINOR } from './create-delivery-zone.dto';

const SINGLE_NAME = /^[^,،;|\r\n]+$/;

export class NeighborhoodEntryDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @MaxLength(150) @Matches(/\S/) @Matches(SINGLE_NAME) name: string;
  @IsString() @MaxLength(150) @Matches(/\S/) @Matches(SINGLE_NAME) nameAr: string;
  @IsInt() @Min(0) @Max(MAX_ZONE_DELIVERY_FEE_MINOR) deliveryFeeMinor: number;
  @IsBoolean() isActive: boolean;
}

export class SaveDeliveryZoneGroupDto {
  /** Original group locator; null for a brand-new parent. */
  @IsOptional() @IsUUID() originalServiceAreaId?: string;
  @IsOptional() @IsString() originalZoneName?: string;
  @IsOptional() @IsString() originalZoneNameAr?: string;

  @IsUUID() serviceAreaId: string;
  @IsString() @MaxLength(150) @Matches(/\S/) @Matches(SINGLE_NAME) zoneName: string;
  @IsString() @MaxLength(150) @Matches(/\S/) @Matches(SINGLE_NAME) zoneNameAr: string;
  @IsInt() @Min(0) @Max(100000) displayOrder: number;
  @IsBoolean() isActive: boolean;

  @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(() => NeighborhoodEntryDto)
  neighborhoods: NeighborhoodEntryDto[];
}
