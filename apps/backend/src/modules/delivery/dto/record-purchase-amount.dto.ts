import { IsInt, Min } from 'class-validator';

export class RecordPurchaseAmountDto {
  @IsInt()
  @Min(0)
  amountMinor: number;
}
