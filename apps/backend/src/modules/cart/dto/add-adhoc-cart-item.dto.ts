import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { AdHocServiceType } from '../ad-hoc-service-type.enum';

/**
 * Exactly one of {cartVendorGroupId, adHocPlaceName} is expected:
 * `cartVendorGroupId` to add another item to an existing
 * AD_HOC_SERVICE group already in the cart, or `adHocPlaceName` (with
 * `adHocServiceType`) to start a new one (subject to the single-location
 * cap and the pickup restriction — see cart.service.ts). Enforced in
 * the service, not here, since these are cross-field rules.
 *
 * `pickupLatitude`/`pickupLongitude` are only meaningful for a new
 * BUY_FROM_PLACE group; `destinationLatitude`/`destinationLongitude`
 * only for a new DELIVER_TO_PLACE group. They are optional on this endpoint
 * (the cart only stores them) but REQUIRED to check out: a missing pickup
 * (BUY_FROM_PLACE) or destination (DELIVER_TO_PLACE) is rejected by the
 * checkout planner — no configured default is ever substituted.
 *
 * `imageUrls` accepts plain strings here (not validated as arbitrary
 * URLs a client could fabricate) — CartService cross-checks every one
 * against real `Upload` rows before accepting them; a well-formed but
 * non-Hatly URL is rejected there, not by a URL-format validator here.
 */
export class AddAdHocCartItemDto {
  @IsOptional()
  @IsUUID()
  cartVendorGroupId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  adHocPlaceName?: string;

  @IsOptional()
  @IsEnum(AdHocServiceType)
  adHocServiceType?: AdHocServiceType;

  @IsOptional()
  @IsLatitude()
  pickupLatitude?: number;

  @IsOptional()
  @IsLongitude()
  pickupLongitude?: number;

  @IsOptional()
  @IsLatitude()
  destinationLatitude?: number;

  @IsOptional()
  @IsLongitude()
  destinationLongitude?: number;

  @IsString()
  @MinLength(1)
  freeTextDescription: string;

  @IsInt()
  @Min(1)
  @Max(50)
  quantity: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  imageUrls?: string[];
}
