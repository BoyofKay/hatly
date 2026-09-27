import { IsInt, Min } from 'class-validator';

export class RecordWeightDto {
  @IsInt()
  @Min(1)
  weightGrams: number;
}
