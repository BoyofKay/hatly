import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { INTEGRATION_REDIS_URL } from './support/config';
import { RedisThrottlerStorage } from '../../src/common/throttling/redis-throttler.storage';

/** The shared rate-limit counters against a REAL Redis: correctness, sharing across instances, exactness under concurrency, outage fallback. */
describe('RedisThrottlerStorage (real Redis)', () => {
  let redis: Redis;
  const keys = new Set<string>();
  const key = () => { const k = `inttest-${randomUUID()}`; keys.add(k); return k; };

  beforeAll(() => { redis = new Redis(INTEGRATION_REDIS_URL); });
  afterAll(async () => {
    for (const k of keys) await redis.del(`throttle:${k}`, `throttle:${k}:blk`);
    await redis.quit();
  });

  it('counts hits inside one window and reports the time left', async () => {
    const storage = new RedisThrottlerStorage(redis);
    const k = key();
    for (let i = 1; i <= 3; i++) {
      const r = await storage.increment(k, 60_000, 5, 60_000, 'default');
      expect(r).toMatchObject({ totalHits: i, isBlocked: false });
      expect(r.timeToExpire).toBeGreaterThan(0);
      expect(r.timeToExpire).toBeLessThanOrEqual(60);
    }
  });

  it('exceeding the limit blocks, and the block outlasts further attempts (no counting while blocked)', async () => {
    const storage = new RedisThrottlerStorage(redis);
    const k = key();
    for (let i = 0; i < 3; i++) expect((await storage.increment(k, 60_000, 3, 60_000, 'default')).isBlocked).toBe(false);
    const over = await storage.increment(k, 60_000, 3, 60_000, 'default');
    expect(over).toMatchObject({ isBlocked: true });
    expect(over.timeToBlockExpire).toBeGreaterThan(0);
    const still = await storage.increment(k, 60_000, 3, 60_000, 'default');
    expect(still.isBlocked).toBe(true);
    expect(await redis.get(`throttle:${k}`)).toBe('4'); // the blocked request did not inflate the counter
  });

  it('the window really expires: a short window resets the counter', async () => {
    const storage = new RedisThrottlerStorage(redis);
    const k = key();
    await storage.increment(k, 300, 5, 300, 'default');
    await storage.increment(k, 300, 5, 300, 'default');
    await new Promise((r) => setTimeout(r, 450));
    expect((await storage.increment(k, 300, 5, 300, 'default')).totalHits).toBe(1);
  });

  it('is SHARED: two independent storage instances (two backend instances) see one counter — the limit does not multiply with instance count', async () => {
    const a = new RedisThrottlerStorage(redis);
    const second = new Redis(INTEGRATION_REDIS_URL); // a second connection stands in for a second backend instance
    const b = new RedisThrottlerStorage(second);
    const k = key();
    const hits = [];
    for (let i = 0; i < 6; i++) hits.push((await (i % 2 === 0 ? a : b).increment(k, 60_000, 4, 60_000, 'default')).isBlocked);
    await second.quit();
    expect(hits).toEqual([false, false, false, false, true, true]); // 4 allowed in TOTAL across both, not 4 each
  });

  it('is exact under concurrency: 200 simultaneous requests against a limit of 50 allow exactly 50', async () => {
    const storage = new RedisThrottlerStorage(redis);
    const k = key();
    const results = await Promise.all(Array.from({ length: 200 }, () => storage.increment(k, 60_000, 50, 60_000, 'default')));
    expect(results.filter((r) => !r.isBlocked)).toHaveLength(50);
    expect(results.filter((r) => r.isBlocked)).toHaveLength(150);
  });

  it('different keys never interfere', async () => {
    const storage = new RedisThrottlerStorage(redis);
    const [k1, k2] = [key(), key()];
    for (let i = 0; i < 3; i++) await storage.increment(k1, 60_000, 2, 60_000, 'default');
    expect((await storage.increment(k2, 60_000, 2, 60_000, 'default')).isBlocked).toBe(false);
  });

  it('when Redis is unreachable it falls back to per-instance counting, still enforces the limit, never throws, and stops waiting on the dead store', async () => {
    const dead = new Redis('redis://127.0.0.1:1', { maxRetriesPerRequest: 0, enableOfflineQueue: false, lazyConnect: true, retryStrategy: () => null });
    dead.on('error', () => undefined);
    const storage = new RedisThrottlerStorage(dead);
    const k = key();
    const first = await storage.increment(k, 60_000, 2, 60_000, 'default');
    expect(first).toMatchObject({ totalHits: 1, isBlocked: false });
    await storage.increment(k, 60_000, 2, 60_000, 'default');
    expect((await storage.increment(k, 60_000, 2, 60_000, 'default')).isBlocked).toBe(true); // limited even with the store down
    const started = Date.now();
    for (let i = 0; i < 50; i++) await storage.increment(key(), 60_000, 5, 60_000, 'default');
    expect(Date.now() - started).toBeLessThan(1000); // circuit breaker open: no per-request wait on the dead Redis
    storage.onApplicationShutdown();
    dead.disconnect();
  });
});
