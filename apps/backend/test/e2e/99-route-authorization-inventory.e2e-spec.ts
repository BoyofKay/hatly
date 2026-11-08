/**
 * Route authorization inventory — every route of the REAL, fully wired application, listed with the access rule that is actually ENFORCED:
 *   PUBLIC            @Public() (no token needed)
 *   PERMISSION        @RequiresPermission(...) — PermissionsGuard is global
 *   ROLES             @Roles(...) AND RolesGuard really applied (class or method) — a @Roles() with no RolesGuard enforces NOTHING
 *   AUTHENTICATED     a valid token of ANY role and nothing more — allowed only for the routes listed below, each of which is
 *                     scoped to the caller's own identity by construction
 * A new route that falls into AUTHENTICATED without being listed here fails this test: that is how an endpoint accidentally open to every
 * role (customer reaching a vendor/admin action) is caught before it ships.
 */
import { bootWorld, World } from './support/world';
import { RouteRow, scanRoutes } from './support/route-inventory';

/** Routes that intentionally accept any authenticated role. Each acts only on the caller's own identity (the token's user id). */
const ANY_AUTHENTICATED_ALLOWED = new Set<string>([
  'POST /auth/logout', // ends the caller's own session — meaningful for every role
  'POST /uploads', // any signed-in role may upload an image (proof of delivery, custom-item photos); the upload is recorded against the caller and only its owner may reference it
]);

/**
 * Routes reachable WITHOUT a token, each reviewed: sign-in/registration/refresh (identity is the credential itself), health probes, and
 * the public marketplace catalogue (active vendors, branches, products, sectors — data a shop window shows anyway). A route becoming
 * public must be added here deliberately, after review.
 */
const PUBLIC_ALLOWED = new Set<string>([
  'POST /auth/customer/password/login', 'POST /auth/customer/password/register', 'POST /auth/customer/register/request-code',
  'POST /auth/dashboard/login', 'POST /auth/dashboard/logout', 'POST /auth/dashboard/refresh', 'POST /auth/driver/login',
  'POST /auth/password/login', 'POST /auth/refresh', 'POST /auth/register',
  // account deletion WITHOUT the app (Google Play policy): password-verified self-service, or a request that deletes nothing by itself
  'POST /account-deletion/delete', 'POST /account-deletion/requests',
  'GET /health', 'GET /health/ready',
  // P0 Admin alerts (2026-11-08): a service worker reports "displayed/clicked" with no session; the proof is the one-time token inside that
  // encrypted push message (hashed at rest, timing-safe check, throttled); it can only stamp that one delivery and reveals nothing.
  'POST /push-receipts',
  'GET /catalog-products/:id', 'GET /products', 'GET /products/:id', 'GET /search', 'GET /sectors', 'GET /sectors/:sectorId/subcategories', 'GET /home-banners',
  // Home aggregation (public catalogue composition) and the privacy-safe client telemetry intake / client config (no identifiers, throttled, size-limited)
  'GET /home/product-sections', 'POST /telemetry/client-metrics', 'GET /config/client',
  'GET /vendor-branches/:branchId/categories', 'GET /vendor-branches/:branchId/products', 'GET /vendor-branches/:id', 'GET /vendors',
]);

describe('E2E — route authorization inventory', () => {
  let world: World;
  const rows: RouteRow[] = [];

  beforeAll(async () => {
    world = await bootWorld();
    rows.push(...scanRoutes(world.app));
  });
  afterAll(async () => {
    await world.close();
  });

  it('the inventory is not empty (the scan really saw the application)', () => {
    // ROUTE_INVENTORY_JSON=<path> writes the full matrix (route, controller, rule, roles) for the security review documents.
    if (process.env.ROUTE_INVENTORY_JSON) require('fs').writeFileSync(process.env.ROUTE_INVENTORY_JSON, JSON.stringify(rows, null, 1));
    expect(rows.length).toBeGreaterThan(200);
  });

  it('every PUBLIC route is on the reviewed allowlist (and the allowlist has no stale entries)', () => {
    const publicRoutes = rows.filter((r) => r.rule === 'PUBLIC').map((r) => r.route);
    expect(publicRoutes.filter((r) => !PUBLIC_ALLOWED.has(r))).toEqual([]);
    expect([...PUBLIC_ALLOWED].filter((r) => !publicRoutes.includes(r))).toEqual([]);
  });

  it('no route declares @Roles(...) without the RolesGuard that enforces it', () => {
    expect(rows.filter((r) => r.rule === 'BROKEN_ROLES_WITHOUT_GUARD').map((r) => `${r.route} (${r.controller})`)).toEqual([]);
  });

  it('every route that is neither public, permission-gated nor role-gated is explicitly allowed to be "any authenticated role"', () => {
    const open = rows.filter((r) => r.rule === 'AUTHENTICATED').map((r) => r.route);
    // eslint-disable-next-line no-console
    if (process.env.PRINT_CUSTOMER_ID_ROUTES) console.log('CUSTOMER routes with ids:\n' + rows.filter((r) => r.roles.includes('CUSTOMER') && r.route.includes(':')).map((r) => r.route).join('\n'));
    // eslint-disable-next-line no-console
    if (process.env.PRINT_ROUTE_INVENTORY) console.log('AUTHENTICATED-ANY-ROLE routes:\n' + open.join('\n'));
    expect(open.filter((r) => !ANY_AUTHENTICATED_ALLOWED.has(r))).toEqual([]);
  });

  it('every /admin/* route is permission-gated or at least restricted to admin roles', () => {
    const weak = rows.filter((r) => r.route.includes(' /admin/') && r.rule !== 'PERMISSION' && !(r.rule === 'ROLES' && r.roles.every((x) => x === 'ADMIN' || x === 'SUPER_ADMIN')));
    expect(weak.map((r) => `${r.route} → ${r.rule} ${r.roles.join(',')}`)).toEqual([]);
  });

  it('every /vendor/* route is restricted to vendor roles; every /driver/* route to drivers', () => {
    const vendor = rows.filter((r) => r.route.includes(' /vendor/') && !(r.rule === 'ROLES' && r.roles.every((x) => x === 'VENDOR' || x === 'VENDOR_MANAGER')));
    const driver = rows.filter((r) => r.route.includes(' /driver/') && !(r.rule === 'ROLES' && r.roles.every((x) => x === 'DRIVER')));
    expect([...vendor, ...driver].map((r) => `${r.route} → ${r.rule} ${r.roles.join(',')}`)).toEqual([]);
  });
});
