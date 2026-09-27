import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import ms = require('ms');
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { OtpService } from './otp.service';
import { RefreshTokenStore } from './refresh-token.store';
import { User } from '../users/entities/user.entity';
import { Role } from '../../common/enums/role.enum';
import { BusinessConfigService } from '../business-config/business-config.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly otpService: OtpService,
    private readonly refreshTokenStore: RefreshTokenStore,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly businessConfigService: BusinessConfigService,
  ) {}

  /**
   * Customer Authentication Modes addition. The gate is checked FIRST
   * — before the existing user-creation/OTP-send logic below runs at
   * all, so OTP-OFF never creates a Redis OTP record and never
   * reaches OtpService (and, later, an SMS provider) in any way.
   * `CUSTOMER_OTP_DISABLED` is a GLOBAL system-state fact, not an
   * account-specific secret — revealing it does not weaken the
   * existing "do not reveal whether this phone has an account"
   * enumeration protection below, which is unrelated and unchanged.
   */
  async requestRegistrationOtp(phone: string, fullName: string): Promise<void> {
    if (!(await this.businessConfigService.isCustomerOtpEnabled())) {
      throw new BadRequestException({
        message: 'OTP authentication is currently unavailable. Please use password sign-in.',
        details: { code: 'CUSTOMER_OTP_DISABLED' },
      });
    }

    const existing = await this.usersService.findByPhone(phone);
    if (!existing) {
      await this.usersService.createCustomer({ phone, fullName });
    }
    await this.otpService.sendOtp(phone);
  }

  /**
   * Deliberately does NOT distinguish "no account for this phone" from
   * "OTP sent" in its response or error behavior — both return
   * successfully with an identical message. Revealing account
   * existence via a login endpoint is a classic enumeration vector
   * (spec section 16 / this hardening pass, item 2). If no account
   * exists, this is a silent no-op: no OTP is generated, no SMS
   * "would" be sent, but the caller can't tell that from the
   * response.
   */
  async requestLoginOtp(phone: string): Promise<void> {
    const user = await this.usersService.findByPhone(phone);
    if (!user) {
      return;
    }
    await this.otpService.sendOtp(phone);
  }

  async verifyOtpAndIssueTokens(phone: string, code: string): Promise<TokenPair> {
    const isValid = await this.otpService.verifyOtp(phone, code);
    if (!isValid) {
      throw new UnauthorizedException('Invalid code.');
    }

    const user = await this.usersService.findByPhone(phone);
    if (!user) {
      // Only reachable if a verified OTP existed for a phone with no
      // user record, which shouldn't happen given the register/login
      // flows above — but fail closed rather than issuing tokens for
      // a non-existent user.
      throw new UnauthorizedException('Invalid code.');
    }

    if (!user.isPhoneVerified) {
      await this.usersService.markPhoneVerified(user.id);
    }

    return this.issueTokens(user);
  }

  /**
   * Refresh token rotation: the presented token must match the single
   * jti currently on record for this user (RefreshTokenStore). A
   * successful refresh consumes that jti and issues a new one, so the
   * same refresh token can never be used twice — see
   * refresh-token.store.ts for the full rotation/revocation strategy
   * and its documented limitations.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: { sub: string; jti?: string };
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('auth.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    if (!payload.jti) {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    const consumed = await this.refreshTokenStore.consume(payload.sub, payload.jti);
    if (!consumed) {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    return this.issueTokens(user);
  }

  async logout(userId: string): Promise<void> {
    await this.refreshTokenStore.revoke(userId);
  }

  /**
   * PHASE I-B, CHUNK 9 refactor (Vendor Staff / Vendor Manager /
   * Admin password authentication). Extracted from the original
   * `loginDriverWithPassword` (Chunk 5) into a shared method — SAME
   * behavior, SAME generic-failure convention, now parameterized by
   * which roles are allowed. `loginDriverWithPassword` below is now a
   * thin wrapper calling this with `[Role.DRIVER]` — route, request
   * shape, and response shape all unchanged, confirmed by the
   * regression tests carried over from Chunk 5.
   *
   * `isActive` is now checked here — CONFIRMED new: the original
   * Driver-only method never checked it (a real, if minor, pre-
   * existing gap — `User.isActive` exists and defaults true, but
   * nothing ever read it at login). Checking it now applies uniformly
   * to every password-authenticated role, closing that gap rather
   * than leaving it Driver-specific.
   */
  private async authenticateWithPassword(phone: string, password: string, allowedRoles: Role[]): Promise<TokenPair> {
    const user = await this.usersService.findByPhoneWithPasswordHash(phone);
    if (!user || !allowedRoles.includes(user.role) || !user.isActive || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    return this.issueTokens(user);
  }

  /**
   * CONFIRMED (locked decision — do not reopen): Driver-only phone+
   * password login, never OTP. Route/behavior unchanged from Chunk 5.
   */
  async loginDriverWithPassword(phone: string, password: string): Promise<TokenPair> {
    return this.authenticateWithPassword(phone, password, [Role.DRIVER]);
  }

  /**
   * PHASE I-B, CHUNK 9 addition: the internal/staff password-login
   * path — VENDOR, VENDOR_MANAGER, ADMIN, SUPER_ADMIN. CUSTOMER is
   * deliberately excluded — the shared generic-failure message never
   * reveals that a phone belongs to a Customer account attempting
   * this endpoint versus any other rejection reason.
   */
  async loginStaffWithPassword(phone: string, password: string): Promise<TokenPair> {
    return this.authenticateWithPassword(phone, password, [
      Role.VENDOR,
      Role.VENDOR_MANAGER,
      Role.ADMIN,
      Role.SUPER_ADMIN,
    ]);
  }

  /**
   * Customer Authentication Modes addition (MODE B). Reuses the exact
   * same shared `authenticateWithPassword` helper as Driver/Staff —
   * same generic-failure message, same isActive check, same bcrypt
   * compare — scoped to `[Role.CUSTOMER]` only. Works regardless of
   * `isPhoneVerified` (Case A and Case B in the approved design are
   * treated identically here — verification status never gates
   * password login).
   */
  async loginCustomerWithPassword(phone: string, password: string): Promise<TokenPair> {
    return this.authenticateWithPassword(phone, password, [Role.CUSTOMER]);
  }

  /**
   * Customer Authentication Modes addition (MODE B registration +
   * Case C/D passwordless-row attachment — the SAME operation, per the
   * approved design: "equivalent to creating a new unverified Customer
   * during OTP-OFF mode"). CRITICAL SECURITY RULE, do not weaken:
   *
   *  - no existing row for this phone      -> create a new CUSTOMER
   *                                            with this password,
   *                                            isPhoneVerified=false
   *  - existing row, passwordHash IS NULL   -> attach this password to
   *                                            THAT row; isPhoneVerified
   *                                            is left completely
   *                                            untouched (Case C stays
   *                                            true if it already was)
   *  - existing row, passwordHash IS SET    -> REJECT, generically —
   *                                            this is the sole
   *                                            mechanism that prevents
   *                                            account takeover by
   *                                            anyone who knows another
   *                                            Customer's phone number.
   *                                            The failure is
   *                                            indistinguishable from
   *                                            any other rejection —
   *                                            it must never reveal
   *                                            "this account already
   *                                            has a password."
   *
   * This method NEVER calls `usersService.setPasswordHash` on a row
   * that already has one — that branch throws before any write.
   */
  async registerOrAttachCustomerPassword(phone: string, fullName: string, password: string): Promise<TokenPair> {
    const existing = await this.usersService.findByPhoneWithPasswordHash(phone);
    const passwordHash = await bcrypt.hash(password, 10);

    if (!existing) {
      const user = await this.usersService.createCustomer({ phone, fullName, passwordHash });
      return this.issueTokens(user);
    }

    if (existing.role !== Role.CUSTOMER || existing.passwordHash) {
      // Generic failure — indistinguishable from any other rejection.
      // Covers both "this phone belongs to a non-Customer role" (should
      // be structurally unreachable via this endpoint's own DTO, but
      // checked defensively) and "this Customer already has a
      // password" — the critical anti-takeover rule.
      throw new UnauthorizedException('Unable to complete registration.');
    }

    if (!existing.isActive) {
      throw new UnauthorizedException('Unable to complete registration.');
    }

    await this.usersService.setPasswordHash(existing.id, passwordHash);
    // isPhoneVerified is deliberately never read or written here —
    // Case C (already true) stays true, Case D (already false) stays
    // false. Re-fetch to get a full, correctly-typed User for
    // issueTokens (findByPhoneWithPasswordHash's own select list is a
    // narrow subset).
    const fullUser = await this.usersService.findById(existing.id);
    return this.issueTokens(fullUser!);
  }

  /**
   * Customer Authentication Modes addition. Authenticated password
   * setup/change (Section 8 of the approved design) — the caller's
   * identity comes from an already-verified session (`userId`
   * resolved from `@CurrentUser()` at the controller layer, never
   * client-supplied), so no phone lookup or ownership check is needed
   * here beyond confirming the account is still a CUSTOMER and active.
   * Never touches `isPhoneVerified` or phone ownership state.
   */
  async setCustomerPassword(userId: string, newPassword: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user || user.role !== Role.CUSTOMER || !user.isActive) {
      throw new UnauthorizedException('Unable to update password.');
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.usersService.setPasswordHash(userId, passwordHash);
  }

  /**
   * Customer Authentication Modes addition (Section 12 — post-login,
   * non-blocking phone verification). `userId` is resolved from
   * `@CurrentUser()` at the controller layer — the phone that receives
   * the OTP is ALWAYS the authenticated caller's own phone, read fresh
   * from the database, never accepted from the request body. This is
   * the "smallest safe adjustment" that prevents an authenticated
   * caller from requesting/consuming a verification code for a phone
   * number that isn't their own. Reuses `OtpService.sendOtp` verbatim
   * — same hashing/TTL/cooldown/throttle behavior as the registration
   * flow, no second OTP mechanism.
   *
   * ALSO gated by `CUSTOMER_OTP_ENABLED`: this is a separate check
   * from Section 13's registration-path gate (this action isn't a
   * login attempt), but the underlying reason is the same — if OTP
   * mode is off, real OTP delivery is presumed unavailable/unwanted,
   * so offering a "verify phone" action that would silently fail (or
   * attempt to send via an SMS path the operator has deliberately
   * turned off) is worse than declining it outright. Backend-
   * authoritative, not merely hidden client-side.
   */
  async requestPhoneVerificationOtp(userId: string): Promise<void> {
    if (!(await this.businessConfigService.isCustomerOtpEnabled())) {
      throw new BadRequestException({
        message: 'Phone verification is currently unavailable.',
        details: { code: 'CUSTOMER_OTP_DISABLED' },
      });
    }
    const user = await this.usersService.findById(userId);
    if (!user || user.role !== Role.CUSTOMER) {
      throw new UnauthorizedException('Unable to send verification code.');
    }
    await this.otpService.sendOtp(user.phone);
  }

  /**
   * Companion to `requestPhoneVerificationOtp` — same "always the
   * caller's own phone, never client-supplied" rule. On success, sets
   * `isPhoneVerified = true` for the authenticated user; on failure,
   * nothing is changed (the existing `OtpService.verifyOtp` attempt-
   * counting/lockout behavior is reused unmodified).
   */
  async verifyPhoneOtp(userId: string, code: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user || user.role !== Role.CUSTOMER) {
      throw new UnauthorizedException('Unable to verify phone.');
    }
    const isValid = await this.otpService.verifyOtp(user.phone, code);
    if (!isValid) {
      throw new UnauthorizedException('Invalid code.');
    }
    if (!user.isPhoneVerified) {
      await this.usersService.markPhoneVerified(user.id);
    }
  }

  /**
   * Customer Authentication Modes addition — backs `GET
   * auth/customer/me`. Deliberately returns just the boolean, not the
   * full `User` row — the controller never exposes anything beyond
   * what this method returns.
   */
  async getIsPhoneVerified(userId: string): Promise<boolean> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found.');
    }
    return user.isPhoneVerified;
  }

  private async issueTokens(user: User): Promise<TokenPair> {
    const refreshExpiresIn = this.configService.get<string>('auth.refreshExpiresIn')!;
    const refreshTtlSeconds = Math.floor(ms(refreshExpiresIn) / 1000);
    const jti = await this.refreshTokenStore.issue(user.id, refreshTtlSeconds);

    const basePayload = { sub: user.id, role: user.role, phone: user.phone };

    const accessToken = this.jwtService.sign(basePayload, {
      secret: this.configService.get<string>('auth.accessSecret'),
      expiresIn: this.configService.get<string>('auth.accessExpiresIn'),
    });

    const refreshToken = this.jwtService.sign(
      { ...basePayload, jti },
      {
        secret: this.configService.get<string>('auth.refreshSecret'),
        expiresIn: refreshExpiresIn,
      },
    );

    return { accessToken, refreshToken };
  }
}
