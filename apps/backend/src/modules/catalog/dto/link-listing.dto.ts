import { IsUUID } from 'class-validator';

/** The vendor listing (existing `products.id`) to link to the catalog product named in the URL. */
export class LinkListingDto {
  @IsUUID()
  productId: string;
}
