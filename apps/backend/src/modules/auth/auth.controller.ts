import { Body, Controller, Get, HttpCode, HttpStatus, Post, Patch, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { DriverLoginDto } from './dto/driver-login.dto';
import { PasswordLoginDto } from './dto/password-login.dto';
import { CustomerPasswordLoginDto } from './dto/customer-password-login.dto';
import { CustomerPasswordRegisterDto } from './dto/customer-password-register.dto';
import { CustomerPasswordSetupDto } from './dto/customer-password-setup.dto';
import { VerifyPhoneOtpDto } from './dto/verify-phone-otp.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Stricter-than-global throttling on every OTP-triggering endpoint
   * (register/login), on top of OtpService's own resend cooldown and
   * attempt-limit logic — defense in depth against brute force / SMS-
   * flooding, per this hardening pass item 2. The global ThrottlerGuard
   * (100 req/60s, app.module.ts) still applies to everything else.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(@Body() dto: RegisterDto) {
    await this.authService.requestRegistrationOtp(dto.phone, dto.fullName);
    return { message: 'If eligible, a verification code has been sent.' };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    await this.authService.requestLoginOtp(dto.phone);
    // Same message regardless of whether an account exists — see
    // AuthService.requestLoginOtp for the enumeration-safety rationale.
    return { message: 'If eligible, a verification code has been sent.' };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    const tokens = await this.authService.verifyOtpAndIssueTokens(dto.phone, dto.code);
    return { data: tokens };
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
  async passwordLogin(@Body() dto: PasswordLoginDto) {
    const tokens = await this.authService.loginStaffWithPassword(dto.phone, dto.password);
    return { data: tokens };
  }

  // Refresh is public (the access token has expired) and rotates a single-use token — keep it well below the global 100/min.
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto) {
    const tokens = await this.authService.refresh(dto.refreshToken);
    return { data: tokens };
  }

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
   * Customer password registration AND the Case C/D passwordless-row
   * attachment flow — the SAME endpoint/service method, per the
   * approved design (see AuthService.registerOrAttachCustomerPassword's
   * own doc comment for the full security rule). Same throttle as the
   * OTP `register` endpoint above.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('customer/password/register')
  @HttpCode(HttpStatus.OK)
  async customerPasswordRegister(@Body() dto: CustomerPasswordRegisterDto) {
    const tokens = await this.authService.registerOrAttachCustomerPassword(dto.phone, dto.fullName, dto.password);
    return { data: tokens };
  }

  /**
   * Authenticated password setup/change — no @Public(), so the global
   * auth guard requires a valid session; `@CurrentUser()` is the sole
   * source of identity, never a body field.
   */
  @Patch('customer/password')
  @HttpCode(HttpStatus.OK)
  async customerPasswordSetup(@CurrentUser() user: AuthenticatedUser, @Body() dto: CustomerPasswordSetupDto) {
    await this.authService.setCustomerPassword(user.id, dto.password);
    return { message: 'Password updated.' };
  }

  /**
   * Authenticated, post-login, non-blocking phone verification
   * (Section 12). No @Public() on either endpoint — the phone is
   * always the authenticated caller's own, resolved server-side.
   */
  @Post('customer/verify-phone/request')
  @HttpCode(HttpStatus.OK)
  async requestPhoneVerification(@CurrentUser() user: AuthenticatedUser) {
    await this.authService.requestPhoneVerificationOtp(user.id);
    return { message: 'If eligible, a verification code has been sent.' };
  }

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
  @Get('customer/me')
  @HttpCode(HttpStatus.OK)
  async me(@CurrentUser() user: AuthenticatedUser) {
    const isPhoneVerified = await this.authService.getIsPhoneVerified(user.id);
    return { data: { isPhoneVerified } };
  }
}
