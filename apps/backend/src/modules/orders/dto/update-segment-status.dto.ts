import { IsDateString, IsEnum, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { IsNotEmpty } from 'class-validator';
import { OrderVendorSegmentStatus } from '../order-vendor-segment-status.enum';

export class UpdateSegmentStatusDto {
  @IsEnum(OrderVendorSegmentStatus)
  status: OrderVendorSegmentStatus;

  @IsOptional()
  @IsDateString()
  expectedReadyAt?: string;

  /** REQUIRED when the status is CANCELLED (a rejection): shown to the customer and kept in the segment history. */
  @ValidateIf((o: UpdateSegmentStatusDto) => o.status === OrderVendorSegmentStatus.CANCELLED || o.reason !== undefined)
  @IsString()
  @IsNotEmpty({ message: 'A reason is required to reject an order segment.' })
  @MaxLength(500)
  reason?: string;
}
