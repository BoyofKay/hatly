import { IsEnum } from 'class-validator';
import { FulfillmentType } from '../fulfillment-type.enum';

export class SetFulfillmentTypeDto {
  @IsEnum(FulfillmentType)
  fulfillmentType: FulfillmentType;
}
