import { IsPhoneNumber, IsString } from 'class-validator';

/**
 * Customer Authentication Modes (master implementation). Customer-only
 * password login path — mirrors PasswordLoginDto's shape exactly, kept
 * as its own DTO/endpoint (not merged into PasswordLoginDto) so the
 * staff password-login route's role list is never touched by this
 * work, per the explicit "do not modify Vendor/Driver/Admin
 * authentication" instruction.
 */
export class CustomerPasswordLoginDto {
  @IsPhoneNumber('EG')
  phone: string;

  @IsString()
  password: string;
}
