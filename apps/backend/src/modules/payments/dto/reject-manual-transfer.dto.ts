import { IsOptional, IsString } from 'class-validator';

export class RejectManualTransferDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
