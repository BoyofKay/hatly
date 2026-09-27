import { IsIn, IsString } from 'class-validator';

/**
 * Driver Push Notifications. No `userId` field — the caller's
 * identity comes exclusively from the authenticated session
 * (@CurrentUser()), never from this body. This is the actual
 * mechanism that prevents a Driver from registering a token "on
 * behalf of" another Driver.
 */
export class RegisterDeviceTokenDto {
  @IsString()
  token: string;

  @IsIn(['ios', 'android'])
  platform: string;
}
