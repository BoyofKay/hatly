import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateUploadDto {
  @IsString()
  @MinLength(1)
  base64Content: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  filename: string;
}
