import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';

/**
 * Tracks which refresh-token jti is currently valid per user, in Redis.
 *
 * Rotation/revocation strategy (Phase 1 hardening):
 *  - Every issued refresh token carries a unique `jti` claim.
 *  - The store only ever remembers the CURRENT jti per user
 *    (key: refresh-jti:<userId>), with a TTL matching the refresh
 *    token's own expiry.
 *  - On every successful `/auth/refresh` call, the old jti is
 *    consumed (deleted) and a new one is issued and stored — this is
 *    "rotation": a refresh token can only ever be used once.
 *  - If a refresh token is presented whose jti does NOT match the
 *    stored value (either because it was already rotated away, or
 *    because the session was explicitly revoked), the request is
 *    rejected. In a fuller implementation this mismatch would also
 *    trigger revoking all of that user's sessions, since token reuse
 *    is a signal of a stolen/replayed refresh token — left as a
 *    documented next step rather than built now, to keep Phase 1 scope
 *    to single-session rotation.
 *  - `revoke(userId)` supports an explicit logout / "log out other
 *    devices" action later.
 *
 * V1 scope note: this stores a single active jti per user, i.e. one
 * active session per user. Multi-device/multi-session support (one
 * jti per device) is a straightforward extension — key by
 * `refresh-jti:<userId>:<deviceId>` instead — but isn't needed yet and
 * isn't built speculatively.
 */
@Injectable()
export class RefreshTokenStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(userId: string): string {
    return `refresh-jti:${userId}`;
  }

  async issue(userId: string, ttlSeconds: number): Promise<string> {
    const jti = randomUUID();
    await this.redis.set(this.key(userId), jti, 'EX', ttlSeconds);
    return jti;
  }

  async consume(userId: string, presentedJti: string): Promise<boolean> {
    const currentJti = await this.redis.get(this.key(userId));
    if (!currentJti || currentJti !== presentedJti) {
      return false;
    }
    await this.redis.del(this.key(userId));
    return true;
  }

  async revoke(userId: string): Promise<void> {
    await this.redis.del(this.key(userId));
  }
}
