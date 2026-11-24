import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
export class DriverCommissionRepairPreviewDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ArrayUnique() @IsString({each:true}) @Matches(/^HT-[0-9]+$/,{each:true})
  orderNumbers!:string[];
  @IsInt() @Min(0) @Max(10000)
  rateBasisPoints!:number;
}
export class DriverCommissionRepairDto extends DriverCommissionRepairPreviewDto {
  @IsString() @Matches(/^[0-9a-f]{64}$/)
  previewToken!:string;
  @IsString() @MinLength(10) @MaxLength(500)
  reason!:string;
}
