import { IsPhoneNumber, IsString, MinLength } from 'class-validator';

/**
 * Customer Authentication Modes (master implementation). Used for BOTH:
 *  - a genuinely new Customer registering with a password (OTP OFF)
 *  - the passwordless-existing-row attachment flow (see
 *    AuthService.registerOrAttachCustomerPassword's own doc comment
 *    for the full, critical security rule governing which of these
 *    two cases applies and why an existing password can never be
 *    overwritten through this DTO/endpoint).
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
}
