import { HomeSectionsCache, HOME_SECTIONS_TTL_SECONDS, REDIS_CIRCUIT_OPEN_MS, REDIS_OP_TIMEOUT_MS } from './home-sections.cache';

/** A tiny in-memory Redis with the handful of commands the cache uses, and switches to simulate an outage. */
function fakeRedis() {
  const store = new Map<string, string>();
  const ttl = new Map<string, number>();
  const state = { down: false, setNxTaken: false };
  const guard = () => {
    if (state.down) throw new Error('Stream isn\'t writeable and enableOfflineQueue options is false');
  };
  const redis = {
    store,
    ttl,
    state,
    get: jest.fn(async (key: string) => {
      guard();
      return store.get(key) ?? null;
    }),
    set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
      guard();
      if (args.includes('NX')) {
        if (store.has(key) || state.setNxTaken) return null;
        store.set(key, value);
        return 'OK';
      }
      store.set(key, value);
      const exIndex = args.indexOf('EX');
      if (exIndex >= 0) ttl.set(key, Number(args[exIndex + 1]));
      return 'OK';
    }),
    incr: jest.fn(async (key: string) => {
      guard();
      const next = Number(store.get(key) ?? 0) + 1;
      store.set(key, String(next));
      return next;
    }),
    eval: jest.fn(async (_script: string, _n: number, key: string, token: string) => {
      guard();
      if (store.get(key) === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    }),
  };
  return redis;
}

