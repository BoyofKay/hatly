import { IsOptional, IsString, MaxLength } from 'class-validator';

export class MarkRefundSentDto {
  /** Optional reference for the money transfer (e.g. "InstaPay ref 4821"). Never a secret. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
