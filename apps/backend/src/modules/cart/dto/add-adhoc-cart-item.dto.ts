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
  MaxLength,
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
 * `pickup*` is the route ORIGIN and `destination*` the route DESTINATION of a new group, for BOTH service types (PD-012). Each is
 * optional and independent: an omitted end is resolved at checkout from the service's configured default (Hatly: origin and
 * destination; Wasally: destination only — a Wasally origin has no default and is required). The customer's own address is never
 * substituted. The cart only stores them; the checkout planner resolves and validates the route.
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

  @IsOptional()
  @IsString()
  @MaxLength(120)
  pickupLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  destinationLabel?: string;

  /** Owner decision 2026-11-27: text, photos and a voice note are each optional — at least one of them is required (enforced in CartService). */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  freeTextDescription?: string;

  @IsInt()
  @Min(1)
  @Max(50)
  quantity: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  imageUrls?: string[];

  /** A voice note (up to 5 minutes) uploaded through POST /uploads/audio by this customer. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  voiceNoteUrl?: string;
}
