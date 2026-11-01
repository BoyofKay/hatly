import { Transform } from 'class-transformer';
import { ArrayUnique, IsArray, IsIn, IsOptional, IsUUID } from 'class-validator';
import { HOME_SECTION_IDS, HomeSectionId } from './home-product-sections.types';

export class HomeProductSectionsQueryDto {
  /**
   * Narrows the source vendors to the service area of this delivery zone (the same rule as `GET vendors?deliveryZoneId`). Omitted = the
   * whole marketplace, which is what the Customer Home has always shown. Part of the cache key.
   */
  @IsOptional()
  @IsUUID()
  deliveryZoneId?: string;

  /** Comma-separated subset (`OFFERS,NEW`) — a section retry asks only for the section that failed. Omitted = all three. */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').map((v) => v.trim()).filter(Boolean) : value))
  @IsArray()
  @ArrayUnique()
  @IsIn(HOME_SECTION_IDS, { each: true })
  sections?: HomeSectionId[];
}