describe('HomeSectionsCache', () => {
  it('a miss computes and stores with the TTL; the next call is a HIT and does not compute', async () => {
    const redis = fakeRedis();
    const cache = new HomeSectionsCache(redis as never);
    const compute = jest.fn(async () => ({ n: 1 }));

    expect(await cache.getOrCompute('k', compute)).toEqual({ value: { n: 1 }, source: 'COMPUTED' });
    expect(redis.ttl.get('k')).toBe(HOME_SECTIONS_TTL_SECONDS);
    expect(await cache.getOrCompute('k', compute)).toEqual({ value: { n: 1 }, source: 'CACHE' });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('only cacheable values are stored (an ERROR section is recomputed next time)', async () => {
    const redis = fakeRedis();
    const cache = new HomeSectionsCache(redis as never);
    const compute = jest.fn(async () => ({ status: 'ERROR' }));
    await cache.getOrCompute('k', compute, { cacheable: (v) => v.status === 'OK' });
    await cache.getOrCompute('k', compute, { cacheable: (v) => v.status === 'OK' });
    expect(compute).toHaveBeenCalledTimes(2);
    expect(redis.store.has('k')).toBe(false);
  });

  it('Redis DOWN is never a failure: the value is computed from the database (BYPASS) on every call, reads/writes/epoch included', async () => {
    const redis = fakeRedis();
    redis.state.down = true;
    const cache = new HomeSectionsCache(redis as never);
    const compute = jest.fn(async () => 'db');
    expect(await cache.getOrCompute('k', compute)).toEqual({ value: 'db', source: 'BYPASS' });
    expect(await cache.getOrCompute('k', compute)).toEqual({ value: 'db', source: 'BYPASS' });
    expect(compute).toHaveBeenCalledTimes(2);
    expect(await cache.epoch()).toBe('x');
    await expect(cache.bumpEpoch()).resolves.toBeUndefined();
    expect(await cache.peek('k')).toBeNull();
  });

  it('a Redis failure while WRITING still returns the computed value', async () => {
    const redis = fakeRedis();
    redis.set.mockImplementation(async (key: string, _value: string, ...args: unknown[]) => {
      if (args.includes('NX')) return 'OK'; // the lock works, the cache write does not
      throw new Error('write failed');
    });
    const cache = new HomeSectionsCache(redis as never);
    expect((await cache.getOrCompute('k', async () => 5)).value).toBe(5);
  });

  it('a corrupt cached value is a miss: recomputed and overwritten', async () => {
    const redis = fakeRedis();
    redis.store.set('k', '{not json');
    const cache = new HomeSectionsCache(redis as never);
    expect(await cache.getOrCompute('k', async () => ({ ok: true }))).toEqual({ value: { ok: true }, source: 'COMPUTED' });
    expect(JSON.parse(redis.store.get('k')!)).toEqual({ ok: true });
  });

  it('stampede: 25 concurrent misses for one key run ONE computation and all get its value', async () => {
    const redis = fakeRedis();
    const cache = new HomeSectionsCache(redis as never);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const compute = jest.fn(async () => {
      await gate;
      return 'once';
    });
    const calls = Array.from({ length: 25 }, () => cache.getOrCompute('hot', compute));
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    const results = await Promise.all(calls);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.value === 'once')).toBe(true);
  });

  it('across instances: a caller that does not get the lock waits for the owner\'s value instead of computing', async () => {
    const redis = fakeRedis();
    redis.state.setNxTaken = true; // another instance owns the lock
    const cache = new HomeSectionsCache(redis as never);
    const compute = jest.fn(async () => 'mine');
    setTimeout(() => redis.store.set('shared', JSON.stringify('theirs')), 150); // the owner finishes and writes
    expect(await cache.getOrCompute('shared', compute)).toEqual({ value: 'theirs', source: 'CACHE' });
    expect(compute).not.toHaveBeenCalled();
  });

  it('if the lock owner never delivers, the waiter computes after a bounded wait (a dead owner cannot block Home)', async () => {
    const redis = fakeRedis();
    redis.state.setNxTaken = true;
    const cache = new HomeSectionsCache(redis as never);
    const started = Date.now();
    const result = await cache.getOrCompute('orphan', async () => 'fallback');
    expect(result.value).toBe('fallback');
    expect(Date.now() - started).toBeLessThan(3000);
    expect(redis.eval).not.toHaveBeenCalled(); // never releases a lock it does not own
  });

  it('releases only its own lock (compare-and-delete)', async () => {
    const redis = fakeRedis();
    const cache = new HomeSectionsCache(redis as never);
    await cache.getOrCompute('k', async () => 1);
    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.store.has('k:lock')).toBe(false);
  });

  it('epoch: starts at 0, bumping moves it (old keys become unreachable), and it never throws', async () => {
    const redis = fakeRedis();
    const cache = new HomeSectionsCache(redis as never);
    expect(await cache.epoch()).toBe('0');
    await cache.bumpEpoch();
    await cache.bumpEpoch();
    expect(await cache.epoch()).toBe('2');
  });

  describe('a hung or slow Redis (the outage case measured at ~25 s per request without this)', () => {
    it('a command that never answers is cut off after the timeout and the request is served from the database', async () => {
      const redis = fakeRedis();
      redis.get.mockImplementation(() => new Promise(() => undefined)); // never resolves
      const cache = new HomeSectionsCache(redis as never);
      const started = Date.now();
      const result = await cache.getOrCompute('k', async () => 'db');
      expect(result).toEqual({ value: 'db', source: 'BYPASS' });
      expect(Date.now() - started).toBeLessThan(REDIS_OP_TIMEOUT_MS * 3);
    });

    it('after the first failure Redis is not touched at all while the circuit is open: later requests pay nothing', async () => {
      const redis = fakeRedis();
      redis.state.down = true;
      const cache = new HomeSectionsCache(redis as never);
      await cache.getOrCompute('a', async () => 1);
      const commandsAfterFirst = redis.get.mock.calls.length + redis.set.mock.calls.length + redis.incr.mock.calls.length;
      const started = Date.now();
      for (let i = 0; i < 20; i++) {
        await cache.epoch();
        await cache.peek('a');
        await cache.getOrCompute(`k${i}`, async () => i);
        await cache.bumpEpoch();
      }
      expect(redis.get.mock.calls.length + redis.set.mock.calls.length + redis.incr.mock.calls.length).toBe(commandsAfterFirst);
      expect(Date.now() - started).toBeLessThan(200);
    });

    it('the circuit closes again after its window: a recovered Redis is used (and cached into) once more', async () => {
      jest.useFakeTimers({ now: Date.now(), doNotFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'nextTick'] });
      try {
        const redis = fakeRedis();
        redis.state.down = true;
        const cache = new HomeSectionsCache(redis as never);
        await cache.getOrCompute('k', async () => 'db');
        redis.state.down = false;
        expect((await cache.getOrCompute('k', async () => 'db')).source).toBe('BYPASS'); // still open
        jest.setSystemTime(Date.now() + REDIS_CIRCUIT_OPEN_MS + 1);
        expect((await cache.getOrCompute('k', async () => 'db')).source).toBe('COMPUTED');
        expect((await cache.getOrCompute('k', async () => 'db')).source).toBe('CACHE');
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
