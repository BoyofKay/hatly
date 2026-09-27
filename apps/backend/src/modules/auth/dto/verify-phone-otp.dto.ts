import { IsString } from 'class-validator';

/**
 * Customer Authentication Modes (master implementation). Authenticated
 * post-login phone-verification confirm — no `phone` field: the OTP is
 * always checked against the AUTHENTICATED caller's own phone
 * (resolved server-side from @CurrentUser(), never client-supplied),
 * which is the exact "smallest safe adjustment" that prevents an
 * authenticated caller from verifying a phone number that isn't their
 * own.
 */
export class VerifyPhoneOtpDto {
  @IsString()
  code: string;
}
