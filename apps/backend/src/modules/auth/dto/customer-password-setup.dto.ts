import { IsString, MinLength } from 'class-validator';

/**
 * Customer Authentication Modes (master implementation). Authenticated
 * password setup/change — the caller's identity comes exclusively from
 * the authenticated session (@CurrentUser()), never from this body, so
 * no phone/userId field exists here at all.
 *
 * No `currentPassword` field: this codebase has no existing "change
 * password with current-password verification" convention anywhere
 * (Driver/Vendor/Admin have never had a self-service change-password
 * flow) — inventing one here would be new complexity not required by
 * the approved design, and would not even make sense for the Case C/D
 * "establishing a first password" scenario, where no current password
 * exists to verify. The authenticated session itself is the proof of
 * identity, matching this codebase's own established convention for
 * every other "act on your own account" operation (e.g. Vendor
 * Staff/Vendor Product self-service actions).
 */
export class CustomerPasswordSetupDto {
  @IsString()
  @MinLength(8)
  password: string;
}
