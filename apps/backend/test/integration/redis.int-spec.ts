import { randomUUID } from 'crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import Redis from 'ioredis';
import { createIntegrationApp } from './support/app';
import { INTEGRATION_REDIS_DB, REDIS_TEST_KEY_PREFIX } from './support/config';
import { REDIS_CLIENT } from '../../src/common/redis/redis.constants';
import { RefreshTokenStore } from '../../src/modules/auth/refresh-token.store';
import { GoogleMapsProvider } from '../../src/modules/location/providers/google-maps.provider';
import { DeliveryAssignmentService } from '../../src/modules/delivery/delivery-assignment.service';
import { AutomaticDispatchService } from '../../src/modules/delivery/automatic-dispatch.service';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Real Redis, through the ONE production shared client (REDIS_CLIENT)
 * that the running application injects — no second connection is
 * created here. Every key is namespaced under REDIS_TEST_KEY_PREFIX
 * (plus a per-run id) and lives in the dedicated logical database 15;
 * afterEach removes them.
 */
describe('Real Redis via the production shared client', () => {
  let app: NestExpressApplication;
  let redis: Redis;
  const runId = randomUUID().slice(0, 8);
  const k = (name: string) => `${REDIS_TEST_KEY_PREFIX}${runId}:${name}`;
  const foreignKeys = new Set<string>(); // production-format keys other modules write (not under our prefix); removed explicitly

  beforeAll(async () => {
    app = await createIntegrationApp();
    redis = app.get<Redis>(REDIS_CLIENT);
  });

  afterEach(async () => {
    const mine = await redis.keys(`${REDIS_TEST_KEY_PREFIX}${runId}:*`);
    const all = [...mine, ...foreignKeys];
    if (all.length) await redis.del(...all);
    foreignKeys.clear();
  });

  afterAll(async () => {
    // The dedicated logical database must be left empty.
    expect(await redis.dbsize()).toBe(0);
    await app.close();
  });

  it('is the shared production client, connected to the dedicated integration logical database, and answers PING', async () => {
    expect(await redis.ping()).toBe('PONG');
    expect(redis.options.db).toBe(INTEGRATION_REDIS_DB);
    expect(app.get(REDIS_CLIENT)).toBe(redis); // one instance for the whole app
  });

  it('SET/GET round-trips values byte-for-byte (JSON, unicode/Arabic)', async () => {
    const payload = JSON.stringify({ name: 'متجر حتلي', amountMinor: 9007199254740991, nested: { a: [1, 2, 3] } });
    await redis.set(k('roundtrip'), payload);
    expect(await redis.get(k('roundtrip'))).toBe(payload);
  });

  it('expiry really expires keys (EX/PX and TTL reporting)', async () => {
    await redis.set(k('short'), '1', 'PX', 150);
    await redis.set(k('long'), '1', 'EX', 60);
    expect(await redis.get(k('short'))).toBe('1');
    expect(await redis.ttl(k('long'))).toBeGreaterThan(55);
    await sleep(350);
    expect(await redis.get(k('short'))).toBeNull();
    expect(await redis.exists(k('long'))).toBe(1);
  });

  it('DEL removes a key and reports how many it removed', async () => {
    await redis.set(k('doomed'), 'x');
    expect(await redis.del(k('doomed'))).toBe(1);
    expect(await redis.get(k('doomed'))).toBeNull();
    expect(await redis.del(k('never-existed'))).toBe(0);
  });

  it('concurrent access does not corrupt values: 200 parallel INCRs land exactly 200, 100 parallel distinct SETs all read back', async () => {
    await Promise.all(Array.from({ length: 200 }, () => redis.incr(k('counter'))));
    expect(await redis.get(k('counter'))).toBe('200');

    await Promise.all(Array.from({ length: 100 }, (_, i) => redis.set(k(`multi:${i}`), `v${i}`)));
    const values = await Promise.all(Array.from({ length: 100 }, (_, i) => redis.get(k(`multi:${i}`))));
    expect(values).toEqual(Array.from({ length: 100 }, (_, i) => `v${i}`));
  });

  it('SET NX PX (the mutual-exclusion primitive) lets exactly ONE of many concurrent contenders win', async () => {
    const results = await Promise.all(Array.from({ length: 30 }, () => redis.set(k('lock'), '1', 'PX', 5000, 'NX')));
    expect(results.filter((r) => r === 'OK')).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(29);
  });

  it('DeliveryAssignmentService (real module, real client): the driver lock is exclusive under concurrency and re-acquirable after release', async () => {
    const service = app.get(DeliveryAssignmentService) as any;
    const driverId = `${runId}-driver`;
    foreignKeys.add(`driver-lock:${driverId}`);

    const acquired: (string | null)[] = await Promise.all(Array.from({ length: 20 }, () => service.acquireLock(driverId)));
    const tokens = acquired.filter((t): t is string => typeof t === 'string');
    expect(tokens).toHaveLength(1);
    await service.releaseLock(driverId, tokens[0]);
    const reacquired = await service.acquireLock(driverId);
    expect(typeof reacquired).toBe('string');
    await service.releaseLock(driverId, reacquired);
  });

  it('DeliveryAssignmentService (real module, real client): a stale/foreign token release is a safe no-op against the REAL Lua CAS script — it never deletes a DIFFERENT attempt\'s active lock (Reliability & Adversarial Testing milestone regression)', async () => {
    const service = app.get(DeliveryAssignmentService) as any;
    const driverId = `${runId}-driver-2`;
    const lockKey = `driver-lock:${driverId}`;
    foreignKeys.add(lockKey);

    const myToken = await service.acquireLock(driverId);
    expect(typeof myToken).toBe('string');

    await service.releaseLock(driverId, `${myToken}-not-the-real-owner`);
    expect(await redis.get(lockKey)).toBe(myToken); // untouched by the foreign-token release

    await service.releaseLock(driverId, myToken);
    expect(await redis.get(lockKey)).toBeNull();
  });

  it('RefreshTokenStore (real module, real client): issue → consume once → replay rejected → revoke', async () => {
    const store = app.get(RefreshTokenStore);
    const userId = `${runId}-user`;
    foreignKeys.add(`refresh:${userId}`);
    foreignKeys.add(`refresh-used:${userId}`); // M5 Batch 2: rotation remembers consumed jtis (reuse detection) under this key
    for (const key of await redis.keys(`*${userId}*`)) foreignKeys.add(key);

    const jti = await store.issue(userId, 60);
    for (const key of await redis.keys(`*${userId}*`)) foreignKeys.add(key);

    expect(await store.consume(userId, 'wrong-jti')).toBe(false);
    expect(await store.consume(userId, jti)).toBe(true);
    expect(await store.consume(userId, jti)).toBe(false); // rotation: a replayed refresh token is refused
    const again = await store.issue(userId, 60);
    await store.revoke(userId);
    expect(await store.consume(userId, again)).toBe(false);
  });

  it('AutomaticDispatchService (real module, real client): the sweep lock is ownership-token exclusive under concurrency, a stale/foreign token is a safe no-op on release, and the lock is re-acquirable after a clean release', async () => {
    const service = app.get(AutomaticDispatchService) as any;
    // The sweep lock is a single FIXED key (not per-run-namespaced — it
    // serializes the whole process's sweep, so there is only ever one),
    // unlike every other key in this file — tracked via foreignKeys exactly
    // like DeliveryAssignmentService's own driver-lock key above.
    const lockKey = (AutomaticDispatchService as any).SWEEP_LOCK_KEY as string;
    foreignKeys.add(lockKey);
    await redis.del(lockKey); // in case a previous unrelated run left it set

    // (a) 20 concurrent acquisition attempts against the REAL Lua/NX path yield exactly 1 winning token.
    const tokens: (string | null)[] = await Promise.all(Array.from({ length: 20 }, () => service.acquireSweepLock()));
    const won = tokens.filter((t): t is string => typeof t === 'string');
    expect(won).toHaveLength(1);
    const myToken = won[0];

    // (b) a stale/foreign token is a genuine no-op against the REAL Lua CAS script — the actual lock,
    // still held under `myToken`, must NOT be cleared by a release call carrying any other token.
    await service.releaseSweepLock(`${myToken}-not-the-real-owner`);
    expect(await redis.get(lockKey)).toBe(myToken);

    // (c) releasing with the correct token clears it, and the lock is then cleanly re-acquirable.
    await service.releaseSweepLock(myToken);
    expect(await redis.get(lockKey)).toBeNull();
    const reacquired = await service.acquireSweepLock();
    expect(typeof reacquired).toBe('string');
    await service.releaseSweepLock(reacquired);
  });

  it('GoogleMapsProvider (real module, real client) serves a cached distance from Redis without any outbound network call', async () => {
    const provider = app.get(GoogleMapsProvider) as any;
    const from = { latitude: 30.1, longitude: 31.1 };
    const to = { latitude: 30.2, longitude: 31.2 };
    const cacheKey = provider.buildCacheKey(from, to);
    foreignKeys.add(cacheKey);
    await redis.set(cacheKey, JSON.stringify({ distanceMeters: 4321, etaSeconds: 654 }), 'EX', 60);

    const fetchSpy = jest.spyOn(global, 'fetch');
    const result = await provider.distanceAndEta(from, to);

    expect(result).toEqual({ distanceMeters: 4321, etaSeconds: 654 });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
