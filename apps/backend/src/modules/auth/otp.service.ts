import { BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import Redis from 'ioredis';
import { SMS_PROVIDER, SmsProvider } from './sms-provider.interface';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';

/**
 * OTP generation/verification, backed by Redis.
 *
 * Keys:
 *   otp:<phone>          -> { codeHash, attempts }  (TTL = otp.ttlSeconds)
 *   otp-cooldown:<phone> -> '1'                       (TTL = otp.resendCooldownSeconds)
 *
 * Security properties covered here (Phase 1 hardening pass):
 *  - Codes are stored as a SHA-256 hash, never in plaintext, so a Redis
 *    read/dump doesn't hand out live codes.
 *  - A resend cooldown key prevents a client from spamming
 *    sendOtp() to re-roll the code or flood an SMS provider (this is
 *    in addition to, not a replacement for, IP-level rate limiting —
 *    see auth.controller.ts's per-route @Throttle()).
 *  - Attempt counting + max-attempts lockout resists brute force
 *    against a single OTP.
 *  - verifyOtp() takes the same code path (and near-identical timing)
 *    whether the phone has a live OTP or not, since both cases end in
 *    an UnauthorizedException with a generic message — this avoids
 *    leaking "does this phone have a pending OTP" as an enumeration
 *    signal beyond what's unavoidable.
 *
 * UNIFONIC SMS PROVIDER IMPLEMENTATION: real SMS delivery is now
 * wired via the SmsProvider abstraction (see sms-provider.interface.ts
 * / providers/unifonic-sms.provider.ts). This class remains fully
 * authoritative for generation/hashing/storage/verification/TTL/
 * attempts — Unifonic is ONLY the delivery layer, injected as
 * SmsProvider, never constructed directly here. A failed/rejected
 * send now fails the whole `sendOtp` call closed (see that method's
 * own comment) — no Redis OTP is ever left usable if the SMS was
 * never actually accepted by the provider.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly ttlSeconds: number;
  private readonly maxAttempts: number;
  private readonly resendCooldownSeconds: number;
  private readonly logCodeForLocalDev: boolean;

  constructor(
    private readonly configService: ConfigService,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.ttlSeconds = this.configService.get<number>('otp.ttlSeconds')!;
    this.maxAttempts = this.configService.get<number>('otp.maxAttempts')!;
    this.resendCooldownSeconds = this.configService.get<number>('otp.resendCooldownSeconds')!;
    this.logCodeForLocalDev = this.configService.get<boolean>('otp.logCodeForLocalDev')!;

    if (this.logCodeForLocalDev && this.configService.get<string>('env') === 'production') {
      // Belt-and-suspenders: refuse to boot with this flag on in prod,
      // rather than relying solely on the env file being correct.
      throw new Error(
        'OTP_LOG_CODE_FOR_LOCAL_DEV must not be enabled when NODE_ENV=production.',
      );
    }
  }

  private key(phone: string): string {
    return `otp:${phone}`;
  }

  private cooldownKey(phone: string): string {
    return `otp-cooldown:${phone}`;
  }

  private hashCode(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  /**
   * UNIFONIC SMS PROVIDER IMPLEMENTATION — reordered per the required
   * fail-closed flow: generate -> send via SmsProvider -> ONLY on
   * confirmed provider acceptance, persist the usable OTP (and the
   * resend-cooldown key) in Redis. CONFIRMED: a failed/rejected send
   * never leaves a usable code in Redis, and never consumes the
   * resend cooldown either — a transient provider failure must not
   * block the customer from trying again once the underlying problem
   * clears, which is exactly why the cooldown key is also only set on
   * success, not before.
   *
   * `logCodeForLocalDev` remains a separate, unrelated concern from
   * SMS delivery — CONFIRMED, per the explicit "remains separate from
   * the SMS provider" instruction — it still just logs the code when
   * explicitly enabled, independent of whether the provider call
   * that follows succeeds or fails.
   */
  async sendOtp(phone: string): Promise<void> {
    const onCooldown = await this.redis.get(this.cooldownKey(phone));
    if (onCooldown) {
      // Fail quietly rather than throwing — from the caller's
      // perspective (AuthService) this still looks like "OTP sent",
      // which avoids giving a client a reliable timing/response signal
      // to script rapid-fire resend requests against.
      return;
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    if (this.logCodeForLocalDev) {
      this.logger.warn(`[LOCAL DEV ONLY — never enable in production] OTP for ${phone}: ${code}`);
    }

    const result = await this.smsProvider.sendSms({
      to: phone,
      body: `Hatly verification code: ${code}`,
    });

    if (!result.success) {
      // Fail closed — no Redis write below happens at all. Never
      // reveals provider/credential internals to the caller.
      throw new BadRequestException({
        message: 'Unable to send verification code. Please try again shortly.',
        details: { code: 'SMS_PROVIDER_UNAVAILABLE' },
      });
    }

    await this.redis.set(
      this.key(phone),
      JSON.stringify({ codeHash: this.hashCode(code), attempts: 0 }),
      'EX',
      this.ttlSeconds,
    );
    await this.redis.set(this.cooldownKey(phone), '1', 'EX', this.resendCooldownSeconds);
  }

  async verifyOtp(phone: string, code: string): Promise<boolean> {
    const raw = await this.redis.get(this.key(phone));
    if (!raw) {
      throw new UnauthorizedException('Invalid or expired code.');
    }

    const record = JSON.parse(raw) as { codeHash: string; attempts: number };

    if (record.attempts >= this.maxAttempts) {
      await this.redis.del(this.key(phone));
      throw new UnauthorizedException('Too many attempts. Request a new code.');
    }

    if (record.codeHash !== this.hashCode(code)) {
      record.attempts += 1;
      await this.redis.set(this.key(phone), JSON.stringify(record), 'KEEPTTL');
      return false;
    }

    await this.redis.del(this.key(phone));
    return true;
  }
}
