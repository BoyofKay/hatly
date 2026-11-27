import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * Vendor/Pharmacy Custom Item (inside an existing CATALOG group).
 * Deliberately has NO `adHocPlaceName`/`adHocServiceType`/pickup-
 * destination fields — those are External Hatly Service concepts
 * (AD_HOC_SERVICE groups) and are not meaningful here. This DTO can
 * only ever target an EXISTING CATALOG group (`cartVendorGroupId` is
 * required, not optional as in AddAdHocCartItemDto, since a Custom
 * Item can never start a new group of its own — it always attaches to
 * a vendor's catalog group that already has at least one product in
 * it, per the approved design).
 *
 * `freeTextDescription` is OPTIONAL here — CONFIRMED fix: a request
 * is valid with free text, OR at least one image, OR both; it must
 * NEVER require free text when an image already exists. The
 * "at least one of the two" cross-field rule is enforced in
 * CartService.addVendorCustomItem itself (a single-field validator
 * can't express it), the same way this DTO's own group-targeting
 * cross-field rules are already enforced in the service, not here.
 */
export class AddVendorCustomItemDto {
  @IsOptional()
  @IsUUID()
  cartVendorGroupId?: string;

  /**
   * Empty CATALOG group fix. Provide EITHER `cartVendorGroupId` (an
   * existing CATALOG group already in the cart) OR `vendorBranchId`
   * (starts a brand-new CATALOG group for that branch, exactly the
   * same way `addItem` creates one from `product.vendorBranchId`) —
   * never both. This lets a customer create a Custom Item for a
   * Vendor/Pharmacy they haven't added any catalog product from yet.
   */
  @IsOptional()
  @IsUUID()
  vendorBranchId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  freeTextDescription?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  imageUrls?: string[];

  /** A voice note (up to 5 minutes) uploaded through POST /uploads/audio by this customer. Owner decision 2026-11-27. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  voiceNoteUrl?: string;
}
