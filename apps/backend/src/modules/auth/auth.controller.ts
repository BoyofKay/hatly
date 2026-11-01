import { Body, Controller, Get, HttpCode, HttpStatus, Post, Patch, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AllowWithoutMfa } from '../../common/decorators/csrf-mfa.decorators';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { AccountDeletionService } from './account-deletion.service';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { DriverLoginDto } from './dto/driver-login.dto';
import { PasswordLoginDto } from './dto/password-login.dto';
import { CustomerPasswordLoginDto } from './dto/customer-password-login.dto';
import { CustomerPasswordRegisterDto } from './dto/customer-password-register.dto';
import { CustomerRegistrationCodeRequestDto } from './dto/customer-registration-code-request.dto';
import { CustomerPasswordSetupDto } from './dto/customer-password-setup.dto';
import { VerifyPhoneOtpDto } from './dto/verify-phone-otp.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly accountDeletion: AccountDeletionService,
  ) {}

  /**
   * RETIRED legacy OTP registration — kept ONLY so older apps get a clear answer instead of a 404 (see
   * `AuthService.rejectLegacyOtpRegistration`). It never creates an account, sends an SMS or issues a session. The OTP sign-in
   * request (`auth/login`) and code exchange (`auth/otp/verify`) were removed: a one-time code is no longer a way to sign in.
   * Customers register and sign in with phone + password (`customer/password/*`) and verify a phone through the authenticated
   * `customer/verify-phone/*` endpoints. Throttling is unchanged.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(@Body() _dto: RegisterDto) {
    return this.authService.rejectLegacyOtpRegistration();
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('driver/login')
  @HttpCode(HttpStatus.OK)
  async driverLogin(@Body() dto: DriverLoginDto) {
    const tokens = await this.authService.loginDriverWithPassword(dto.phone, dto.password);
    return { data: tokens };
  }

  /**
   * PHASE I-B, CHUNK 9 addition. Reuses the same Public + throttle
   * convention as `driver/login`. Dashboard's shared Vendor/Admin
   * login now calls this exclusively — the old OTP-based dashboard
   * login path (`login`/`otp/verify`) remains untouched for Customer,
   * which still uses it unchanged.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('password/login')
  @HttpCode(HttpStatus.OK)
  async passwordLogin(@Body() dto: PasswordLoginDto, @Req() req: Request) {
    const tokens = await this.authService.loginStaffWithPassword(dto.phone, dto.password, { mfaCode: dto.mfaCode, ip: req.ip });
    return { data: tokens };
  }

  // Refresh is public (the access token has expired) and rotates a single-use token — keep it well below the global 100/min.
  @Public()
  @AllowWithoutMfa()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto) {
    const tokens = await this.authService.refresh(dto.refreshToken);
    return { data: tokens };
  }

  @AllowWithoutMfa()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() user: AuthenticatedUser) {
    await this.authService.logout(user.id);
    return { message: 'Logged out.' };
  }

  // ==========================================================
  // Customer Authentication Modes (master implementation) — MODE B
  // ==========================================================

  /**
   * Customer-only password login (MODE B). Same Public + throttle
   * convention as `password/login` (the staff path) — deliberately a
   * separate endpoint/DTO so the staff route's allowed-role list is
   * never touched by this work.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('customer/password/login')
  @HttpCode(HttpStatus.OK)
  async customerPasswordLogin(@Body() dto: CustomerPasswordLoginDto) {
    const tokens = await this.authService.loginCustomerWithPassword(dto.phone, dto.password);
    return { data: tokens };
  }

  /**
   * Registration step 1 while `CUSTOMER_OTP_ENABLED` is on: texts a code to the phone being registered (400
   * `CUSTOMER_OTP_DISABLED` when OTP is off — the app then registers with a password alone). Same answer for every phone,
   * registered or not (see `AuthService.requestRegistrationCode`).
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('customer/register/request-code')
  @HttpCode(HttpStatus.OK)
  async customerRegistrationCode(@Body() dto: CustomerRegistrationCodeRequestDto) {
    await this.authService.requestRegistrationCode(dto.phone);
    return { message: 'If eligible, a verification code has been sent.' };
  }

  /**
   * Customer registration — always WITH a password (the DTO requires it). Creates an account only for a phone that has none;
   * for ANY existing account it answers with one generic 401 and changes nothing (see `AuthService.registerCustomerWithPassword`)
   * — it never attaches or overwrites a password. While OTP is on it also requires the `code` from `customer/register/request-code`
   * (proof of phone ownership before the account exists) and the account is then created phone-verified; with OTP off no code
   * is needed and the phone stays unverified.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('customer/password/register')
  @HttpCode(HttpStatus.OK)
  async customerPasswordRegister(@Body() dto: CustomerPasswordRegisterDto) {
    const tokens = await this.authService.registerCustomerWithPassword(dto.phone, dto.fullName, dto.password, dto.code);
    return { data: tokens };
  }

  /**
   * Authenticated password setup/change — no @Public(), so the global
   * auth guard requires a valid session; `@CurrentUser()` is the sole
   * source of identity, never a body field. A session alone does not change
   * an EXISTING password: `currentPassword` is required for an account that
   * has one (see AuthService.setCustomerPassword).
   */
  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER) // customer-scoped: a vendor/driver/admin token has no business here
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // guesses the current password: brute-force surface
  @Patch('customer/password')
  @HttpCode(HttpStatus.OK)
  async customerPasswordSetup(@CurrentUser() user: AuthenticatedUser, @Body() dto: CustomerPasswordSetupDto) {
    await this.authService.setCustomerPassword(user.id, dto.password, dto.currentPassword);
    return { message: 'Password updated.' };
  }

  /**
   * Launch-readiness (App Store 5.1.1(v) / Google Play account-deletion policy): the signed-in customer deletes their OWN account. The
   * identity is the token's, never a body field; the password is re-entered; see AccountDeletionService for exactly what is erased and kept.
   */
  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER)
  @Throttle({ default: { limit: 3, ttl: 60_000 } }) // irreversible and password-guessing: very low ceiling
  @Post('customer/delete-account')
  @HttpCode(HttpStatus.OK)
  async deleteCustomerAccount(@CurrentUser() user: AuthenticatedUser, @Body() dto: DeleteAccountDto, @Req() req: Request) {
    await this.accountDeletion.deleteCustomerAccount(user.id, dto.password, req.ip);
    return { message: 'Your account has been deleted.' };
  }

  /**
   * Authenticated, post-login, non-blocking phone verification
   * (Section 12). No @Public() on either endpoint — the phone is
   * always the authenticated caller's own, resolved server-side.
   */
  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER) // customer-scoped: a vendor/driver/admin token has no business here
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // sends an SMS: cost and abuse surface
  @Post('customer/verify-phone/request')
  @HttpCode(HttpStatus.OK)
  async requestPhoneVerification(@CurrentUser() user: AuthenticatedUser) {
    await this.authService.requestPhoneVerificationOtp(user.id);
    return { message: 'If eligible, a verification code has been sent.' };
  }

  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER) // customer-scoped: a vendor/driver/admin token has no business here
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) // guesses a one-time code
  @Post('customer/verify-phone/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmPhoneVerification(@CurrentUser() user: AuthenticatedUser, @Body() dto: VerifyPhoneOtpDto) {
    await this.authService.verifyPhoneOtp(user.id, dto.code);
    return { message: 'Phone verified.' };
  }

  /**
   * Customer Authentication Modes addition — minimal, integration-
   * necessity addition (not in the original endpoint list): without
   * this, the client has no way to know whether the authenticated
   * Customer is phone-verified at all (the JWT payload only ever
   * carried `sub`/`role`/`phone`, never `isPhoneVerified`, and no
   * "current user" endpoint existed anywhere in this backend before
   * this). Deliberately returns ONLY `isPhoneVerified` — not a full
   * profile — keeping this the smallest possible fix for the one
   * genuine gap it closes (the dismissible post-login verification
   * prompt, Section 12).
   */
  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER) // customer-scoped: a vendor/driver/admin token has no business here
  @Get('customer/me')
  @HttpCode(HttpStatus.OK)
  async me(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.authService.getPhoneVerificationStatus(user.id) };
  }
}
