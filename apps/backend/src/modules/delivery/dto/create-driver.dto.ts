import { IsPhoneNumber, IsString, MinLength } from 'class-validator';

/**
 * PHASE I-A, CHUNK 5 addition (Driver password login — locked
 * decision, do not reopen): drivers are Admin-provisioned, never
 * self-registered, and authenticate with phone+password, never OTP.
 * `password` is required at creation — a Driver account must always
 * have credentials the driver can actually log in with.
 */
export class CreateDriverDto {
  @IsPhoneNumber()
  phone: string;

  @IsString()
  @MinLength(1)
  fullName: string;

  @IsString()
  @MinLength(8)
  password: string;
}
