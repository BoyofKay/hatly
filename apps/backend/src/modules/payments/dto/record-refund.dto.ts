import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class RecordRefundDto {
  @IsInt()
  @Min(1)
  amountMinor: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
