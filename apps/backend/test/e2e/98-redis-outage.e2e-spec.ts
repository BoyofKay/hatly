/**
 * Group 8 / phase 20 — the REAL application booted against an UNREACHABLE Redis (a closed port).
 * Redis-independent endpoints must keep serving; Redis-dependent ones must fail fast and readably
 * (503, bounded latency, no internals), and readiness must say exactly which dependency is down.
 */
import { bootWorld, World } from './support/world';
import { Scenario, nextPhone, DEFAULT_PASSWORD } from './support/actors';
import { boundary } from './support/external-boundary';

describe('E2E — Redis outage', () => {
  let healthy: World;
  let world: World;
  let customerPhone: string;
  const originalRedisUrl = process.env.REDIS_URL;

  beforeAll(async () => {
    // 1) a healthy app seeds a customer (passwords do not depend on Redis to exist)
    healthy = await bootWorld();
    const s = new Scenario(healthy);
    await s.configureDeliveryPricing(); // admin/config need Redis-backed logins, so seed everything while Redis is healthy
    await s.setConfig('CUSTOMER_OTP_ENABLED', true); // makes the setting row exist; the outage tests flip it directly in the database
    customerPhone = (await s.customer('Outage Customer')).phone;
    await healthy.close();
    // 2) the app under test: same database, Redis pointing at a closed port
    process.env.REDIS_URL = 'redis://localhost:6390/14';
    world = await bootWorld({ resetInfrastructure: false });
  }, 60_000);
  afterAll(async () => {
    process.env.REDIS_URL = originalRedisUrl;
    try {
      expect(world.unhandledServerErrors()).toEqual([]); // outages are 503s with a distinct log line, never "unhandled"
    } finally {
      await world.close();
    }
  });

  const timed = async <T>(fn: () => Promise<T>) => {
    const started = Date.now();
    const value = await fn();
    return { value, ms: Date.now() - started };
  };

  it('liveness stays 200; readiness is 503 and names the failing dependency without leaking connection details', async () => {
    expect((await world.api('get', '/health')).status).toBe(200);
    const ready = await world.api('get', '/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.error.details).toEqual({ status: 'degraded', checks: { database: 'up', redis: 'down' } });
    expect(JSON.stringify(ready.body)).not.toMatch(/6390|localhost|redis:\/\//);
  });

  it('endpoints that do not need Redis keep working (public catalog, search)', async () => {
    expect((await world.api('get', '/sectors')).status).toBe(200);
    expect((await world.api('get', '/search', { query: { q: 'abc' } })).status).toBe(200);
  });

  const setOtpEnabled = (value: boolean) => world.ds.query("UPDATE business_config SET value = $1::jsonb WHERE key = 'CUSTOMER_OTP_ENABLED'", [JSON.stringify(value)]);
  const userRows = (phone: string) => world.ds.query('SELECT password_hash FROM users WHERE phone = $1', [phone]);

  it('Redis-backed auth fails FAST and CLEARLY: 503, bounded latency, generic body, and no SMS is sent for a code that could not be stored', async () => {
    boundary.reset();
    const login = await timed(() => world.api('post', '/auth/customer/password/login', { body: { phone: customerPhone, password: DEFAULT_PASSWORD } }));
    expect(login.value.status).toBe(503);
    expect(login.value.body.error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', message: 'A required service is temporarily unavailable. Please try again shortly.' });
    expect(login.ms).toBeLessThan(8000);

    const codePhone = nextPhone();
    const requestCode = await timed(() => world.api('post', '/auth/customer/register/request-code', { body: { phone: codePhone } }));
    expect(requestCode.value.status).toBe(503);
    expect(requestCode.ms).toBeLessThan(8000);
    expect(boundary.sms).toHaveLength(0);
    expect(JSON.stringify([login.value.body, requestCode.value.body])).not.toMatch(/ioredis|maxRetries|6390|Reached the max/i);
    for (const res of [login.value, requestCode.value]) expect(res.body.error.correlationId).toBe(res.headers['x-correlation-id']);
  });

  it('REGISTRATION with Redis down (OTP ON): the code check needs Redis, so it fails with a 503 BEFORE anything is written — no account row, and a retry is clean', async () => {
    await setOtpEnabled(true);
    const phone = nextPhone();
    const res = await timed(() => world.api('post', '/auth/customer/password/register', { body: { phone, fullName: 'No Redis', password: DEFAULT_PASSWORD, code: '123456' } }));
    expect(res.value.status).toBe(503);
    expect(res.ms).toBeLessThan(8000);
    expect(await userRows(phone)).toEqual([]);
    expect(res.value.body.error.correlationId).toBe(res.value.headers['x-correlation-id']);
    // and without a code it is the (Redis-free) 400 — the account still does not exist
    const noCode = await world.api('post', '/auth/customer/password/register', { body: { phone, fullName: 'No Redis', password: DEFAULT_PASSWORD } });
    expect(noCode.status).toBe(400);
    expect(await userRows(phone)).toEqual([]);
  });

  it('REGISTRATION with Redis down (OTP OFF): the session (refresh jti) needs Redis, so it is stored BEFORE the account row — the request fails with a 503 and NO account exists, so a retry is never an ambiguous 401', async () => {
    await setOtpEnabled(false);
    try {
      const phone = nextPhone();
      const res = await timed(() => world.api('post', '/auth/customer/password/register', { body: { phone, fullName: 'No Redis', password: DEFAULT_PASSWORD } }));
      expect(res.value.status).toBe(503);
      expect(res.value.body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(res.ms).toBeLessThan(8000);
      expect(await userRows(phone)).toEqual([]); // the bug this guards against: a saved row (with password) and a 503
      expect(boundary.sms).toHaveLength(0);
      const retry = await world.api('post', '/auth/customer/password/register', { body: { phone, fullName: 'No Redis', password: DEFAULT_PASSWORD } });
      expect(retry.status).toBe(503); // still down: the same clean failure, not "already registered"
      expect(await userRows(phone)).toEqual([]);
    } finally {
      await setOtpEnabled(true);
    }
  });

  it('the outage is logged loudly (error level, correlation id) so it can alert', async () => {
    await world.api('post', '/auth/customer/password/login', { body: { phone: customerPhone, password: DEFAULT_PASSWORD } });
    const lines = world.logs.filter((l) => l.level === 'error' && l.message.startsWith('Dependency unavailable'));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => /correlationId=[\w-]+\] on POST \/api\/v1\/auth\/customer\/password\/login/.test(l.message))).toBe(true);
  });

  it('checkout is refused cleanly when its pricing depends on the (uncached) Maps path and Redis is down — never a partial order', async () => {
    const before = Number((await world.ds.query('SELECT count(*)::int AS n FROM orders'))[0].n);
    // Any authenticated customer call needs a token; issuing one needs Redis, so mint one directly with the test secret.
    const jwt = await import('jsonwebtoken');
    const [row] = await world.ds.query('SELECT id, phone FROM users WHERE phone = $1', [customerPhone]);
    const token = jwt.sign({ sub: row.id, role: 'CUSTOMER', phone: row.phone }, 'e2e-access-secret', { expiresIn: '5m' });
    const res = await world.api('get', '/cart', { token });
    expect(res.status).toBe(200); // cart reads are pure PostgreSQL
    const order = await world.api('post', '/orders', { token, body: { deliveryAddress: { line1: 'x', latitude: 30.4, longitude: 31.5 }, paymentMethod: 'COD' } });
    expect([400, 404, 503]).toContain(order.status);
    expect(Number((await world.ds.query('SELECT count(*)::int AS n FROM orders'))[0].n)).toBe(before);
  });
});
