import { IsInt, IsISO8601, IsOptional, IsString, Min } from 'class-validator';

export class RecordLoanRepaymentDto {
  @IsInt()
  @Min(1)
  amountMinor: number;

  @IsISO8601()
  repaidAt: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
