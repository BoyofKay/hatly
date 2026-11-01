/**
 * M5 Batch 4 — rate limiting by endpoint risk, against the REAL throttler (Redis-backed, user-aware, with the per-client aggregate
 * limit). Complements 95-rate-limiting (auth routes, per-route default, 429 contract), which is unchanged in what it asserts.
 */
import * as request from 'supertest';
import { bootWorld, World } from './support/world';
import { Scenario, Actor, PNG_1X1_BASE64, nextPhone, DEFAULT_PASSWORD } from './support/actors';
import { flushE2eRedis, resetE2eInfrastructure } from './support/db';

const ENV_KEYS = ['RATE_LIMIT_CLIENT_PER_MINUTE', 'RATE_LIMIT_ROUTE_PER_MINUTE'];

describe('E2E — rate limits by endpoint risk (real throttler)', () => {
  let world: World;
  let s: Scenario;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    await resetE2eInfrastructure();
  });
  afterAll(() => {
    for (const k of ENV_KEYS) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
  });

  const boot = async (env: Record<string, string> = {}) => {
    for (const k of ENV_KEYS) delete process.env[k];
    Object.assign(process.env, env);
    await flushE2eRedis();
    world = await bootWorld({ throttling: 'real', resetInfrastructure: false });
    s = new Scenario(world);
  };
  afterEach(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  const statuses = async (n: number, fn: (i: number) => Promise<{ status: number }>) => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push((await fn(i)).status);
    return out;
  };
  const count = (list: number[], status: number) => list.filter((x) => x === status).length;

  describe('normal traffic is never throttled', () => {
    it('a customer browsing and shopping through a busy minute stays well inside every limit', async () => {
      await boot();
      const c = await s.customer('Browsing Customer');
      const results = [
        ...(await statuses(40, () => world.api('get', '/sectors'))),
        ...(await statuses(20, (i) => world.api('get', '/search', { query: { q: `milk${i}` }, token: c.accessToken }))),
        ...(await statuses(25, () => world.api('get', '/cart', { token: c.accessToken }))),
        ...(await statuses(25, () => world.api('get', '/orders', { token: c.accessToken }))),
      ];
      expect(count(results, 429)).toBe(0);
      expect(results.every((r) => r < 500)).toBe(true);
    });
  });

  describe('who is limited: the user when logged in, the IP only when anonymous', () => {
    it('two logged-in users behind the SAME IP have separate budgets (shared router/office is not a shared bucket)', async () => {
      await boot();
      const [a, b] = [await s.customer('Same Wifi A'), await s.customer('Same Wifi B')];
      const aStatuses = await statuses(105, () => world.api('get', '/cart', { token: a.accessToken }));
      expect(count(aStatuses, 429)).toBe(5); // A is cut off after the per-route default of 100
      expect((await world.api('get', '/cart', { token: b.accessToken })).status).toBe(200); // B, same IP, is unaffected
    });

    it('a logged-in user\'s searches (a PUBLIC route) are counted per user, not against the anonymous IP bucket', async () => {
      await boot();
      const c = await s.customer('Public Route Customer');
      const anon = await statuses(60, () => world.api('get', '/search', { query: { q: 'abc' } }));
      expect(count(anon, 429)).toBe(0);
      expect((await world.api('get', '/search', { query: { q: 'abc' } })).status).toBe(429); // anonymous IP bucket: 60 used up
      expect((await world.api('get', '/search', { query: { q: 'abc' }, token: c.accessToken })).status).toBe(200); // the logged-in user has their own
    });

    it('attaching a forged/expired token does not escape the anonymous IP limit', async () => {
      await boot();
      await statuses(60, () => world.api('get', '/search', { query: { q: 'abc' } }));
      const forged = await world.api('get', '/search', { query: { q: 'abc' }, token: 'forged.token.value' });
      expect(forged.status).toBe(429);
    });
  });

  describe('resource-intensive endpoints have their own, tighter limits', () => {
    it('search: 60 per minute', async () => {
      await boot();
      const list = await statuses(65, () => world.api('get', '/search', { query: { q: 'milk' } }));
      expect({ ok: count(list, 200), limited: count(list, 429) }).toEqual({ ok: 60, limited: 5 });
    });

    it('checkout quote: 30 per minute per user; other routes keep working', async () => {
      await boot();
      const c = await s.customer('Quote Customer');
      const list = await statuses(33, () => world.api('post', '/checkout/quote', { token: c.accessToken, body: {} }));
      expect(count(list, 429)).toBe(3);
      expect(list.slice(0, 30).every((x) => x !== 429)).toBe(true); // the first 30 reached the handler (validation errors, not throttling)
      expect((await world.api('get', '/cart', { token: c.accessToken })).status).toBe(200);
    });

    it('order creation: 10 per minute per user, and the throttled attempts never reach the order logic', async () => {
      await boot();
      const c = await s.customer('Order Spammer');
      const list = await statuses(13, () => world.api('post', '/orders', { token: c.accessToken, body: { paymentMethod: 'COD' } }));
      expect(count(list, 429)).toBe(3);
      expect(await world.ds.query('SELECT id FROM orders WHERE customer_id = $1', [c.id])).toEqual([]);
    });
  });

  describe('upload abuse', () => {
    it('image uploads: 30 per minute per user; a second user on the same IP is unaffected; nothing beyond the limit is stored', async () => {
      await boot();
      const [a, b] = [await s.customer('Uploader A'), await s.customer('Uploader B')];
      const up = (c: Actor) => world.api('post', '/uploads', { token: c.accessToken, body: { base64Content: PNG_1X1_BASE64, filename: 'x.png' } });
      const list = await statuses(33, () => up(a));
      expect({ stored: count(list, 201), limited: count(list, 429) }).toEqual({ stored: 30, limited: 3 });
      expect((await world.ds.query('SELECT count(*)::int AS n FROM uploads WHERE uploaded_by_user_id = $1', [a.id]))[0].n).toBe(30);
      expect((await up(b)).status).toBe(201);
    });
  });

  describe('the aggregate limit: spreading requests across routes cannot dodge the per-route limit', () => {
    it('one client over the per-client budget is cut off even though no single route is over its own limit', async () => {
      await boot({ RATE_LIMIT_CLIENT_PER_MINUTE: '120' });
      const c = await s.customer('Route Sprayer');
      const routes = ['/cart', '/orders', '/customer/wallet', '/customer/wallet/transactions', '/addresses'];
      const results: number[] = [];
      for (let i = 0; i < 30; i++) for (const r of routes) results.push((await world.api('get', r, { token: c.accessToken })).status);
      expect(results.length).toBe(150); // 30 per route: far below the 100/min per-route limit
      expect(count(results, 429)).toBeGreaterThan(0);
      expect(results.slice(0, 100).every((x) => x !== 429)).toBe(true); // ...but not before the budget was really spent
      const other = await s.customer('Innocent Neighbour');
      expect((await world.api('get', '/cart', { token: other.accessToken })).status).toBe(200); // another user is unaffected
    });
  });

  describe('concurrency and multiple instances', () => {
    it('120 simultaneous requests against a limit of 100 let exactly 100 through (the counter is atomic)', async () => {
      await boot();
      const results = await Promise.all(Array.from({ length: 120 }, () => world.api('get', '/sectors')));
      const list = results.map((r) => r.status);
      expect({ ok: count(list, 200), limited: count(list, 429) }).toEqual({ ok: 100, limited: 20 });
    });

    it('the limit holds ACROSS app instances: two instances share one budget instead of each granting their own', async () => {
      await boot();
      const second = await bootWorld({ throttling: 'real', resetInfrastructure: false }); // a second real app, same Redis
      try {
        const a = await statuses(40, () => world.api('get', '/search', { query: { q: 'abc' } }));
        const b: number[] = [];
        for (let i = 0; i < 40; i++) {
          b.push((await request(second.baseUrl).get('/api/v1/search').query({ q: 'abc' })).status);
        }
        const total = [...a, ...b];
        expect({ ok: count(total, 200), limited: count(total, 429) }).toEqual({ ok: 60, limited: 20 }); // 60 in TOTAL, not 60 per instance
      } finally {
        await second.close();
      }
    });
  });

  describe('authentication abuse', () => {
    it('failed password logins are counted PER ACCOUNT across routes, so rotating routes/IPs cannot keep guessing; the right password is refused while locked, other accounts are unaffected', async () => {
      await boot();
      const victim = await s.superAdmin();
      const other = await s.customer('Unrelated Customer');
      // 10 wrong guesses spread over three different login routes (each route's own per-IP limit of 10/min is not reached)
      const routes = ['/auth/password/login', '/auth/driver/login', '/auth/customer/password/login'];
      const guesses: number[] = [];
      for (let i = 0; i < 10; i++) guesses.push((await world.api('post', routes[i % 3], { body: { phone: victim.phone, password: `guess-${i}` } })).status);
      expect(guesses.every((x) => x === 401)).toBe(true);

      const locked = await world.api('post', '/auth/password/login', { body: { phone: victim.phone, password: DEFAULT_PASSWORD } });
      expect(locked.status).toBe(429);
      expect(locked.body.error.details.code).toBe('TOO_MANY_FAILED_LOGINS');
      expect(locked.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
      expect(JSON.stringify(locked.body)).not.toMatch(/redis|bcrypt|hash/i);

      const unrelated = await world.api('post', '/auth/customer/password/login', { body: { phone: other.phone, password: DEFAULT_PASSWORD } });
      expect(unrelated.status).toBe(200);
    });

    it('an unknown phone is limited exactly like a real one (no account-existence oracle)', async () => {
      await boot();
      const ghost = nextPhone();
      const routes = ['/auth/password/login', '/auth/driver/login'];
      for (let i = 0; i < 10; i++) expect((await world.api('post', routes[i % 2], { body: { phone: ghost, password: 'whatever-1' } })).status).toBe(401);
      expect((await world.api('post', '/auth/customer/password/login', { body: { phone: ghost, password: 'whatever-1' } })).status).toBe(429);
    });

    it('a successful login before the budget is spent resets the counter', async () => {
      await boot();
      const user = await s.superAdmin();
      for (let i = 0; i < 6; i++) await world.api('post', '/auth/password/login', { body: { phone: user.phone, password: `bad-${i}` } });
      expect((await world.api('post', '/auth/driver/login', { body: { phone: user.phone, password: DEFAULT_PASSWORD } })).status).toBeLessThan(500); // role-mismatch route counts as a failure, not a reset
      expect((await world.api('post', '/auth/password/login', { body: { phone: user.phone, password: DEFAULT_PASSWORD } })).status).toBe(200);
      expect(await world.redis.get(`login-fail:${user.phone}`)).toBeNull();
    });
  });

  describe('security milestone: paid-quota, financial and abuse-prone routes have their own budgets, and aliases do not reset them', () => {
    const NEVER_EXISTS = '00000000-0000-4000-8000-000000000000';

    it('geocoding (paid map quota): 30 per minute per user, then 429 with Retry-After; trailing-slash / upper-case / HEAD aliases share the SAME bucket', async () => {
      await boot();
      const c = await s.customer('Geo Customer');
      const first = await statuses(30, (i) => world.api('get', '/geo/search', { token: c.accessToken, query: { q: `cairo street ${i}` } }));
      expect(count(first, 429)).toBe(0);
      const limited = await world.api('get', '/geo/search', { token: c.accessToken, query: { q: 'one more' } });
      expect(limited.status).toBe(429);
      expect(limited.headers['retry-after']).toMatch(/^\d+$/);
      for (const path of ['/geo/search/', '/GEO/SEARCH', '/Geo/Search/']) {
        expect((await world.api('get', path, { token: c.accessToken, query: { q: 'alias try' } })).status).not.toBe(200);
      }
      const head = await request(world.baseUrl).head('/api/v1/geo/search?q=alias').set('Authorization', `Bearer ${c.accessToken}`);
      expect(head.status).not.toBe(200);
      // another customer is unaffected (per user, not global)
      const other = await s.customer('Geo Other');
      expect((await world.api('get', '/geo/search', { token: other.accessToken, query: { q: 'fresh budget' } })).status).toBe(200);
    });

    it('customer cancellation: 10 per minute — counted whatever the outcome (probing foreign ids does not get a free budget)', async () => {
      await boot();
      const c = await s.customer('Cancel Prober');
      const results = await statuses(11, () => world.api('post', `/orders/${NEVER_EXISTS}/cancel`, { token: c.accessToken, body: {} }));
      expect(results.slice(0, 10).every((x) => x === 404)).toBe(true);
      expect(results[10]).toBe(429);
    });

    it('loyalty conversion and manual-transfer claims: 10 per minute each; ratings: 20 per minute', async () => {
      await boot();
      const c = await s.customer('Money Prober');
      const conv = await statuses(11, (i) => world.api('post', '/customer/loyalty/convert', { token: c.accessToken, body: { points: 500, idempotencyKey: `k-${i}` } }));
      expect(conv.slice(0, 10).every((x) => x !== 429)).toBe(true);
      expect(conv[10]).toBe(429);
      const claims = await statuses(11, () => world.api('post', `/payments/manual-transfer/orders/${NEVER_EXISTS}/claim`, { token: c.accessToken }));
      expect(claims[10]).toBe(429);
      const ratings = await statuses(21, () => world.api('post', '/ratings/vendor', { token: c.accessToken, body: { segmentId: NEVER_EXISTS, stars: 5 } }));
      expect(count(ratings, 429)).toBe(1);
      expect(ratings[20]).toBe(429);
    });

    it('the per-account login brake cannot be dodged by re-formatting the phone: a formatted variant never even reaches a password check', async () => {
      await boot();
      const victim = await s.customer('Formatted Victim');
      const spaced = `${victim.phone.slice(0, 3)} ${victim.phone.slice(3, 5)} ${victim.phone.slice(5, 9)} ${victim.phone.slice(9)}`;
      const res = await world.api('post', '/auth/customer/password/login', { body: { phone: spaced, password: DEFAULT_PASSWORD } });
      expect([400, 401]).toContain(res.status); // the RIGHT password with a re-formatted phone is still refused: lookup is exact E.164
    });
  });
});
