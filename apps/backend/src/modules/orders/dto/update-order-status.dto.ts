import { IsEnum, IsOptional, IsString } from 'class-validator';
import { OrderStatus } from '../order-status.enum';

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus)
  status: OrderStatus;

  @IsOptional()
  @IsString()
  cancellationReason?: string;

  /** Failed Delivery Metadata (Chunk 1). Optional — stored as null when omitted, no validation/business rule invented beyond the existing string-field convention above. */
  @IsOptional()
  @IsString()
  failureReason?: string;
}
