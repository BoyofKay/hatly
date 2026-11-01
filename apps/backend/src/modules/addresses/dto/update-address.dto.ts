import { IsBoolean, IsEnum, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';
import { AddressMode } from '../address-mode';

export class UpdateAddressDto {
  /** An explicit method SWITCH (or the first mode of a legacy address): the fields of the other method are cleared. */
  @IsOptional()
  @IsEnum(AddressMode)
  mode?: AddressMode;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/\S/)
  line1?: string;

  /** PD-009: (re)select the Delivery Zone. Changing to a different zone requires it to be active. */
  @IsOptional()
  @IsUUID()
  deliveryZoneId?: string;

  /** Optional map pin — both or neither; `null` for both removes it. */
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsLatitude()
  latitude?: number | null;

  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsLongitude()
  longitude?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  instructions?: string;

  /** Governorate / city are DERIVED from the selected zone on save; a client value is accepted for compatibility but replaced. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  governorate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  street?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  buildingNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  floor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  apartment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  landmark?: string;

  /** The map provider's ASSISTIVE suggestion — never the authoritative address. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  formattedAddress?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
