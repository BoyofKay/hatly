/**
 * Group 8 / phase 19 — rate limiting against the REAL production throttler (no storage override):
 * the per-route limits on the OTP/login endpoints, the global limit, the 429 contract, and that a
 * throttled request never reaches business logic. Counters live in the shared Redis (so limits hold across app instances),
 * so every test starts from an emptied Redis database as well as a freshly booted app.
 */
import { bootWorld, World } from './support/world';
import { Scenario, nextPhone, DEFAULT_PASSWORD } from './support/actors';
import { boundary } from './support/external-boundary';
import { flushE2eRedis, resetE2eInfrastructure } from './support/db';

describe('E2E — rate limiting (real throttler)', () => {
  let world: World;

  beforeAll(async () => {
    await resetE2eInfrastructure(); // once; every test then boots a fresh app (fresh in-memory counters) on the same clean schema
  });

  const boot = async () => {
    await flushE2eRedis(); // counters are shared state in Redis now, not per-app memory
    world = await bootWorld({ throttling: 'real', resetInfrastructure: false });
    boundary.reset();
  };
  afterEach(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('POST /auth/register: 5 requests per minute, the 6th is a 429 that never reaches the SMS provider', async () => {
    await boot();
    for (let i = 1; i <= 5; i += 1) {
      const res = await world.api('post', '/auth/register', { body: { phone: nextPhone(), fullName: `Flood ${i}` } });
      expect({ i, status: res.status }).toEqual({ i, status: 200 });
    }
    expect(boundary.sms).toHaveLength(5);
    const limited = await world.api('post', '/auth/register', { body: { phone: nextPhone(), fullName: 'Flood 6' }, headers: { 'x-correlation-id': 'rate-trace-1' } });
    expect(limited.status).toBe(429);
    expect(limited.body.error).toMatchObject({ code: 'TOO_MANY_REQUESTS', correlationId: 'rate-trace-1' });
    expect(limited.headers['x-correlation-id']).toBe('rate-trace-1');
    expect(limited.headers['retry-after']).toMatch(/^\d+$/);
    expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(boundary.sms).toHaveLength(5); // throttled BEFORE any SMS was sent
    expect(limited.body.error.message).not.toMatch(/redis|throttler|storage/i);
  });

  it('POST /auth/login (OTP request): 5/min per client; unrelated routes keep working while it is limited', async () => {
    await boot();
    const s = new Scenario(world);
    await world.ds.query('SELECT 1');
    const phone = nextPhone();
    for (let i = 0; i < 5; i += 1) expect((await world.api('post', '/auth/login', { body: { phone } })).status).toBe(200);
    expect((await world.api('post', '/auth/login', { body: { phone } })).status).toBe(429);
    expect((await world.api('get', '/health')).status).toBe(200);
    expect((await world.api('get', '/sectors')).status).toBe(200);
    // limits are per ROUTE: the register limiter still has its full budget
    expect((await world.api('post', '/auth/register', { body: { phone: nextPhone(), fullName: 'Fresh Route' } })).status).toBe(200);
    expect(s).toBeDefined();
  });

  it('password logins: 10/min; wrong-password guessing is throttled — and the RIGHT password is throttled too once the budget is spent', async () => {
    await boot();
    const s = new Scenario(world);
    const superAdmin = await s.superAdmin(); // consumes 1 of the 10 password-login attempts
    for (let i = 0; i < 9; i += 1) {
      const res = await world.api('post', '/auth/password/login', { body: { phone: superAdmin.phone, password: `guess-${i}` } });
      expect({ i, status: res.status }).toEqual({ i, status: 401 });
    }
    const blockedGuess = await world.api('post', '/auth/password/login', { body: { phone: superAdmin.phone, password: 'guess-10' } });
    expect(blockedGuess.status).toBe(429);
    const blockedRight = await world.api('post', '/auth/password/login', { body: { phone: superAdmin.phone, password: DEFAULT_PASSWORD } });
    expect(blockedRight.status).toBe(429); // an attacker cannot test the real password while blocked; the owner waits out the window
  });

  it('OTP verification: 10/min per client — brute-forcing codes across many attempts is cut off', async () => {
    await boot();
    const phone = nextPhone();
    await world.api('post', '/auth/register', { body: { phone, fullName: 'Guessed' } });
    let limitedAt = 0;
    for (let i = 1; i <= 12; i += 1) {
      const res = await world.api('post', '/auth/otp/verify', { body: { phone, code: '000000' } });
      if (res.status === 429 && !limitedAt) limitedAt = i;
    }
    expect(limitedAt).toBe(11);
  });

  it('the global limit is 100 requests per minute per route per client, then 429 with the standard error envelope', async () => {
    await boot();
    const statuses: number[] = [];
    for (let i = 0; i < 100; i += 1) statuses.push((await world.api('get', '/sectors')).status);
    expect(statuses.every((s) => s === 200)).toBe(true);
    const over = await world.api('get', '/sectors');
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(over.body.error.correlationId).toBe(over.headers['x-correlation-id']);
    // a different route has its own bucket
    expect((await world.api('get', '/search', { query: { q: 'abc' } })).status).toBe(200);
  });

  it('CHARACTERIZATION: the client identity is the socket address only — X-Forwarded-For is ignored, so users behind one proxy/NAT share a bucket (deployment: needs an explicit trust-proxy setting)', async () => {
    await boot();
    for (let i = 0; i < 5; i += 1) {
      const res = await world.api('post', '/auth/register', { body: { phone: nextPhone(), fullName: 'Same Proxy' }, headers: { 'x-forwarded-for': `203.0.113.${i + 1}` } });
      expect(res.status).toBe(200);
    }
    const sixth = await world.api('post', '/auth/register', { body: { phone: nextPhone(), fullName: 'Other User' }, headers: { 'x-forwarded-for': '198.51.100.99' } });
    expect(sixth.status).toBe(429); // spoofing the header does not evade the limit (good), but honest users behind one proxy IP would be throttled together (operational risk)
  });

  it('CHARACTERIZATION: health probes are throttled like any other route (100/min per client)', async () => {
    await boot();
    let firstLimited = 0;
    for (let i = 1; i <= 105; i += 1) {
      if ((await world.api('get', '/health')).status === 429 && !firstLimited) firstLimited = i;
    }
    expect(firstLimited).toBe(101);
  });
});
