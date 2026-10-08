import { Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { ThrottlerStorageService } from '@nestjs/throttler';
import type Redis from 'ioredis';

/**
 * Rate-limit counters in the shared Redis (M5 Batch 4), replacing @nestjs/throttler's default in-process Map.
 *
 * Why: (1) with more than one backend instance every instance kept its own counters, so the real limit was `limit x instances`
 * and a client could dodge it by being load-balanced; (2) the in-memory store schedules one timer per request, which is itself a
 * cost under abuse. A fixed window with one atomic `INCR` is cheaper and shared.
 *
 * Failure policy: rate limiting must never take the API down. If Redis errors or is slow, the request is answered by an
 * in-memory fallback (still limited, just per instance), and a short circuit breaker stops every request from waiting on a
 * dead Redis. Nothing here ever throws to the caller.
 */
const KEY_PREFIX = 'throttle:';
const REDIS_CALL_TIMEOUT_MS = 250;
const BREAKER_OPEN_MS = 5_000;

// KEYS[1] = counter, KEYS[2] = block marker.  ARGV = ttlMs, limit, blockMs.   -> { hits, ttlLeftMs, blocked(0/1), blockLeftMs }
const SCRIPT = `
local blockLeft = redis.call('PTTL', KEYS[2])
if blockLeft > 0 then
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl < 0 then ttl = tonumber(ARGV[1]) end
  return { tonumber(ARGV[2]) + 1, ttl, 1, blockLeft }
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return { hits, ttl, 1, tonumber(ARGV[3]) }
end
return { hits, ttl, 0, 0 }
`;

export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger('RedisThrottlerStorage');
  private readonly fallback = new ThrottlerStorageService();
  private breakerOpenUntil = 0;
  private lastErrorLoggedAt = 0;

  constructor(private readonly redis: Redis) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    if (Date.now() >= this.breakerOpenUntil) {
      try {
        const raw = (await this.withTimeout(
          this.redis.eval(SCRIPT, 2, `${KEY_PREFIX}${key}`, `${KEY_PREFIX}${key}:blk`, ttl, limit, blockDuration || ttl),
        )) as [number, number, number, number];
        return { totalHits: Number(raw[0]), timeToExpire: Math.ceil(Number(raw[1]) / 1000), isBlocked: Number(raw[2]) === 1, timeToBlockExpire: Math.ceil(Number(raw[3]) / 1000) };
      } catch (error) {
        this.breakerOpenUntil = Date.now() + BREAKER_OPEN_MS;
        if (Date.now() - this.lastErrorLoggedAt > 30_000) {
          this.lastErrorLoggedAt = Date.now();
          this.logger.error(`Redis unavailable for rate limiting; using per-instance fallback for ${BREAKER_OPEN_MS / 1000}s (${(error as Error).message}).`);
        }
      }
    }
    return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
  }

  /** Clears the fallback store's per-hit expiry timers so a shut-down app (or a finished test run) is not kept alive by them. */
  onApplicationShutdown(): void {
    this.fallback.onApplicationShutdown();
  }

  private withTimeout<T>(call: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('rate-limit store timeout')), REDIS_CALL_TIMEOUT_MS);
    });
    return Promise.race([call, timeout]).finally(() => clearTimeout(timer));
  }
}
