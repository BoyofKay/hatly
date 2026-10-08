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

  /**
   * M4 — Proof of Delivery. Optional at the DTO level (this DTO is shared with
   * Admin's own status-transition path, which has no DELIVERED transition at
   * all in the state machine and so never supplies this); actually REQUIRED
   * enforcement for the driver's own ON_THE_WAY->DELIVERED transition happens
   * in DriverOrderActionsService/ProofOfDeliveryService, not here.
   */
  @IsOptional()
  @IsString()
  proofPhotoUrl?: string;

  /** M4 — Proof of Delivery. Optional recipient/customer confirmation. See proofPhotoUrl's own comment. */
  @IsOptional()
  @IsString()
  recipientName?: string;
}
