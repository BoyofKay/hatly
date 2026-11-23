import { BadRequestException, ForbiddenException, GoneException, Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
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
import { LoginAttemptLimiter } from './login-attempt-limiter';
import { MFA_ROLES, StaffMfaService } from './mfa/staff-mfa.service';
import { assertStrongStaffPassword } from '../admin-platform/staff/staff-password-policy';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** True when the account signed in with a temporary password set by Hatly staff: the app must ask for a new one first. */
  mustChangePassword?: boolean;
}

/** Mirrors the DTO's `@MinLength(8)` — the account-creation path re-checks it so no passwordless account can slip through. */
const MIN_CUSTOMER_PASSWORD_LENGTH = 8;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly otpService: OtpService,
    private readonly refreshTokenStore: RefreshTokenStore,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly businessConfigService: BusinessConfigService,
    private readonly loginAttemptLimiter: LoginAttemptLimiter,
    @Optional() private readonly staffMfa?: StaffMfaService,
  ) {}

  /**
   * THE CUSTOMER AUTH CONTRACT (do not weaken):
   *  - Every persistent customer account has a PASSWORD, set when it is created (`registerCustomerWithPassword`). Guests who
   *    only browse have no account; checkout needs an account, which is created with a password.
   *  - Normal sign-in is phone + password. A one-time code is NEVER a way to sign in, and never creates an account or attaches/
   *    replaces a password on its own.
   *  - OTP is only for PHONE VERIFICATION, and only while `CUSTOMER_OTP_ENABLED` is on:
   *      · registration — the code proves the caller owns the phone BEFORE the account exists (`requestRegistrationCode`, then
   *        `registerCustomerWithPassword` with that code), so a phone cannot be registered by someone who does not hold it;
   *      · later — a signed-in customer whose phone is still unverified asks for a code to their OWN phone and confirms it
   *        (`requestPhoneVerificationOtp` / `verifyPhoneOtp`).
   *    With OTP off no SMS is needed; the account works with phone + password and the phone stays unverified until a real proof.
   */

  /** The `CUSTOMER_OTP_ENABLED` gate (existing BusinessConfig setting). */
  private async assertOtpEnabled(message: string): Promise<void> {
    if (!(await this.businessConfigService.isCustomerOtpEnabled())) {
      throw new BadRequestException({ message, details: { code: 'CUSTOMER_OTP_DISABLED' } });
    }
  }

  /**
   * RETIRED legacy OTP registration (`POST auth/register`). It used to create a passwordless customer and text a code that
   * `auth/otp/verify` exchanged for a session — a kind of account the product no longer has. It now never creates anything,
   * never sends an SMS and never issues a session:
   *  - OTP off  -> the SAME `CUSTOMER_OTP_DISABLED` answer as before. Older apps treat it as "use the password form", so they
   *               keep working with phone + password while OTP is off;
   *  - OTP on   -> 410 `LEGACY_OTP_REGISTRATION_RETIRED`: an older app that only knows OTP registration must be updated to
   *               register with a password.
   */
  async rejectLegacyOtpRegistration(): Promise<never> {
    await this.assertOtpEnabled('OTP authentication is currently unavailable. Please use password sign-in.');
    throw new GoneException({
      message: 'OTP registration has been retired. Update the app and register with your phone number and a password.',
      details: { code: 'LEGACY_OTP_REGISTRATION_RETIRED' },
    });
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
        // Pin the algorithm: only the HS256 tokens this service issues are accepted (no `none`/algorithm-confusion).
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    if (!payload.jti) {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    // Atomic rotation + reuse detection (see RefreshTokenStore). The successor jti is minted here so the swap is one Redis step.
    const successorJti = randomUUID();
    const outcome = await this.refreshTokenStore.rotate(payload.sub, payload.jti, this.refreshTtlSeconds(), successorJti);
    if (outcome.status === 'REUSED') {
      // A refresh token that was ALREADY rotated away was presented again: treat as theft/replay. The store has already revoked
      // this user's session; only the user id is logged — never a token, its jti, or any claim.
      this.logger.warn(JSON.stringify({ event: 'auth.refresh_token_reuse_detected', userId: payload.sub }));
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }
    if (outcome.status !== 'ROTATED') {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.isActive) {
      await this.refreshTokenStore.revoke(payload.sub);
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    return this.issueTokens(user, successorJti);
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
  private async authenticateWithPassword(
    phone: string,
    password: string,
    allowedRoles: Role[],
    /** Runs after the password is proven and before any token exists — the place for a second factor. May throw. */
    secondFactor?: (user: User) => Promise<void>,
  ): Promise<TokenPair> {
    // Per-account failed-attempt brake: refused BEFORE any password hashing, whatever IP the guesses come from.
    await this.loginAttemptLimiter.assertAllowed(phone);

    const user = await this.usersService.findByPhoneWithPasswordHash(phone);
    if (!user || !allowedRoles.includes(user.role) || !user.isActive || !user.passwordHash) {
      await this.loginAttemptLimiter.recordFailure(phone); // unknown phones count too: the 429 must not reveal account existence
      throw new UnauthorizedException('Invalid credentials.');
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      await this.loginAttemptLimiter.recordFailure(phone);
      throw new UnauthorizedException('Invalid credentials.');
    }

    if (secondFactor) await secondFactor(user);
    await this.loginAttemptLimiter.clear(phone);
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
  async loginStaffWithPassword(phone: string, password: string, options: { mfaCode?: string; ip?: string } = {}): Promise<TokenPair> {
    return this.authenticateWithPassword(phone, password, [Role.VENDOR, Role.VENDOR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN], async (user) => {
      // Second factor: an admin with an authenticator can NOT get tokens from the password alone — through ANY staff sign-in route
      // (this method backs both `auth/password/login` and `auth/dashboard/login`), so the legacy route cannot be used to skip it.
      if (!this.staffMfa || !MFA_ROLES.includes(user.role) || !(await this.staffMfa.isEnabledFresh(user.id))) return;
      if (!options.mfaCode) {
        throw new UnauthorizedException({ message: 'A verification code is required.', details: { code: 'MFA_REQUIRED' } });
      }
      await this.staffMfa.verifyLoginCode(user, options.mfaCode, options.ip);
    });
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
   * Step 1 of registration while `CUSTOMER_OTP_ENABLED` is on: texts a one-time code to the phone being registered.
   *
   *  - OTP off      -> 400 `CUSTOMER_OTP_DISABLED` (the app then registers with a password alone; the phone stays unverified);
   *  - phone already has an account -> NOTHING is sent, yet the caller gets the same answer as for a fresh phone, so the route
   *                    cannot be used to find out which numbers are registered;
   *  - SMS provider down -> also the same uniform answer (fail closed: no code is stored, so nothing can be verified; the
   *                    customer simply requests again). The failure is logged for operators.
   * Throttling: 5/min per client (controller) + the per-phone resend cooldown and attempt limits inside `OtpService`.
   */
  async requestRegistrationCode(phone: string): Promise<void> {
    await this.assertOtpEnabled('Phone verification is currently unavailable. You can register with your phone number and a password.');
    if (await this.usersService.findByPhone(phone)) return;
    try {
      await this.otpService.sendOtp(phone);
    } catch (error) {
      const code = (error as { getResponse?: () => { details?: { code?: string } } })?.getResponse?.()?.details?.code;
      if (code !== 'SMS_PROVIDER_UNAVAILABLE') throw error;
      this.logger.error('Registration code could not be sent: the SMS provider is unavailable.');
    }
  }

  /**
   * Customer registration — the one place a customer account is created, and always WITH a password. SECURITY CONTRACT:
   *
   *  - `CUSTOMER_OTP_ENABLED` ON: a valid one-time `code` for this phone (from `requestRegistrationCode`) is REQUIRED and is
   *    consumed BEFORE anything is written, so the caller has proven they hold the phone. The account is then created with the
   *    phone VERIFIED — decided here, never by the client. Missing code -> 400 `PHONE_VERIFICATION_REQUIRED`; wrong/expired/
   *    used code -> 401, the same answer whether or not the phone already has an account.
   *  - `CUSTOMER_OTP_ENABLED` OFF: no SMS and no code; the account is created with the phone UNVERIFIED (a supplied `code` is
   *    ignored, never trusted). Nothing about verification is fabricated.
   *  - no account for this phone  -> create a CUSTOMER with this password (bcrypt) and issue a session;
   *  - ANY existing account       -> REJECT with one generic failure, whatever it is. Registration NEVER sets or changes the
   *                                  password of an existing account, so knowing a phone number is never enough to take it
   *                                  over, and the response does not reveal which case applied.
   *
   * A missing/short password is rejected at the HTTP edge (DTO) and again here, so a passwordless account can never be created
   * by mistake.
   *
   * ORDER matters: every step that needs Redis (the code check and the refresh-token jti) happens BEFORE the database insert, so
   * a Redis outage fails the request with nothing persisted — a retry is a clean retry, never a 401 for an account the client
   * never received a session for. After the insert only local work (signing the JWTs) remains. If the insert itself loses a
   * race (unique phone), the jti stored for the never-created id is revoked best-effort and otherwise expires with its TTL.
   */
  async registerCustomerWithPassword(phone: string, fullName: string, password: string, code?: string): Promise<TokenPair> {
    if (typeof password !== 'string' || password.length < MIN_CUSTOMER_PASSWORD_LENGTH) {
      throw new BadRequestException({ message: 'A password of at least 8 characters is required.', details: { code: 'PASSWORD_REQUIRED' } });
    }

    let phoneVerified = false;
    if (await this.businessConfigService.isCustomerOtpEnabled()) {
      if (typeof code !== 'string' || code.length === 0) {
        throw new BadRequestException({
          message: 'Verify your phone number to register: request a code and enter it.',
          details: { code: 'PHONE_VERIFICATION_REQUIRED' },
        });
      }
      if (!(await this.otpService.verifyOtp(phone, code))) {
        throw new UnauthorizedException('Invalid or expired code.');
      }
      phoneVerified = true;
    }

    const existing = await this.usersService.findByPhoneWithPasswordHash(phone);
    if (existing) {
      throw new UnauthorizedException('Unable to complete registration.');
    }
    const passwordHash = await bcrypt.hash(password, 10);

    const id = randomUUID();
    const jti = await this.refreshTokenStore.issue(id, this.refreshTtlSeconds()); // Redis: before the irreversible write
    try {
      const user = await this.usersService.createCustomer({ id, phone, fullName, passwordHash, phoneVerified });
      return await this.issueTokens(user, jti);
    } catch (error) {
      await this.refreshTokenStore.revoke(id).catch(() => undefined); // nobody holds this session: no account was created
      // Two simultaneous registrations of the same phone: the unique index lets exactly one win; the other gets the same
      // generic refusal as any existing account (never a 500, never a second account).
      if ((error as { code?: string })?.code === '23505') {
        throw new UnauthorizedException('Unable to complete registration.');
      }
      throw error;
    }
  }

  /**
   * Authenticated password CHANGE. Identity comes from an already-verified session (`userId` from `@CurrentUser()`), but a
   * session alone is NOT enough to change a password — a stolen or left-open session must not lock the owner out:
   *
   *  - the CURRENT password is required and checked (bcrypt), under the same per-account failed-attempt brake as sign-in;
   *    missing -> 400 `CURRENT_PASSWORD_REQUIRED`, wrong -> 403 `CURRENT_PASSWORD_INVALID`;
   *  - an account with no password cannot exist under the product contract; if a leftover one is ever found it is refused
   *    (generic) rather than completed — a password is never attached by a session or by a one-time code.
   */
  /** A staff member changes their own password (dashboard profile). Requires the current password; the new one follows the staff rule. */
  async changeStaffPassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.usersService.findByIdWithPasswordHash(userId);
    const staff = [Role.VENDOR, Role.VENDOR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN];
    if (!user || !staff.includes(user.role) || !user.isActive || !user.passwordHash) throw new UnauthorizedException('Unable to update password.');
    assertStrongStaffPassword(newPassword);
    await this.loginAttemptLimiter.assertAllowed(user.phone);
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      await this.loginAttemptLimiter.recordFailure(user.phone);
      throw new ForbiddenException({ message: 'The current password is incorrect.', details: { code: 'CURRENT_PASSWORD_INVALID' } });
    }
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw new BadRequestException({ message: 'The new password must be different from the current one.', details: { code: 'PASSWORD_UNCHANGED' } });
    }
    await this.loginAttemptLimiter.clear(user.phone);
    await this.usersService.setPasswordHash(userId, await bcrypt.hash(newPassword, 10));
  }

  /** A driver changes their OWN password (required after a temporary one set by Operations). Same brute-force brake as sign-in. */
  /** Whether the account still has a temporary password (set by Hatly staff) that must be changed. */
  async mustChangePassword(userId: string): Promise<boolean> {
    return (await this.usersService.findById(userId))?.mustChangePassword === true;
  }

  async changeDriverPassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.usersService.findByIdWithPasswordHash(userId);
    if (!user || user.role !== Role.DRIVER || !user.isActive || !user.passwordHash) throw new UnauthorizedException('Unable to update password.');
    if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
      throw new BadRequestException({ message: 'The new password must be 8–128 characters.', details: { code: 'WEAK_PASSWORD' } });
    }
    await this.loginAttemptLimiter.assertAllowed(user.phone);
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      await this.loginAttemptLimiter.recordFailure(user.phone);
      throw new ForbiddenException({ message: 'The current password is incorrect.', details: { code: 'CURRENT_PASSWORD_INVALID' } });
    }
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw new BadRequestException({ message: 'The new password must be different from the current one.', details: { code: 'PASSWORD_UNCHANGED' } });
    }
    await this.loginAttemptLimiter.clear(user.phone);
    await this.usersService.setPasswordHash(userId, await bcrypt.hash(newPassword, 10));
  }

  async setCustomerPassword(userId: string, newPassword: string, currentPassword?: string): Promise<void> {
    const user = await this.usersService.findByIdWithPasswordHash(userId);
    if (!user || user.role !== Role.CUSTOMER || !user.isActive || !user.passwordHash) {
      throw new UnauthorizedException('Unable to update password.');
    }
    if (!currentPassword) {
      throw new BadRequestException({ message: 'Enter your current password to change it.', details: { code: 'CURRENT_PASSWORD_REQUIRED' } });
    }
    await this.loginAttemptLimiter.assertAllowed(user.phone);
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      await this.loginAttemptLimiter.recordFailure(user.phone);
      throw new ForbiddenException({ message: 'The current password is incorrect.', details: { code: 'CURRENT_PASSWORD_INVALID' } });
    }
    if (user.mustChangePassword && (await bcrypt.compare(newPassword, user.passwordHash))) {
      throw new BadRequestException({ message: 'The new password must be different from the temporary one.', details: { code: 'PASSWORD_UNCHANGED' } });
    }
    await this.loginAttemptLimiter.clear(user.phone);
    await this.usersService.setPasswordHash(userId, await bcrypt.hash(newPassword, 10));
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

  /**
   * `GET auth/customer/me`: whether the phone is verified AND whether verifying it is possible right now (`CUSTOMER_OTP_ENABLED`).
   * The app needs the second part to avoid inviting an unverified customer to "verify your phone" while OTP is off — an
   * instruction that cannot be followed. `phoneVerificationAvailable` says nothing about whether the phone IS verified: with OTP
   * off an unverified phone simply stays unverified.
   */
  async getPhoneVerificationStatus(userId: string): Promise<{ isPhoneVerified: boolean; phoneVerificationAvailable: boolean }> {
    const isPhoneVerified = await this.getIsPhoneVerified(userId);
    return { isPhoneVerified, phoneVerificationAvailable: await this.businessConfigService.isCustomerOtpEnabled() };
  }

  private refreshTtlSeconds(): number {
    return Math.floor(ms(this.configService.get<string>('auth.refreshExpiresIn')!) / 1000);
  }

  /** `presetJti`: the already-stored successor jti from a refresh rotation; absent for a fresh login (which stores a new one). */
  private async issueTokens(user: User, presetJti?: string): Promise<TokenPair> {
    const refreshExpiresIn = this.configService.get<string>('auth.refreshExpiresIn')!;
    const jti = presetJti ?? (await this.refreshTokenStore.issue(user.id, this.refreshTtlSeconds()));

    // `pwc`: signed in with a temporary password — JwtStrategy then allows only the password-change routes until it is changed.
    const mustChangePassword = user.mustChangePassword === true;
    const basePayload = { sub: user.id, role: user.role, phone: user.phone, ...(mustChangePassword ? { pwc: true } : {}) };

    const accessToken = this.jwtService.sign(basePayload, {
      secret: this.configService.get<string>('auth.accessSecret'),
      expiresIn: this.configService.get<string>('auth.accessExpiresIn'),
      algorithm: 'HS256',
    });

    const refreshToken = this.jwtService.sign(
      { ...basePayload, jti },
      {
        secret: this.configService.get<string>('auth.refreshSecret'),
        expiresIn: refreshExpiresIn,
        algorithm: 'HS256',
      },
    );

    return { accessToken, refreshToken, ...(mustChangePassword ? { mustChangePassword: true } : {}) };
  }
}
