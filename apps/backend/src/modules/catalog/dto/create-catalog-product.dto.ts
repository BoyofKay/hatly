import { IsBoolean, IsEnum, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { PricingUnit } from '../../products/pricing-unit.enum';

export class CreateCatalogProductDto {
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  nameAr?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  descriptionAr?: string;

  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @IsEnum(PricingUnit)
  pricingUnit: PricingUnit;

  /** Barcode / GTIN — optional, unique among live catalog products. Information only: never auto-links. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  barcode?: string;

  /** New catalog products are ACTIVE unless the admin says otherwise. */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
