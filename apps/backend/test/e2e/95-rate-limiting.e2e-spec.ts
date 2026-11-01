/**
 * Group 8 / phase 19 — rate limiting against the REAL production throttler (no storage override):
 * the per-route limits on the registration/login endpoints, the global limit, the 429 contract, and that a
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

  const registerBody = (label: string) => ({ phone: nextPhone(), fullName: label, password: DEFAULT_PASSWORD });

  /** Boots the throttled app with OTP set explicitly (settings persist in the database between boots). OFF: registrations need no
   *  code, so the limiter (not the code check) is what is measured. */
  const bootWithOtp = async (enabled: boolean) => {
    await boot();
    await new Scenario(world).setConfig('CUSTOMER_OTP_ENABLED', enabled);
  };
  const bootWithOtpOff = () => bootWithOtp(false);

  it('POST /auth/customer/password/register: 5 requests per minute, the 6th is a 429 that never reaches business logic (no account is created)', async () => {
    await bootWithOtpOff();
    for (let i = 1; i <= 5; i += 1) {
      const res = await world.api('post', '/auth/customer/password/register', { body: registerBody(`Flood ${i}`) });
      expect({ i, status: res.status }).toEqual({ i, status: 200 });
    }
    const before = Number((await world.ds.query('SELECT count(*)::int AS n FROM users'))[0].n);
    const overPhone = nextPhone();
    const limited = await world.api('post', '/auth/customer/password/register', {
      body: { phone: overPhone, fullName: 'Flood 6', password: DEFAULT_PASSWORD },
      headers: { 'x-correlation-id': 'rate-trace-1' },
    });
    expect(limited.status).toBe(429);
    expect(limited.body.error).toMatchObject({ code: 'TOO_MANY_REQUESTS', correlationId: 'rate-trace-1' });
    expect(limited.headers['x-correlation-id']).toBe('rate-trace-1');
    expect(limited.headers['retry-after']).toMatch(/^\d+$/);
    expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(Number((await world.ds.query('SELECT count(*)::int AS n FROM users'))[0].n)).toBe(before); // throttled BEFORE any account was created
    expect(await world.ds.query('SELECT 1 FROM users WHERE phone = $1', [overPhone])).toEqual([]);
    expect(limited.body.error.message).not.toMatch(/redis|throttler|storage/i);
  });

  it('POST /auth/customer/register/request-code: 5 per minute per client, the 6th is a 429 and sends no SMS — the SMS-flooding brake on the pre-registration code', async () => {
    await bootWithOtp(true);
    for (let i = 1; i <= 5; i += 1) {
      const res = await world.api('post', '/auth/customer/register/request-code', { body: { phone: nextPhone() } });
      expect({ i, status: res.status }).toEqual({ i, status: 200 });
    }
    expect(boundary.sms).toHaveLength(5);
    const limited = await world.api('post', '/auth/customer/register/request-code', { body: { phone: nextPhone() }, headers: { 'x-correlation-id': 'rate-trace-2' } });
    expect(limited.status).toBe(429);
    expect(limited.body.error).toMatchObject({ code: 'TOO_MANY_REQUESTS', correlationId: 'rate-trace-2' });
    expect(limited.headers['retry-after']).toMatch(/^\d+$/);
    expect(boundary.sms).toHaveLength(5); // throttled BEFORE any SMS was attempted
  });

  it('the per-phone resend cooldown also holds: asking again for the SAME phone within the cooldown sends no second SMS', async () => {
    await bootWithOtp(true);
    const phone = nextPhone();
    expect((await world.api('post', '/auth/customer/register/request-code', { body: { phone } })).status).toBe(200);
    expect((await world.api('post', '/auth/customer/register/request-code', { body: { phone } })).status).toBe(200);
    expect(boundary.sms).toHaveLength(1);
  });

  it('POST /auth/customer/password/login: 10/min per client; unrelated routes keep working while it is limited', async () => {
    await bootWithOtpOff();
    for (let i = 0; i < 10; i += 1) {
      // a different phone each time, so the per-ACCOUNT brake never trips first: this exercises the per-client route limit
      const res = await world.api('post', '/auth/customer/password/login', { body: { phone: nextPhone(), password: 'not-a-real-password' } });
      expect({ i, status: res.status }).toEqual({ i, status: 401 });
    }
    expect((await world.api('post', '/auth/customer/password/login', { body: { phone: nextPhone(), password: 'not-a-real-password' } })).status).toBe(429);
    expect((await world.api('get', '/health')).status).toBe(200);
    expect((await world.api('get', '/sectors')).status).toBe(200);
    // limits are per ROUTE: the register limiter still has its full budget
    expect((await world.api('post', '/auth/customer/password/register', { body: registerBody('Fresh Route') })).status).toBe(200);
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
    await bootWithOtpOff();
    for (let i = 0; i < 5; i += 1) {
      const res = await world.api('post', '/auth/customer/password/register', { body: registerBody('Same Proxy'), headers: { 'x-forwarded-for': `203.0.113.${i + 1}` } });
      expect(res.status).toBe(200);
    }
    const sixth = await world.api('post', '/auth/customer/password/register', { body: registerBody('Other User'), headers: { 'x-forwarded-for': '198.51.100.99' } });
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

  it('authenticated customer endpoints that guess secrets or send SMS are limited per client: password change 5/min, verification request 5/min, code confirm 10/min', async () => {
    await bootWithOtpOff();
    const s = new Scenario(world);
    const c = await s.customer();
    const call = (path: string, method: 'patch' | 'post', body: unknown) => world.api(method, path, { token: c.accessToken, body });
    const statuses = async (path: string, method: 'patch' | 'post', body: unknown, n: number) => {
      const out: number[] = [];
      for (let i = 0; i < n; i += 1) out.push((await call(path, method, body)).status);
      return out;
    };
    const wrongPassword = { password: 'a-new-password-1', currentPassword: 'definitely-wrong' };
    const pw = await statuses('/auth/customer/password', 'patch', wrongPassword, 6);
    expect(pw.slice(0, 5).every((x) => x !== 429)).toBe(true);
    expect(pw[5]).toBe(429);
    const req = await statuses('/auth/customer/verify-phone/request', 'post', {}, 6);
    expect(req.slice(0, 5).every((x) => x !== 429)).toBe(true);
    expect(req[5]).toBe(429);
    const confirm = await statuses('/auth/customer/verify-phone/confirm', 'post', { code: '000000' }, 11);
    expect(confirm.slice(0, 10).every((x) => x !== 429)).toBe(true);
    expect(confirm[10]).toBe(429);
  });
});
