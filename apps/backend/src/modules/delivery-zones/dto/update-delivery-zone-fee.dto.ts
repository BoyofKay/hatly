import { IsInt, Max, Min } from 'class-validator';
import { MAX_ZONE_DELIVERY_FEE_MINOR } from './create-delivery-zone.dto';

export class UpdateDeliveryZoneFeeDto {
  /** Integer minor units. Applies to NEW quotes/orders only — every existing order keeps its frozen fee. */
  @IsInt()
  @Min(0)
  @Max(MAX_ZONE_DELIVERY_FEE_MINOR)
  deliveryFeeMinor: number;
}
