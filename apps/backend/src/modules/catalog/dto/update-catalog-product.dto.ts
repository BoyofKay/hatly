import { IsEnum, IsOptional, IsString, IsUrl, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { PricingUnit } from '../../products/pricing-unit.enum';

/**
 * Every field optional. `null` clears an optional field (nameAr, description, descriptionAr, imageUrl,
 * brand, barcode). `pricingUnit` may change only while NO listing is linked (the service enforces it).
 * Activation lives on its own endpoints, like every other admin resource here.
 */
export class UpdateCatalogProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name?: string;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(150)
  nameAr?: string | null;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  description?: string | null;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  descriptionAr?: string | null;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUrl()
  imageUrl?: string | null;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string | null;

  @IsOptional()
  @IsEnum(PricingUnit)
  pricingUnit?: PricingUnit;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  barcode?: string | null;
}
