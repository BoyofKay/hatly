import { IsPhoneNumber, IsString } from 'class-validator';

/**
 * PHASE I-A, CHUNK 5 (locked decision): Driver-only login path —
 * phone + password, never OTP. Kept as its own DTO/endpoint rather
 * than extending the existing customer/admin OTP `auth/login` route,
 * so the Customer OTP flow and Admin Dashboard OTP flow are both left
 * completely untouched.
 */
export class DriverLoginDto {
  @IsPhoneNumber()
  phone: string;

  @IsString()
  password: string;
}
