import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';

/**
 * Per-ACCOUNT brake on password guessing (M5 Batch 4).
 *
 * The per-route @Throttle on the password-login routes limits one IP. An attacker rotating IPs (or a botnet) is not slowed down
 * by that, and every guess costs a bcrypt comparison (deliberately CPU-expensive). This counts FAILED attempts per phone number
 * regardless of source: after MAX_FAILURES within the window, further attempts for that phone are refused with a 429 BEFORE any
 * password hashing happens, until the window ends. A successful login clears the counter.
 *
 * Deliberately generic: unknown phones are counted too (so the 429 never reveals whether an account exists) and the lock is
 * short, so an attacker can at worst delay a victim's sign-in by minutes — never lock them out for good. Fails OPEN if Redis is
 * unavailable (sign-in already needs Redis for its tokens; this must not add a second way to fail).
 */
export const LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60;
export const LOGIN_MAX_FAILURES = 10;

const KEY = (phone: string) => `login-fail:${phone}`;

@Injectable()
export class LoginAttemptLimiter {
  private readonly logger = new Logger(LoginAttemptLimiter.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Throws a 429 if this phone has used up its failed-attempt budget. */
  async assertAllowed(phone: string): Promise<void> {
    let failures = 0;
    try {
      failures = Number(await this.redis.get(KEY(phone))) || 0;
    } catch (error) {
      this.logger.error(`Login attempt limiter unavailable (${(error as Error).message}); not enforcing.`);
      return;
    }
    if (failures >= LOGIN_MAX_FAILURES) {
      let retryAfter = LOGIN_FAILURE_WINDOW_SECONDS;
      try {
        const ttl = await this.redis.ttl(KEY(phone));
        if (ttl > 0) retryAfter = ttl;
      } catch {
        /* keep the full window */
      }
      throw new HttpException({ message: 'Too many failed sign-in attempts. Please try again later.', details: { code: 'TOO_MANY_FAILED_LOGINS', retryAfterSeconds: retryAfter } }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async recordFailure(phone: string): Promise<void> {
    try {
      const count = await this.redis.incr(KEY(phone));
      if (count === 1) await this.redis.expire(KEY(phone), LOGIN_FAILURE_WINDOW_SECONDS);
    } catch (error) {
      this.logger.error(`Login attempt limiter unavailable (${(error as Error).message}); failure not recorded.`);
    }
  }

  async clear(phone: string): Promise<void> {
    try {
      await this.redis.del(KEY(phone));
    } catch {
      /* the counter expires on its own */
    }
  }
}
