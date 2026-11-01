import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Set or change the signed-in customer's password. `currentPassword` is REQUIRED when the account already has a password
 * (checked by AuthService.setCustomerPassword); a legacy passwordless account setting its first password omits it.
 */
export class CustomerPasswordSetupDto {
  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsString()
  currentPassword?: string;
}
