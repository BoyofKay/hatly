/**
 * Group 8 / phase 18 — the HTTP error and correlation contract, plus whole-API sweeps driven by the
 * REAL router table: no route is shadowed by an earlier route, no route is accidentally public,
 * every path identifier is validated, and no failure ever leaks internals or answers 5xx for a client mistake.
 */
import * as http from 'http';
import { bootWorld, World } from './support/world';
import { Scenario, Actor, expectData } from './support/actors';

interface RouteInfo { method: string; path: string; regexp: RegExp }

const raw = (world: World, opts: { method: string; path: string; headers?: Record<string, string>; body?: string }) =>
  new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const u = new URL(world.baseUrl);
    const req = http.request({ host: u.hostname, port: u.port, method: opts.method, path: opts.path, headers: opts.headers, agent: false }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode!, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });

const UUID = '6b1f2c9e-4d5a-4b7e-8a3c-0f9d2e1a7b64';
const LEAK_PATTERN = /QueryFailedError|node_modules|\bat \w+\.\w+ \(|SELECT |INSERT |UPDATE |pg_|password_hash|typeorm|stack/i;

describe('E2E — HTTP contract', () => {
  let world: World;
  let s: Scenario;
  let superAdmin: Actor;
  let customer: Actor;
  let routes: RouteInfo[];

  const routeTable = (): RouteInfo[] => {
    const router = (world.app.getHttpAdapter().getInstance() as any)._router;
    const out: RouteInfo[] = [];
    for (const layer of router.stack) {
      if (!layer.route) continue;
      for (const method of Object.keys(layer.route.methods)) {
        out.push({ method: method.toUpperCase(), path: String(layer.route.path), regexp: layer.regexp as RegExp });
      }
    }
    return out;
  };
  const fill = (path: string, sample = UUID) => path.replace(/:(\w+)(\([^)]*\))?/g, sample);

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    superAdmin = await s.superAdmin();
    customer = await s.customer();
    routes = routeTable().filter((r) => r.path.startsWith('/api/v1'));
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('router table sweeps', () => {
    it('the router exposes a substantial API surface (guards the sweeps below against silently testing nothing)', () => {
      expect(routes.length).toBeGreaterThan(150);
    });

    it('no route is unreachable because an EARLIER route of the same method already matches its path (declaration-order shadowing)', () => {
      const shadowed: string[] = [];
      routes.forEach((later, j) => {
        const probe = fill(later.path);
        routes.slice(0, j).forEach((earlier) => {
          if (earlier.method === later.method && earlier.path !== later.path && earlier.regexp.test(probe)) {
            shadowed.push(`${later.method} ${later.path} is shadowed by ${earlier.path}`);
          }
        });
      });
      expect(shadowed).toEqual([]);
    });

    // Routes that are public BY DESIGN. Anything else answering without a token is a hole.
    const PUBLIC = [
      /^GET \/api\/v1\/health(\/ready)?$/,
      /^POST \/api\/v1\/auth\/(register|login|otp\/verify|driver\/login|password\/login|refresh|customer\/password\/login|customer\/password\/register)$/,
      /^GET \/api\/v1\/sectors$/,
      // Consolidated customer-commerce milestone (Part E — Sector Subcategories): public, same discipline as /sectors.
      /^GET \/api\/v1\/sectors\/:sectorId\/subcategories$/,
      /^GET \/api\/v1\/vendors$/,
      /^GET \/api\/v1\/search$/,
      /^GET \/api\/v1\/vendor-branches\/:(id|branchId)(\/categories|\/products)?$/,
      /^GET \/api\/v1\/products\/:id$/,
      // Catalog Foundation: public product-first discovery (by design, like the vendor marketplace above)
      /^GET \/api\/v1\/products$/,
      /^GET \/api\/v1\/catalog-products\/:id$/,
    ];
    const isPublic = (r: RouteInfo) => PUBLIC.some((p) => p.test(`${r.method} ${r.path}`));

    it('every route that is not explicitly public answers 401 to an anonymous caller — no accidentally-open endpoint', async () => {
      const open: string[] = [];
      for (const r of routes.filter((x) => !isPublic(x) && x.method !== 'HEAD')) {
        const path = fill(r.path);
        const res = await raw(world, { method: r.method, path, headers: { 'content-type': 'application/json' }, body: r.method === 'GET' || r.method === 'DELETE' ? undefined : '{}' });
        if (res.status !== 401) open.push(`${r.method} ${r.path} -> ${res.status}`);
      }
      expect(open).toEqual([]);
    });

    it('every public route really is reachable anonymously (the allowlist is not stale)', async () => {
      for (const r of routes.filter(isPublic)) {
        const res = await raw(world, { method: r.method, path: fill(r.path), headers: { 'content-type': 'application/json' }, body: r.method === 'POST' ? '{}' : undefined });
        expect({ route: `${r.method} ${r.path}`, unauthorized: res.status === 401 && !r.path.includes('/auth/') }).toEqual({ route: `${r.method} ${r.path}`, unauthorized: false });
      }
    });

    it('every path identifier is validated: a non-UUID answers 4xx on EVERY parameterised route (never a database 500)', async () => {
      const offenders: string[] = [];
      const parameterised = routes.filter((r) => /:(id|\w+Id)\b/.test(r.path) && r.method !== 'HEAD');
      expect(parameterised.length).toBeGreaterThan(60);
      for (const r of parameterised) {
        const path = r.path.replace(/:(id|\w+Id)(\([^)]*\))?/g, 'not-a-uuid').replace(/:(\w+)(\([^)]*\))?/g, UUID);
        const res = await raw(world, {
          method: r.method,
          path,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${superAdmin.accessToken}` },
          body: r.method === 'GET' || r.method === 'DELETE' ? undefined : '{}',
        });
        if (res.status >= 500 || res.status === 200 || res.status === 201) offenders.push(`${r.method} ${r.path} -> ${res.status}`);
      }
      expect(offenders).toEqual([]);
    });

    it('a NUL byte in any query string or JSON body is a 400 everywhere it could reach PostgreSQL', async () => {
      const cases = [
        { method: 'GET', path: '/api/v1/search?q=a%00b' },
        { method: 'GET', path: `/api/v1/vendor-branches/${UUID}/products?search=x%00y` },
        { method: 'POST', path: '/api/v1/addresses', body: JSON.stringify({ line1: 'a\u0000b', latitude: 30, longitude: 31 }), auth: customer.accessToken },
        { method: 'POST', path: '/api/v1/auth/register', body: JSON.stringify({ phone: '+201000000001', fullName: 'Bad\u0000Name' }) },
      ];
      for (const c of cases) {
        const res = await raw(world, { method: c.method, path: c.path, headers: { 'content-type': 'application/json', ...(c.auth ? { authorization: `Bearer ${c.auth}` } : {}) }, body: c.body });
        expect({ path: c.path, status: res.status }).toEqual({ path: c.path, status: 400 });
        expect(JSON.parse(res.body).error.details).toEqual({ code: 'INVALID_CHARACTER' });
      }
    });
  });

  describe('error envelope', () => {
    const shapes: Array<{ name: string; status: number; run: () => Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> }> = [];
    beforeAll(() => {
      const json = { 'content-type': 'application/json' };
      const auth = () => ({ ...json, authorization: `Bearer ${customer.accessToken}` });
      shapes.push(
        { name: '400 validation', status: 400, run: () => raw(world, { method: 'POST', path: '/api/v1/auth/register', headers: json, body: '{}' }) },
        { name: '400 malformed JSON', status: 400, run: () => raw(world, { method: 'POST', path: '/api/v1/cart/items', headers: auth(), body: '{"productId": ' }) },
        { name: '400 invalid identifier', status: 400, run: () => raw(world, { method: 'GET', path: '/api/v1/products/not-a-uuid' }) },
        { name: '401 no token', status: 401, run: () => raw(world, { method: 'GET', path: '/api/v1/cart' }) },
        { name: '401 bad login', status: 401, run: () => raw(world, { method: 'POST', path: '/api/v1/auth/driver/login', headers: json, body: JSON.stringify({ phone: '+201000000009', password: 'nope' }) }) },
        { name: '403 wrong role', status: 403, run: () => raw(world, { method: 'GET', path: '/api/v1/admin/drivers', headers: auth() }) },
        { name: '404 unknown route', status: 404, run: () => raw(world, { method: 'GET', path: '/api/v1/nothing/here' }) },
        { name: '404 unknown resource', status: 404, run: () => raw(world, { method: 'GET', path: `/api/v1/orders/${UUID}`, headers: auth() }) },
        { name: '413 body too large', status: 413, run: () => raw(world, { method: 'POST', path: '/api/v1/cart/items', headers: auth(), body: JSON.stringify({ pad: 'a'.repeat(300_000) }) }) },
      );
    });

    it('every failure kind uses {error:{code,message,correlationId}}, echoes the SAME id in the x-correlation-id header, and never leaks internals', async () => {
      for (const shape of shapes) {
        const res = await shape.run();
        const body = JSON.parse(res.body);
        expect({ name: shape.name, status: res.status }).toEqual({ name: shape.name, status: shape.status });
        expect(body.error).toEqual(expect.objectContaining({ code: expect.any(String), correlationId: expect.stringMatching(/^[A-Za-z0-9_-]{1,100}$/) }));
        expect(['string', 'object']).toContain(typeof body.error.message);
        expect({ name: shape.name, header: res.headers['x-correlation-id'] }).toEqual({ name: shape.name, header: body.error.correlationId });
        expect({ name: shape.name, leaked: LEAK_PATTERN.test(res.body) }).toEqual({ name: shape.name, leaked: false });
        expect(res.headers['content-type']).toMatch(/application\/json/);
        expect(res.headers['x-powered-by']).toBeUndefined();
      }
    });

    it('a caller-supplied correlation id survives every failure kind, including ones raised before the request-context middleware (413, malformed JSON)', async () => {
      const withId = await raw(world, { method: 'POST', path: '/api/v1/cart/items', headers: { 'content-type': 'application/json', authorization: `Bearer ${customer.accessToken}`, 'x-correlation-id': 'caller-trace-42' }, body: JSON.stringify({ pad: 'a'.repeat(300_000) }) });
      expect(withId.status).toBe(413);
      expect(withId.headers['x-correlation-id']).toBe('caller-trace-42');
      expect(JSON.parse(withId.body).error.correlationId).toBe('caller-trace-42');
    });

    it('a client mistake is NEVER a 5xx: hostile inputs across the public surface all answer 4xx (or a valid 2xx)', async () => {
      const hostile = ["' OR '1'='1", '"; DROP TABLE users; --', '<script>alert(1)</script>', '%', '\\', '../../etc/passwd', '🙂'.repeat(50), '{{7*7}}', '${jndi:ldap://x}', '0'.repeat(500)];
      for (const h of hostile) {
        const enc = encodeURIComponent(h);
        for (const path of [`/api/v1/search?q=${enc}`, `/api/v1/vendor-branches/${UUID}/products?search=${enc}`, `/api/v1/vendors?sectorId=${enc}`, `/api/v1/vendor-branches/${enc}`]) {
          const res = await raw(world, { method: 'GET', path });
          expect({ path: path.slice(0, 80), status: res.status < 500 }).toEqual({ path: path.slice(0, 80), status: true });
        }
        const login = await raw(world, { method: 'POST', path: '/api/v1/auth/customer/password/login', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: h, password: h }) });
        expect(login.status).toBeLessThan(500);
      }
      expect(await world.ds.query("SELECT to_regclass('public.users') AS t")).toEqual([{ t: 'users' }]); // the injection strings were inert
    });

    it('pagination and enum query parameters reject garbage with 400 instead of erroring', async () => {
      const bad = ['page=0', 'page=-1', 'page=abc', 'limit=0', 'limit=-5', 'limit=1.5', 'status=NOT_A_STATUS'];
      for (const q of bad) {
        const res = await world.api('get', `/orders?${q}`, { token: customer.accessToken });
        expect({ q, status: res.status }).toEqual({ q, status: 400 });
      }
      expect((await world.api('get', '/orders?page=1&limit=1000', { token: customer.accessToken })).status).toBeLessThan(500);
    });

    it('unsupported content types and empty bodies are 400, never 500', async () => {
      const auth = { authorization: `Bearer ${customer.accessToken}` };
      for (const contentType of ['text/plain', 'application/xml', 'multipart/form-data; boundary=x', 'application/x-www-form-urlencoded']) {
        const res = await raw(world, { method: 'POST', path: '/api/v1/cart/items', headers: { ...auth, 'content-type': contentType }, body: 'productId=1' });
        expect({ contentType, status: res.status < 500 }).toEqual({ contentType, status: true });
      }
      expect((await raw(world, { method: 'POST', path: '/api/v1/cart/items', headers: { ...auth, 'content-type': 'application/json' } })).status).toBe(400);
    });
  });

  describe('CHARACTERIZATION — deliberately open / not yet hardened (reported, not changed)', () => {
    it('CORS allows any origin (main.ts: "tighten to known origins before production launch")', async () => {
      const res = await raw(world, { method: 'OPTIONS', path: '/api/v1/cart', headers: { origin: 'https://any.example', 'access-control-request-method': 'GET' } });
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    it('the Swagger UI is served publicly at /docs in this configuration', async () => {
      expect((await raw(world, { method: 'GET', path: '/docs' })).status).toBe(200);
    });

    it('an unsupported method on an existing path is a 404 (not 405)', async () => {
      expect((await world.api('put', '/cart', { token: customer.accessToken })).status).toBe(404);
    });

    it('health and readiness report dependencies without leaking connection details', async () => {
      const ready = await world.api('get', '/health/ready');
      expect(ready.status).toBe(200);
      expect(ready.body.data).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
      expect(JSON.stringify(ready.body)).not.toMatch(/postgres:\/\/|redis:\/\/|hatly:/);
    });
  });

  it('admin listing endpoints for the sweep fixtures behave (sanity: a real authenticated admin call works)', async () => {
    expectData(await world.api('get', '/admin/service-areas', { token: superAdmin.accessToken }));
  });
});
