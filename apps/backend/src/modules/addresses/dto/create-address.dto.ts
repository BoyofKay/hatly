import { IsBoolean, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreateAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  /** The detailed, free-form address the driver reads. Required; it never needs to be geocodable. */
  @IsString()
  @MaxLength(255)
  @Matches(/\S/)
  line1: string;

  /** PD-009: the Delivery Zone the customer selected (GET /delivery-zones). Required; must be active. */
  @IsUUID()
  deliveryZoneId: string;

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
