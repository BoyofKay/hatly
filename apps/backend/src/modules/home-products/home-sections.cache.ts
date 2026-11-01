import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';

/** How long a computed Home section is served from Redis. Short on purpose: stock / delivered counts change without any admin action (see HomeCacheEpochInterceptor). */
export const HOME_SECTIONS_TTL_SECONDS = 60;
const EPOCH_KEY = 'home:sections:epoch';
const LOCK_TTL_MS = 8_000;
const LOCK_WAIT_MS = 1_500;
const LOCK_POLL_MS = 60;
/** One Redis command may take at most this long before the cache gives up on it (a healthy Redis answers in ~1 ms). */
export const REDIS_OP_TIMEOUT_MS = 250;
/** After a Redis failure or timeout the cache is skipped entirely for this long — Home must not pay the timeout on every request during an outage. */
export const REDIS_CIRCUIT_OPEN_MS = 15_000;

export type CacheSource = 'CACHE' | 'COMPUTED' | 'BYPASS';

/**
 * The Home aggregation's cache over the shared Redis client — a plain `GET` / `SET EX` JSON cache, the same shape the map provider uses.
 *
 *  - NEVER a hard dependency: any Redis error (down, timeout, offline queue off) is logged once per call and the value is computed from
 *    the database instead (`source: 'BYPASS'`). A corrupt cached value is treated as a miss.
 *  - Invalidation: every key embeds the current EPOCH (`home:sections:epoch`). Bumping it (HomeCacheEpochInterceptor, after an admin /
 *    vendor catalogue mutation) makes every older key unreachable at once without scanning or flushing Redis; the orphaned keys expire by TTL.
 *  - An outage costs at most ONE short timeout, not one per command: every command is bounded (REDIS_OP_TIMEOUT_MS) and the first failure
 *    opens a circuit (REDIS_CIRCUIT_OPEN_MS) during which Redis is not touched at all (ioredis alone would make each command wait seconds
 *    on an unreachable server — measured at ~25 s for one Home request before this guard).
 *  - Stampede protection: concurrent misses for the same key share ONE computation in this process (single-flight), and across instances
 *    the first one takes a short `SET NX PX` lock while the others poll the cache for a moment — if the owner is slow or died they compute
 *    themselves rather than wait for the lock to expire.
 */
@Injectable()
export class HomeSectionsCache {
  private readonly logger = new Logger(HomeSectionsCache.name);
  private readonly inflight = new Map<string, Promise<unknown>>();
  private circuitOpenUntil = 0;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async epoch(): Promise<string> {
    try {
      return (await this.guard(() => this.redis.get(EPOCH_KEY))) ?? '0';
    } catch (error) {
      this.warn('epoch read', error);
      return 'x'; // a value no real epoch has: keys built from it are never shared with a healthy-Redis period
    }
  }

  /** Called after a catalogue mutation. Never throws — a failed bump only means the TTL decides how long old data lives. */
  async bumpEpoch(): Promise<void> {
    try {
      await this.guard(() => this.redis.incr(EPOCH_KEY));
    } catch (error) {
      this.warn('epoch bump', error);
    }
  }

  /** A plain read: the cached value, or null on a miss / unreadable value / Redis problem. Used to learn which sections need computing. */
  async peek<T>(key: string): Promise<T | null> {
    const result = await this.read<T>(key);
    return result.state === 'hit' ? result.value : null;
  }

  async getOrCompute<T>(key: string, compute: () => Promise<T>, options: { ttlSeconds?: number; cacheable?: (value: T) => boolean } = {}): Promise<{ value: T; source: CacheSource }> {
    const cached = await this.read<T>(key);
    if (cached.state === 'hit') return { value: cached.value, source: 'CACHE' };
    const redisUp = cached.state === 'miss';

    const shared = this.inflight.get(key) as Promise<{ value: T; source: CacheSource }> | undefined;
    if (shared) return shared;
    const run = this.compute(key, compute, redisUp, options).finally(() => this.inflight.delete(key));
    this.inflight.set(key, run);
    return run;
  }

  private async compute<T>(key: string, compute: () => Promise<T>, redisUp: boolean, options: { ttlSeconds?: number; cacheable?: (value: T) => boolean }): Promise<{ value: T; source: CacheSource }> {
    if (!redisUp) return { value: await compute(), source: 'BYPASS' };

    const lockKey = `${key}:lock`;
    const token = randomUUID();
    const owner = await this.tryLock(lockKey, token);
    if (!owner) {
      const waited = await this.waitFor<T>(key);
      if (waited.state === 'hit') return { value: waited.value, source: 'CACHE' };
    }
    try {
      const value = await compute();
      if (!options.cacheable || options.cacheable(value)) await this.write(key, value, options.ttlSeconds ?? HOME_SECTIONS_TTL_SECONDS);
      return { value, source: 'COMPUTED' };
    } finally {
      if (owner) await this.unlock(lockKey, token);
    }
  }

  private async read<T>(key: string): Promise<{ state: 'hit'; value: T } | { state: 'miss' } | { state: 'down' }> {
    try {
      const raw = await this.guard(() => this.redis.get(key));
      if (raw === null) return { state: 'miss' };
      try {
        return { state: 'hit', value: JSON.parse(raw) as T };
      } catch {
        return { state: 'miss' }; // unreadable value: recompute and overwrite
      }
    } catch (error) {
      this.warn('read', error);
      return { state: 'down' };
    }
  }

  private async write(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.guard(() => this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds));
    } catch (error) {
      this.warn('write', error);
    }
  }

  private async tryLock(lockKey: string, token: string): Promise<boolean> {
    try {
      return (await this.guard(() => this.redis.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX'))) === 'OK';
    } catch (error) {
      this.warn('lock', error);
      return true; // cannot coordinate: just compute
    }
  }

  private async waitFor<T>(key: string): Promise<{ state: 'hit'; value: T } | { state: 'miss' } | { state: 'down' }> {
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
      const result = await this.read<T>(key);
      if (result.state !== 'miss') return result;
    }
    return { state: 'miss' };
  }

  /** Compare-and-delete, so a lock that expired and was re-taken by another instance is never released by us. */
  private async unlock(lockKey: string, token: string): Promise<void> {
    try {
      await this.guard(() => this.redis.eval('if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end', 1, lockKey, token));
    } catch (error) {
      this.warn('unlock', error);
    }
  }

  /** Bounds one Redis command and runs the circuit: a failure/timeout opens it, and while it is open the command is refused without being sent. */
  private async guard<T>(op: () => Promise<T>): Promise<T> {
    if (Date.now() < this.circuitOpenUntil) throw new Error('Redis circuit open');
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        op(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Redis command timed out after ${REDIS_OP_TIMEOUT_MS} ms`)), REDIS_OP_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      this.circuitOpenUntil = Date.now() + REDIS_CIRCUIT_OPEN_MS;
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private warn(what: string, error: unknown): void {
    if ((error as Error).message === 'Redis circuit open') return;
    this.logger.warn(`Home sections cache ${what} failed (${(error as Error).message}) — serving from the database.`);
  }
}
