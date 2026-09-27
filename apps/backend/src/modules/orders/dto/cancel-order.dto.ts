import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Customer cancellation of their OWN order. The order id comes from the URL and the customer from the authenticated
 * token — nothing about ownership, amounts or refunds is ever read from the body (and unknown fields are rejected).
 */
export class CancelOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cancellationReason?: string;
}
