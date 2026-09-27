import { IsPhoneNumber } from 'class-validator';

/**
 * Body of `POST /auth/login` (request an OTP for an existing customer). The route used to read the
 * phone with `@Body('phone')` and no validation at all, so `{}` reached the SMS layer as
 * `undefined` and crashed with an HTTP 500 — found by the Group 8 route sweep. The rule matches
 * RegisterDto / VerifyOtpDto (Egyptian mobile number).
 */
export class LoginDto {
  @IsPhoneNumber('EG')
  phone: string;
}
