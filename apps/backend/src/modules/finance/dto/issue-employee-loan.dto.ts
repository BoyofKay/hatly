import { IsInt, IsISO8601, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class IssueEmployeeLoanDto {
  @IsUUID()
  employeeUserId: string;

  @IsInt()
  @Min(1)
  borrowedAmountMinor: number;

  @IsISO8601()
  issuedAt: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
