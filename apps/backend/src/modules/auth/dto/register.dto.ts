import { IsPhoneNumber, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsPhoneNumber('EG')
  phone: string;

  @IsString()
  @MinLength(2)
  fullName: string;
}
