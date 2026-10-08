import { HttpException } from '@nestjs/common';
import { LOGIN_FAILURE_WINDOW_SECONDS, LOGIN_MAX_FAILURES, LoginAttemptLimiter } from './login-attempt-limiter';
import { AuthService } from './auth.service';
import { Role } from '../../common/enums/role.enum';
import * as bcrypt from 'bcrypt';

class FakeRedis {
  counters = new Map<string, number>();
  ttls = new Map<string, number>();
  failing = false;
  private check() { if (this.failing) throw new Error('redis down'); }
  async get(k: string) { this.check(); return this.counters.has(k) ? String(this.counters.get(k)) : null; }
  async incr(k: string) { this.check(); const n = (this.counters.get(k) ?? 0) + 1; this.counters.set(k, n); return n; }
  async expire(k: string, s: number) { this.check(); this.ttls.set(k, s); return 1; }
  async ttl(k: string) { this.check(); return this.ttls.get(k) ?? -2; }
  async del(k: string) { this.check(); this.counters.delete(k); this.ttls.delete(k); return 1; }
}

describe('LoginAttemptLimiter', () => {
  const make = () => { const redis = new FakeRedis(); return { redis, limiter: new LoginAttemptLimiter(redis as any) }; };

  it('allows attempts until the failure budget is used up, then refuses with a 429 and a retry hint', async () => {
    const { limiter } = make();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      await limiter.assertAllowed('+201000000001');
      await limiter.recordFailure('+201000000001');
    }
    const error = await limiter.assertAllowed('+201000000001').catch((e) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).getResponse()).toMatchObject({ details: { code: 'TOO_MANY_FAILED_LOGINS', retryAfterSeconds: LOGIN_FAILURE_WINDOW_SECONDS } });
  });

  it('counts per phone: one account being attacked never affects another', async () => {
    const { limiter } = make();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await limiter.recordFailure('+201000000001');
    await expect(limiter.assertAllowed('+201000000001')).rejects.toBeInstanceOf(HttpException);
    await expect(limiter.assertAllowed('+201000000002')).resolves.toBeUndefined();
  });

  it('a successful login clears the counter', async () => {
    const { limiter } = make();
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) await limiter.recordFailure('+201000000001');
    await limiter.clear('+201000000001');
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) await limiter.recordFailure('+201000000001');
    await expect(limiter.assertAllowed('+201000000001')).resolves.toBeUndefined();
  });

  it('the window starts at the first failure and is set once', async () => {
    const { limiter, redis } = make();
    await limiter.recordFailure('+201000000001');
    expect(redis.ttls.get('login-fail:+201000000001')).toBe(LOGIN_FAILURE_WINDOW_SECONDS);
    redis.ttls.set('login-fail:+201000000001', 100);
    await limiter.recordFailure('+201000000001');
    expect(redis.ttls.get('login-fail:+201000000001')).toBe(100); // not extended by later failures
  });

  it('fails OPEN when Redis is unavailable: it never blocks sign-in and never throws', async () => {
    const { limiter, redis } = make();
    redis.failing = true;
    await expect(limiter.assertAllowed('+201000000001')).resolves.toBeUndefined();
    await expect(limiter.recordFailure('+201000000001')).resolves.toBeUndefined();
    await expect(limiter.clear('+201000000001')).resolves.toBeUndefined();
  });
});

describe('AuthService password login with the per-account limiter', () => {
  const build = async () => {
    const redis = new FakeRedis();
    const limiter = new LoginAttemptLimiter(redis as any);
    const hash = await bcrypt.hash('right-password', 4);
    const user = { id: 'u1', phone: '+201000000009', role: Role.DRIVER, isActive: true, passwordHash: hash, fullName: 'D' };
    const usersService = { findByPhoneWithPasswordHash: jest.fn(async (p: string) => (p === user.phone ? user : null)) };
    const service = new AuthService(usersService as any, {} as any, {} as any, {} as any, {} as any, {} as any, limiter);
    (service as any).issueTokens = jest.fn(async () => ({ accessToken: 'a', refreshToken: 'r' }));
    return { service, usersService, redis, user };
  };

  it('after the budget of wrong passwords, even the RIGHT password is refused (429) and no password hashing is attempted', async () => {
    const { service, usersService, user } = await build();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await expect(service.loginDriverWithPassword(user.phone, `wrong-${i}`)).rejects.toThrow('Invalid credentials.');
    const compare = jest.spyOn(bcrypt, 'compare');
    const lookups = usersService.findByPhoneWithPasswordHash.mock.calls.length;
    await expect(service.loginDriverWithPassword(user.phone, 'right-password')).rejects.toMatchObject({ status: 429 });
    expect(compare).not.toHaveBeenCalled(); // refused before any bcrypt work
    expect(usersService.findByPhoneWithPasswordHash.mock.calls.length).toBe(lookups); // ...and before any DB lookup
    compare.mockRestore();
  });

  it('unknown phones are counted too, so the 429 never reveals whether an account exists', async () => {
    const { service } = await build();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await expect(service.loginDriverWithPassword('+201099999999', 'x')).rejects.toThrow('Invalid credentials.');
    await expect(service.loginDriverWithPassword('+201099999999', 'x')).rejects.toMatchObject({ status: 429 });
  });

  it('a correct login before the budget is exhausted succeeds and resets the counter', async () => {
    const { service, user, redis } = await build();
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) await expect(service.loginDriverWithPassword(user.phone, 'nope')).rejects.toThrow();
    await expect(service.loginDriverWithPassword(user.phone, 'right-password')).resolves.toEqual({ accessToken: 'a', refreshToken: 'r' });
    expect(redis.counters.has(`login-fail:${user.phone}`)).toBe(false);
  });
});
