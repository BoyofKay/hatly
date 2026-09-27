import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { OrderVendorSegmentStatus } from '../order-vendor-segment-status.enum';

export class UpdateSegmentStatusDto {
  @IsEnum(OrderVendorSegmentStatus)
  status: OrderVendorSegmentStatus;

  @IsOptional()
  @IsDateString()
  expectedReadyAt?: string;
}
