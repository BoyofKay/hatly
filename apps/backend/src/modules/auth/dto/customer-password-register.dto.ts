import { IsOptional, IsPhoneNumber, IsString, Matches, MinLength } from 'class-validator';

/**
 * Customer registration with a password. Creates an account ONLY for a phone that has none; any existing account is refused
 * (see AuthService.registerCustomerWithPassword) — registration never attaches or overwrites a password.
 *
 * `code` is the one-time code sent by `customer/register/request-code`. It is REQUIRED while `CUSTOMER_OTP_ENABLED` is on (the
 * service enforces it — whether OTP is on is a server-side setting, not something the DTO can know) and proves the caller owns
 * the phone BEFORE the account exists, so nobody can register a number they do not control. There is deliberately no
 * client-supplied "verified" field: the global ValidationPipe rejects unknown properties, and the account is marked verified
 * only by the server after a proven code.
 *
 * `@MinLength(8)` matches the existing Driver/Vendor-staff minimum
 * password convention exactly (CreateVendorStaffDto/bootstrap-admin) —
 * no new, stricter policy invented for Customer.
 */
export class CustomerPasswordRegisterDto {
  @IsPhoneNumber('EG')
  phone: string;

  @IsString()
  @MinLength(2)
  fullName: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/)
  code?: string;
}
