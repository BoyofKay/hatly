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
 *    stored value, the request is rejected. M5 Batch 2 distinguishes two
 *    cases (see `rotate`): a jti that was ALREADY CONSUMED by an earlier
 *    rotation is REUSE — a signal of a stolen/replayed token — and the
 *    user's session is revoked outright (both the thief and the legitimate
 *    holder must sign in again); a jti the store never rotated away (a
 *    forged token, an expired/revoked session, or the old session of a
 *    device replaced by a newer login) is merely INVALID and revokes
 *    nothing, so ordinary multi-device churn cannot log anybody out.
 *  - `revoke(userId)` supports an explicit logout / "log out other
 *    devices" action later.
 *
 * V1 scope note: this stores a single active jti per user, i.e. one
 * active session per user. Multi-device/multi-session support (one
 * jti per device) is a straightforward extension — key by
 * `refresh-jti:<userId>:<deviceId>` instead — but isn't needed yet and
 * isn't built speculatively.
 */

export type RefreshRotation = { status: 'ROTATED' } | { status: 'REUSED' } | { status: 'INVALID' };

/** How many already-consumed jtis per session are remembered for reuse detection (bounded: a long-lived session never grows unbounded). */
const MAX_REMEMBERED_USED_JTIS = 10;

const ROTATE_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if cur and cur == ARGV[1] then
  redis.call('LPUSH', KEYS[2], ARGV[1])
  redis.call('LTRIM', KEYS[2], 0, tonumber(ARGV[4]) - 1)
  redis.call('EXPIRE', KEYS[2], tonumber(ARGV[3]))
  if ARGV[2] ~= '' then
    redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
  else
    redis.call('DEL', KEYS[1])
  end
  return 1
end
local used = redis.call('LRANGE', KEYS[2], 0, -1)
for _, v in ipairs(used) do
  if v == ARGV[1] then
    redis.call('DEL', KEYS[1])
    return -1
  end
end
return 0
`;

@Injectable()
export class RefreshTokenStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(userId: string): string {
    return `refresh-jti:${userId}`;
  }

  /** The most recent already-consumed jtis of this user's session (bounded list) — what makes reuse detectable. */
  private usedKey(userId: string): string {
    return `refresh-used:${userId}`;
  }

  async issue(userId: string, ttlSeconds: number): Promise<string> {
    const jti = randomUUID();
    await this.redis.set(this.key(userId), jti, 'EX', ttlSeconds);
    return jti;
  }

  /**
   * Atomically rotates the session's refresh token. ONE Lua script = one indivisible Redis operation, so two concurrent
   * requests carrying the same token cannot both succeed (the previous GET-then-DEL could let both through):
   *   - presented == current  → the current jti becomes "used", `newJti` (when given) becomes the current one → ROTATED
   *   - presented is in the user's recent "used" list → REUSED: the session is revoked (current jti deleted) in the same step
   *   - anything else → INVALID (nothing is touched)
   * Only this user's two keys are ever read or written, so no other user's session can be affected.
   */
  async rotate(userId: string, presentedJti: string, ttlSeconds: number, newJti: string | null): Promise<RefreshRotation> {
    const result = (await this.redis.eval(
      ROTATE_SCRIPT,
      2,
      this.key(userId),
      this.usedKey(userId),
      presentedJti,
      newJti ?? '',
      String(ttlSeconds),
      String(MAX_REMEMBERED_USED_JTIS),
    )) as number;
    if (result === 1) return { status: 'ROTATED' };
    if (result === -1) return { status: 'REUSED' };
    return { status: 'INVALID' };
  }

  /** Single-use consumption without issuing a successor (kept for callers that only need the yes/no answer). */
  async consume(userId: string, presentedJti: string): Promise<boolean> {
    const outcome = await this.rotate(userId, presentedJti, 1, null);
    return outcome.status === 'ROTATED';
  }

  async revoke(userId: string): Promise<void> {
    await this.redis.del(this.key(userId));
  }
}
