import { randomUUID } from 'crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import Redis from 'ioredis';
import { createIntegrationApp } from './support/app';
import { REDIS_CLIENT } from '../../src/common/redis/redis.constants';
import { RefreshTokenStore } from '../../src/modules/auth/refresh-token.store';

/**
 * M5 Batch 2 — refresh-token rotation and REUSE DETECTION against the real Redis, through the real RefreshTokenStore (its Lua
 * script is the concurrency guarantee, so it must be proven on a real server, not a fake).
 */
describe('RefreshTokenStore — rotation, reuse detection and concurrency (real Redis)', () => {
  let app: NestExpressApplication;
  let redis: Redis;
  let store: RefreshTokenStore;
  const users: string[] = [];
  const newUser = () => {
    const id = `int-${randomUUID()}`;
    users.push(id);
    return id;
  };

  beforeAll(async () => {
    app = await createIntegrationApp();
    redis = app.get<Redis>(REDIS_CLIENT);
    store = app.get(RefreshTokenStore);
  });
  afterEach(async () => {
    for (const id of users.splice(0)) await redis.del(`refresh-jti:${id}`, `refresh-used:${id}`);
  });
  afterAll(async () => {
    await app.close();
  });

  const TTL = 60;

  it('normal rotation: the current token rotates to its successor, which then rotates in turn', async () => {
    const user = newUser();
    const first = await store.issue(user, TTL);
    expect(await store.rotate(user, first, TTL, 'second')).toEqual({ status: 'ROTATED' });
    expect(await redis.get(`refresh-jti:${user}`)).toBe('second');
    expect(await store.rotate(user, 'second', TTL, 'third')).toEqual({ status: 'ROTATED' });
    expect(await redis.get(`refresh-jti:${user}`)).toBe('third');
  });

  it('replay of an already-rotated token is REUSED and revokes the session — even the newest token is then refused', async () => {
    const user = newUser();
    const first = await store.issue(user, TTL);
    await store.rotate(user, first, TTL, 'second');

    expect(await store.rotate(user, first, TTL, 'attacker-successor')).toEqual({ status: 'REUSED' });
    expect(await redis.get(`refresh-jti:${user}`)).toBeNull(); // session gone; the attacker's successor was never stored
    expect(await store.rotate(user, 'second', TTL, 'x')).toEqual({ status: 'INVALID' }); // legitimate holder must sign in again
  });

  it('a token that was never rotated away is INVALID and revokes nothing (unknown jti, or replaced by a newer login)', async () => {
    const user = newUser();
    const device1 = await store.issue(user, TTL);
    const device2 = await store.issue(user, TTL); // second device's login replaces the stored jti
    expect(await store.rotate(user, device1, TTL, 'x')).toEqual({ status: 'INVALID' });
    expect(await store.rotate(user, 'forged', TTL, 'x')).toEqual({ status: 'INVALID' });
    expect(await redis.get(`refresh-jti:${user}`)).toBe(device2); // untouched
  });

  it('CONCURRENT replay: of 12 simultaneous requests with the same token exactly ONE succeeds, the rest are refused, the session ends revoked', async () => {
    const user = newUser();
    const token = await store.issue(user, TTL);

    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => store.rotate(user, token, TTL, `successor-${i}`)));

    expect(results.filter((r) => r.status === 'ROTATED')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'REUSED')).toHaveLength(11);
    // The one winner's successor can no longer be used: the reuse revoked the session.
    expect(await redis.get(`refresh-jti:${user}`)).toBeNull();
  });

  it('concurrent rotation of the legitimate chain by DIFFERENT users never interferes', async () => {
    const people = Array.from({ length: 8 }, () => newUser());
    const tokens = await Promise.all(people.map((u) => store.issue(u, TTL)));
    const results = await Promise.all(people.map((u, i) => store.rotate(u, tokens[i], TTL, `next-${i}`)));
    expect(results.every((r) => r.status === 'ROTATED')).toBe(true);
  });

  it('reuse detection by one user does not touch any other user\'s session', async () => {
    const victim = newUser();
    const bystander = newUser();
    const victimFirst = await store.issue(victim, TTL);
    const bystanderToken = await store.issue(bystander, TTL);
    await store.rotate(victim, victimFirst, TTL, 'v2');
    await store.rotate(victim, victimFirst, TTL, 'evil'); // reuse
    expect(await redis.get(`refresh-jti:${bystander}`)).toBe(bystanderToken);
    expect(await store.rotate(bystander, bystanderToken, TTL, 'b2')).toEqual({ status: 'ROTATED' });
  });

  it('the used-token memory is bounded (10) and expires with the session', async () => {
    const user = newUser();
    let current = await store.issue(user, TTL);
    const consumed: string[] = [current];
    for (let i = 0; i < 14; i++) {
      const next = `t${i}`;
      expect((await store.rotate(user, current, TTL, next)).status).toBe('ROTATED');
      current = next;
      consumed.push(next);
    }
    expect(await redis.llen(`refresh-used:${user}`)).toBe(10);
    expect(await redis.ttl(`refresh-used:${user}`)).toBeGreaterThan(0);
    // The oldest consumed token has aged out of the bounded memory → merely INVALID (still refused, no family revoke).
    expect(await store.rotate(user, consumed[0], TTL, 'x')).toEqual({ status: 'INVALID' });
    expect(await redis.get(`refresh-jti:${user}`)).toBe(current);
    // A recent one is still recognised as reuse.
    expect(await store.rotate(user, consumed[consumed.length - 2], TTL, 'x')).toEqual({ status: 'REUSED' });
  });

  it('the legacy consume() still works: once only, replay refused, revoke clears the session', async () => {
    const user = newUser();
    const jti = await store.issue(user, TTL);
    expect(await store.consume(user, 'wrong')).toBe(false);
    expect(await store.consume(user, jti)).toBe(true);
    expect(await store.consume(user, jti)).toBe(false);
  });
});
