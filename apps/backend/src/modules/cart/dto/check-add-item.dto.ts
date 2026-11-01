import { IsUUID } from 'class-validator';

/** Asks whether a product could be added to the customer's CURRENT cart, without adding it. */
export class CheckAddItemDto {
  @IsUUID()
  productId: string;
}
