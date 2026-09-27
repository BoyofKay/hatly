import { IsString, MinLength } from 'class-validator';

export class RejectCashRemainderDto {
  @IsString()
  @MinLength(1)
  reason: string;
}
