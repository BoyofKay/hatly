import { IsBoolean, IsEnum, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';
import { AddressMode } from '../address-mode';

export class CreateAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  /**
   * How this address is identified: MANUAL (zone + typed text, no coordinates) or GPS (coordinates only). Omitted by an old app
   * build: the address is then a legacy one and the original rules apply (zone + text required, pin optional).
   */
  @IsOptional()
  @IsEnum(AddressMode)
  mode?: AddressMode;

  /** The detailed, free-form address the driver reads. Required for MANUAL and legacy addresses; GPS does not need it. */
  @ValidateIf((o: CreateAddressDto) => o.mode !== AddressMode.GPS)
  @IsString()
  @MaxLength(255)
  @Matches(/\S/)
  line1?: string;

  /** PD-009: the Delivery Zone the customer selected (GET /delivery-zones). Required for MANUAL and legacy; GPS has none. */
  @ValidateIf((o: CreateAddressDto) => o.mode !== AddressMode.GPS)
  @IsUUID()
  deliveryZoneId?: string;

  /** Optional map pin — both or neither. Never required to save an address. */
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

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
