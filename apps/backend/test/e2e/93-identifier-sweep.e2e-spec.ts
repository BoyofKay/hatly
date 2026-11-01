/**
 * Security milestone — systematic identifier sweep over the LIVE route inventory (support/route-inventory.ts).
 *
 * Every route with a path parameter is called, as the role that is actually allowed in (public → no token, roles → the first allowed
 * role, permission → SUPER_ADMIN), with identifiers an attacker would try: malformed, a well-formed id that never existed, an injection
 * string, a path-traversal string, and an oversized value. The rule: a denied/unknown identifier is a 4xx (400/403/404/409/422) — never a
 * 5xx (an unintended 500 is both a reliability bug and an oracle), never a stack trace or SQL in the body.
 */
import { bootWorld, World } from './support/world';
import { Actor, Scenario } from './support/actors';
import { RouteRow, scanRoutes } from './support/route-inventory';

const NEVER_EXISTS = '00000000-0000-4000-8000-000000000000';
const HOSTILE_IDS = ['not-a-uuid', NEVER_EXISTS, "1' OR '1'='1", '..%2F..%2Fetc%2Fpasswd', 'x'.repeat(2000), '-1', '0'];

describe('E2E — identifier sweep: no route answers a bad or foreign identifier with a 5xx', () => {
  let world: World;
  let routes: RouteRow[];
  const tokens: Record<string, string | undefined> = {};

  beforeAll(async () => {
    world = await bootWorld();
    const s = new Scenario(world);
    const area = await s.serviceArea({ radiusMeters: 50000 });
    const vendor = await s.vendor({ name: 'Sweep Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    const driver: Actor = await s.driver({ lat: 30.4212, lng: 31.5612 });
    const customer = await s.customer('Sweep Customer');
    const superAdmin = await s.superAdmin();
    tokens.CUSTOMER = customer.accessToken;
    tokens.VENDOR = vendor.manager.accessToken;
    tokens.VENDOR_MANAGER = vendor.manager.accessToken;
    tokens.DRIVER = driver.accessToken;
    tokens.ADMIN = superAdmin.accessToken;
    tokens.SUPER_ADMIN = superAdmin.accessToken;
    routes = scanRoutes(world.app).filter((r) => r.path.includes(':'));
  });
  afterAll(async () => {
    await world.close();
  });

  const tokenFor = (r: RouteRow): string | undefined => {
    if (r.rule === 'PUBLIC') return undefined;
    if (r.rule === 'PERMISSION') return tokens.SUPER_ADMIN;
    return tokens[r.roles[0]] ?? tokens.SUPER_ADMIN;
  };

  it('the sweep covers every parameterised route of the application', () => {
    expect(routes.length).toBeGreaterThan(80);
  });

  it('hostile identifiers in the PATH never produce a 5xx, a stack trace or SQL text', async () => {
    const failures: string[] = [];
    for (const r of routes) {
      for (const id of HOSTILE_IDS) {
        const path = r.path.replace(/:[A-Za-z]+/g, encodeURIComponent(decodeURIComponent(id)));
        const verb = r.verb.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete';
        const res = await world.api(verb, path, { token: tokenFor(r), body: verb === 'get' || verb === 'delete' ? undefined : {} });
        const text = JSON.stringify(res.body ?? '');
        if (res.status >= 500 || /QueryFailedError|at [A-Za-z]+\.|SELECT |invalid input syntax/i.test(text)) {
          failures.push(`${r.route} [${id.slice(0, 20)}] → ${res.status} ${text.slice(0, 160)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('hostile identifiers in common QUERY parameters never produce a 5xx either', async () => {
    const failures: string[] = [];
    const gets = scanRoutes(world.app).filter((r) => r.verb === 'GET' && !r.path.includes(':'));
    const params = ['page', 'limit', 'sectorId', 'subcategoryId', 'branchId', 'vendorBranchId', 'categoryId', 'status', 'sort', 'q', 'search', 'lat', 'lng', 'latitude', 'longitude', 'minRating', 'customerId', 'orderId'];
    for (const r of gets) {
      // 18 params × 500 chars stays under Node's 16 KB request-head limit (beyond it the server resets the socket before the app runs);
      // the 2000-char value is exercised through one parameter at a time below.
      for (const id of ['not-a-uuid', '-1', '99999999999', "1' OR '1'='1", 'x'.repeat(500)]) {
        const query = Object.fromEntries(params.map((p) => [p, id]));
        const res = await world.api('get', r.path, { token: tokenFor(r), query });
        if (res.status >= 500) failures.push(`${r.route} [${id.slice(0, 20)}] → ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
      }
      for (const p of ['q', 'search', 'sectorId', 'vendorBranchId']) {
        const res = await world.api('get', r.path, { token: tokenFor(r), query: { [p]: 'x'.repeat(2000) } });
        if (res.status >= 500) failures.push(`${r.route} [${p}=2000 chars] → ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('pagination is bounded everywhere: limit=100000 is clamped (≤ 100) or refused (400); page=10^12 never produces a 5xx', async () => {
    const s = new Scenario(world);
    const sector = await s.sector('Sweep Sector');
    const lists: Array<[string, string | undefined, Record<string, string>]> = [
      ['/customer/loyalty/transactions', tokens.CUSTOMER, {}], ['/customer/wallet/transactions', tokens.CUSTOMER, {}], ['/orders', tokens.CUSTOMER, {}],
      ['/customer/notifications', tokens.CUSTOMER, {}], ['/admin/orders', tokens.SUPER_ADMIN, {}], ['/admin/catalog-products', tokens.SUPER_ADMIN, {}],
      ['/admin/customers', tokens.SUPER_ADMIN, {}], ['/admin/control-tower/deliveries', tokens.SUPER_ADMIN, {}],
      ['/products', undefined, { sectorId: sector.id }], ['/vendors', undefined, { sectorId: sector.id }],
    ];
    const failures: string[] = [];
    for (const [path, token, extra] of lists) {
      const huge = await world.api('get', path, { token, query: { limit: 100000, page: 1, ...extra } });
      if (huge.status === 200 ? !(huge.body.meta?.limit <= 100) : huge.status !== 400) failures.push(`${path} limit=100000 → ${huge.status} ${JSON.stringify(huge.body.meta ?? huge.body.error)}`);
      const deep = await world.api('get', path, { token, query: { limit: 10, page: 1_000_000_000_000, ...extra } });
      if (deep.status >= 500) failures.push(`${path} page=1e12 → ${deep.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('nothing in the sweep was logged as an unhandled server error', () => {
    expect(world.unhandledServerErrors()).toEqual([]);
  });
});
