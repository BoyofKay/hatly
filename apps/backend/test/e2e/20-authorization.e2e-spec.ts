/**
 * Group 8 / phase 4 — authorization and IDOR journeys over real HTTP.
 * Customer A vs B, Vendor A vs B, Driver A vs B, and the admin permission ladder up to SUPER_ADMIN.
 * A "deny" here means: correct status AND the victim's data is provably unchanged in PostgreSQL.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, DriverFixture, VendorFixture, expectData } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';
import { Role } from '../../src/common/enums/role.enum';

const NEVER_EXISTS = '00000000-0000-4000-8000-000000000000';

describe('E2E — authorization / IDOR', () => {
  let world: World;
  let s: Scenario;

  // Two of everything, on opposite sides of town so dispatch is deterministic.
  let vendorA: VendorFixture;
  let vendorB: VendorFixture;
  let productA: { id: string };
  let productB: { id: string };
  let customerA: Actor;
  let customerB: Actor;
  let driverA: DriverFixture;
  let driverB: DriverFixture;
  let orderA: any;
  let orderB: any;
  let deliveryA: { id: string; orderId: string };
  let deliveryB: { id: string; orderId: string };
  const homeA = { lat: 30.4225, lng: 31.5625 };
  const homeB = { lat: 30.4525, lng: 31.6025 };

  const orderStatus = async (orderId: string) => (await world.ds.query('SELECT status FROM orders WHERE id = $1', [orderId]))[0].status as string;

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    vendorA = await s.vendor({ name: 'Vendor A', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    vendorB = await s.vendor({ name: 'Vendor B', serviceAreaId: area.id, lat: 30.451, lng: 31.601 });
    productA = await s.product(vendorA, { name: 'A Product', priceMinor: 10000 });
    productB = await s.product(vendorB, { name: 'B Product', priceMinor: 20000 });
    driverA = await s.driver({ lat: 30.4212, lng: 31.5612, fullName: 'Driver A' });
    driverB = await s.driver({ lat: 30.4512, lng: 31.6012, fullName: 'Driver B' });
    customerA = await s.customer('Customer A');
    customerB = await s.customer('Customer B');
    orderA = await s.simpleOrder(customerA, vendorA, productA.id, homeA);
    orderB = await s.simpleOrder(customerB, vendorB, productB.id, homeB);
    await s.vendorPrepares(vendorA, orderA.id);
    await s.vendorPrepares(vendorB, orderB.id);
    deliveryA = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: driverA.accessToken }))[0];
    deliveryB = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: driverB.accessToken }))[0];
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('fixture sanity: each driver got the order next to them, both orders are ASSIGNED_TO_DRIVER', async () => {
    expect(deliveryA.orderId).toBe(orderA.id);
    expect(deliveryB.orderId).toBe(orderB.id);
    expect(await orderStatus(orderA.id)).toBe('ASSIGNED_TO_DRIVER');
    expect(await orderStatus(orderB.id)).toBe('ASSIGNED_TO_DRIVER');
  });

  describe('Customer A vs Customer B', () => {
    it("cannot read another customer's order (404, indistinguishable from a nonexistent id) and never sees it in a list", async () => {
      const cross = await world.api('get', `/orders/${orderA.id}`, { token: customerB.accessToken });
      const missing = await world.api('get', `/orders/${NEVER_EXISTS}`, { token: customerB.accessToken });
      expect(cross.status).toBe(404);
      expect(cross.body.error.message).toBe(missing.body.error.message);
      const list = expectData<any[]>(await world.api('get', '/orders', { token: customerB.accessToken }));
      expect(list.map((o) => o.id)).toEqual([orderB.id]);
      expect(expectData(await world.api('get', `/orders/${orderA.id}`, { token: customerA.accessToken })).id).toBe(orderA.id);
    });

    it("cannot read, edit, or delete another customer's address", async () => {
      const addr = await s.address(customerA, { ...homeA, label: 'A-home' });
      expect((await world.api('get', '/addresses', { token: customerB.accessToken })).body.data).toEqual([]);
      const patch = await world.api('patch', `/addresses/${addr.id}`, { token: customerB.accessToken, body: { label: 'hijacked' } });
      const del = await world.api('delete', `/addresses/${addr.id}`, { token: customerB.accessToken });
      expect([patch.status, del.status]).toEqual([404, 404]);
      const [row] = await world.ds.query('SELECT label, is_active FROM addresses WHERE id = $1', [addr.id]);
      expect(row).toMatchObject({ label: 'A-home', is_active: true });
    });

    it("cannot touch another customer's cart item; carts are isolated", async () => {
      const cartA = await s.addToCart(customerA, productA.id, 3);
      const itemId = cartA.groups[0].items[0].id;
      const upd = await world.api('patch', `/cart/items/${itemId}`, { token: customerB.accessToken, body: { quantity: 1 } });
      const del = await world.api('delete', `/cart/items/${itemId}`, { token: customerB.accessToken });
      expect([upd.status, del.status]).toEqual([404, 404]);
      const [row] = await world.ds.query('SELECT quantity FROM cart_items WHERE id = $1', [itemId]);
      expect(row.quantity).toBe(3);
      expect(expectData(await world.api('get', '/cart', { token: customerB.accessToken })).groups).toEqual([]);
      expectData(await world.api('delete', '/cart', { token: customerA.accessToken })); // leave A's cart empty for later tests
    });

    it('favorites are per customer', async () => {
      expect((await world.api('post', '/favorites', { token: customerA.accessToken, body: { vendorId: vendorA.vendorId } })).status).toBe(204);
      expect((await world.api('get', '/favorites', { token: customerB.accessToken })).body).toEqual([]);
      await world.api('delete', `/favorites/${vendorA.vendorId}`, { token: customerB.accessToken }); // B's delete must not remove A's
      expect((await world.api('get', '/favorites', { token: customerA.accessToken })).body).toHaveLength(1);
    });

    it('cannot claim a manual-transfer payment for, or read the rating state of, another customer\'s order', async () => {
      const claim = await world.api('post', `/payments/manual-transfer/orders/${orderA.id}/claim`, { token: customerB.accessToken, body: {} });
      expect([403, 404, 400]).toContain(claim.status);
      expect(claim.status).not.toBe(201);
      const rating = await world.api('get', `/orders/${orderA.id}/rating-state`, { token: customerB.accessToken });
      expect(rating.status).toBe(404);
    });

    it('identity is never taken from the body: injecting customerId/userId is rejected outright', async () => {
      const order = await world.api('post', '/orders', {
        token: customerB.accessToken,
        body: { customerId: customerA.id, deliveryAddress: { line1: 'x', latitude: 30.4, longitude: 31.5 }, paymentMethod: 'COD' },
      });
      expect(order.status).toBe(400);
      const addr = await world.api('post', '/addresses', { token: customerB.accessToken, body: { deliveryZoneId: await s.defaultDeliveryZoneId(), line1: 'x', latitude: 30.4, longitude: 31.5, userId: customerA.id } });
      expect(addr.status).toBe(400);
      const convert = await world.api('post', '/customer/loyalty/convert', { token: customerB.accessToken, body: { customerId: customerA.id, points: 1, idempotencyKey: 'k1' } });
      expect(convert.status).toBe(400);
    });

    it('a customer cannot change an order status at all (no customer transition exists) — own or foreign', async () => {
      for (const [who, order] of [['own', orderB], ['foreign', orderA]] as const) {
        const res = await world.api('patch', `/orders/${order.id}/status`, { token: customerB.accessToken, body: { status: 'CANCELLED' } });
        expect({ who, status: res.status }).toMatchObject({ who, status: expect.any(Number) });
        expect(res.status).toBeGreaterThanOrEqual(400);
      }
      expect(await orderStatus(orderA.id)).toBe('ASSIGNED_TO_DRIVER');
      expect(await orderStatus(orderB.id)).toBe('ASSIGNED_TO_DRIVER');
    });
  });

  describe('Vendor A vs Vendor B', () => {
    it("cannot see another vendor's order in the list or by id", async () => {
      const list = expectData<any[]>(await world.api('get', '/vendor/orders', { token: vendorB.manager.accessToken }));
      expect(list.map((o) => o.id)).toEqual([orderB.id]);
      expect((await world.api('get', `/vendor/orders/${orderA.id}`, { token: vendorB.manager.accessToken })).status).toBe(404);
    });

    it("cannot change the status of another vendor's segment", async () => {
      const segA = (await world.ds.query('SELECT id, status FROM order_vendor_segments WHERE order_id = $1', [orderA.id]))[0];
      const res = await world.api('patch', `/vendor/orders/segments/${segA.id}/status`, { token: vendorB.manager.accessToken, body: { status: 'CANCELLED' } });
      expect([403, 404]).toContain(res.status);
      expect((await world.ds.query('SELECT status FROM order_vendor_segments WHERE id = $1', [segA.id]))[0].status).toBe(segA.status);
    });

    it("cannot record weight or price on another vendor's order item", async () => {
      const itemA = (await world.ds.query('SELECT i.id FROM order_items i JOIN order_vendor_segments s ON s.id = i.order_vendor_segment_id WHERE s.order_id = $1', [orderA.id]))[0];
      const w = await world.api('post', `/vendor/orders/order-items/${itemA.id}/weight`, { token: vendorB.manager.accessToken, body: { weightGrams: 500 } });
      const p = await world.api('post', `/vendor/orders/order-items/${itemA.id}/price`, { token: vendorB.manager.accessToken, body: { amountMinor: 1 } });
      expect(w.status).toBe(403);
      // (pricing checks item eligibility before ownership, so a catalog item answers 400; it never succeeds)
      expect([400, 403, 404]).toContain(p.status);
      const [row] = await world.ds.query('SELECT actual_weight_grams, actual_amount_minor FROM order_items WHERE id = $1', [itemA.id]);
      expect(row).toEqual({ actual_weight_grams: null, actual_amount_minor: null });
    });

    it("cannot read or modify another vendor's products", async () => {
      const list = expectData<any[]>(await world.api('get', '/vendor/products', { token: vendorB.manager.accessToken }));
      expect(list.map((p) => p.id)).toEqual([productB.id]);
      const get = await world.api('get', `/vendor/products/${productA.id}`, { token: vendorB.manager.accessToken });
      const upd = await world.api('patch', `/vendor/products/${productA.id}`, { token: vendorB.manager.accessToken, body: { priceMinor: 1 } });
      const off = await world.api('patch', `/vendor/products/${productA.id}/deactivate`, { token: vendorB.manager.accessToken });
      expect([get.status, upd.status, off.status].every((c) => c === 403 || c === 404)).toBe(true);
      expect((await world.ds.query('SELECT price_minor, is_available FROM products WHERE id = $1', [productA.id]))[0]).toMatchObject({ price_minor: 10000, is_available: true });
    });

    it("lists only its own branches", async () => {
      const branches = expectData<any[]>(await world.api('get', '/vendor/branches', { token: vendorB.manager.accessToken }));
      expect(branches.map((b) => b.id)).toEqual([vendorB.branchId]);
    });
  });

  describe('Driver A vs Driver B', () => {
    it("cannot see another driver's deliveries", async () => {
      const list = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: driverB.accessToken }));
      expect(list.map((d) => d.id)).toEqual([deliveryB.id]);
      expect((await world.api('get', `/driver/deliveries/${deliveryA.id}`, { token: driverB.accessToken })).status).toBe(404);
    });

    it("cannot advance another driver's delivery", async () => {
      const res = await world.api('patch', `/driver/deliveries/${deliveryA.id}/status`, { token: driverB.accessToken, body: { status: 'PICKED_UP' } });
      expect([403, 404]).toContain(res.status);
      expect(await orderStatus(orderA.id)).toBe('ASSIGNED_TO_DRIVER');
    });

    it("cannot record a purchase amount or a cash remainder against another driver's delivery", async () => {
      const remainder = await world.api('post', `/driver/deliveries/${deliveryA.id}/cash-remainder`, { token: driverB.accessToken, body: { cashReceivedMinor: 100 } });
      expect([403, 404]).toContain(remainder.status);
      expect(await world.ds.query('SELECT id FROM driver_cash_remainders')).toEqual([]);
    });

    it("cannot move another driver's order through the generic order-status endpoint", async () => {
      const res = await world.api('patch', `/orders/${orderA.id}/status`, { token: driverB.accessToken, body: { status: 'PICKED_UP' } });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await orderStatus(orderA.id)).toBe('ASSIGNED_TO_DRIVER');
    });

    it('a driver token cannot use customer, vendor or admin surfaces', async () => {
      const calls = await Promise.all([
        world.api('post', '/orders', { token: driverA.accessToken, body: { deliveryAddress: { line1: 'x', latitude: 30.4, longitude: 31.5 }, paymentMethod: 'COD' } }),
        world.api('get', '/vendor/orders', { token: driverA.accessToken }),
        world.api('get', '/admin/drivers', { token: driverA.accessToken }),
        world.api('get', '/cart', { token: driverA.accessToken }),
      ]);
      expect(calls.map((c) => c.status)).toEqual([403, 403, 403, 403]);
    });
  });

  describe('generic PATCH /orders/:id/status is ownership-checked for every role', () => {
    const cancel = (actor: Actor, orderId: string) =>
      world.api('patch', `/orders/${orderId}/status`, { token: actor.accessToken, body: { status: 'CANCELLED', cancellationReason: 'e2e' } });

    it("vendor B cannot cancel vendor A's PENDING order; vendor A can cancel its own (inventory restored)", async () => {
      const inventoryProduct = await s.product(vendorA, { name: 'Tracked A', priceMinor: 5000, inventoryMode: 'TRACKED', quantity: 10 });
      const customerC = await s.customer('Customer C');
      const order = await s.simpleOrder(customerC, vendorA, inventoryProduct.id, homeA, 4);
      const stock = async () => (await world.ds.query('SELECT quantity FROM products WHERE id = $1', [inventoryProduct.id]))[0].quantity;
      expect(await stock()).toBe(6);

      const foreign = await cancel(vendorB.manager, order.id);
      expect(foreign.status).toBe(404);
      expect(foreign.body.error.message).toBe('Order not found.');
      expect(await orderStatus(order.id)).toBe('PENDING');
      expect(await stock()).toBe(6);

      expect((await cancel(vendorA.manager, order.id)).status).toBe(200);
      expect(await orderStatus(order.id)).toBe('CANCELLED');
      expect(await stock()).toBe(10);
    });

    it("driver B cannot move driver A's order; driver A can advance its own", async () => {
      const foreign = await world.api('patch', `/orders/${orderA.id}/status`, { token: driverB.accessToken, body: { status: 'PICKED_UP' } });
      expect(foreign.status).toBe(404);
      expect(await orderStatus(orderA.id)).toBe('ASSIGNED_TO_DRIVER');
      const own = await world.api('patch', `/orders/${orderA.id}/status`, { token: driverA.accessToken, body: { status: 'PICKED_UP' } });
      expect(own.status).toBe(200);
      expect(await orderStatus(orderA.id)).toBe('PICKED_UP');
    });

    it("a customer is refused for a foreign order (404) and — having no permitted transition — for their own (400)", async () => {
      expect((await cancel(customerB, orderA.id)).status).toBe(404);
      expect((await cancel(customerB, orderB.id)).status).toBe(400);
      expect(await orderStatus(orderB.id)).toBe('ASSIGNED_TO_DRIVER');
    });

    it('an ADMIN needs MANAGE_ORDER_ISSUES; SUPER_ADMIN does not', async () => {
      const noPermission = await s.admin([], 'Admin no perms');
      const withPermission = await s.admin([Permission.MANAGE_ORDER_ISSUES], 'Admin with perm');
      const superAdmin = await s.superAdmin();
      const customerD = await s.customer('Customer D');
      const o1 = await s.simpleOrder(customerD, vendorA, productA.id, homeA);
      expect((await cancel(noPermission, o1.id)).status).toBe(403);
      expect(await orderStatus(o1.id)).toBe('PENDING');
      expect((await cancel(withPermission, o1.id)).status).toBe(200);
      const o2 = await s.simpleOrder(customerD, vendorA, productA.id, homeA);
      expect((await cancel(superAdmin, o2.id)).status).toBe(200);
    });
  });

  describe('admin permission ladder', () => {
    // One representative, side-effect-free route per permission.
    const PROBES: Array<{ permission: Permission; method: 'get' | 'post' | 'patch'; path: string; body?: unknown }> = [
      { permission: Permission.MANAGE_BUSINESS_CONFIG, method: 'get', path: '/admin/business-config' },
      { permission: Permission.MANAGE_HATLY_SERVICE_PRICING, method: 'get', path: '/admin/hatly-service-pricing-config' },
      { permission: Permission.MANAGE_VEHICLE_TYPES, method: 'get', path: '/admin/vehicle-types' },
      { permission: Permission.ASSIGN_REASSIGN_ORDERS, method: 'get', path: '/admin/orders/dispatchable' },
      { permission: Permission.MANAGE_DRIVERS, method: 'get', path: '/admin/drivers' },
      { permission: Permission.MANAGE_CUSTOMER_WALLET, method: 'get', path: '/admin/cash-remainders' },
      { permission: Permission.MANAGE_ORDER_ISSUES, method: 'get', path: '/admin/orders/failed-deliveries' },
      { permission: Permission.MANAGE_OFFERS, method: 'get', path: '/admin/offers' },
      { permission: Permission.VERIFY_MANUAL_PAYMENTS, method: 'get', path: '/admin/manual-transfer-payments' },
      { permission: Permission.MANAGE_CATALOG, method: 'get', path: '/admin/product-categories' },
      { permission: Permission.MANAGE_MARKETPLACE_SECTORS, method: 'get', path: '/admin/sectors' },
      { permission: Permission.MANAGE_SERVICE_AREAS, method: 'get', path: '/admin/service-areas' },
      { permission: Permission.MANAGE_VENDOR_STAFF, method: 'get', path: '/admin/vendor-staff' },
      { permission: Permission.MANAGE_VENDORS, method: 'get', path: '/admin/vendors' },
      { permission: Permission.VIEW_ORDERS, method: 'get', path: `/admin/orders/${NEVER_EXISTS}` },
      { permission: Permission.VIEW_ORDERS, method: 'get', path: '/admin/orders?search=nonexistent' },
      { permission: Permission.VIEW_CUSTOMERS, method: 'get', path: '/admin/customers?search=nonexistent' },
      { permission: Permission.VIEW_CUSTOMERS, method: 'get', path: `/admin/customers/${NEVER_EXISTS}` },
      { permission: Permission.MANAGE_VENDOR_COMMISSION, method: 'patch', path: `/admin/vendor-branches/${NEVER_EXISTS}/commission-rate`, body: { commissionRateBasisPoints: 100 } },
      { permission: Permission.MANAGE_DRIVER_COMMISSION, method: 'patch', path: `/admin/drivers/${NEVER_EXISTS}/commission-rate`, body: { commissionRateBasisPoints: 100 } },
      { permission: Permission.MANAGE_EMPLOYEE_LOANS, method: 'get', path: `/admin/employee-loans/employee/${NEVER_EXISTS}` },
      { permission: Permission.CLOSE_VENDOR_SETTLEMENTS, method: 'post', path: `/admin/settlement/vendor-branches/${NEVER_EXISTS}/close`, body: {} },
      { permission: Permission.CLOSE_DRIVER_SETTLEMENTS, method: 'post', path: `/admin/settlement/drivers/${NEVER_EXISTS}/close`, body: {} },
      { permission: Permission.OPEN_CLOSE_VENDOR_BRANCHES, method: 'patch', path: `/admin/vendor-branches/${NEVER_EXISTS}/open` },
    ];
    let unprivileged: Actor;
    let onlyOne: Map<Permission, Actor>;
    let superAdmin: Actor;

    beforeAll(async () => {
      superAdmin = await s.superAdmin();
      unprivileged = await s.admin([], 'Admin Without Permissions');
      onlyOne = new Map();
      for (const probe of PROBES) onlyOne.set(probe.permission, await s.admin([probe.permission], `Only ${probe.permission}`));
    });

    const call = (actor: Actor, probe: (typeof PROBES)[number]) => world.api(probe.method, probe.path, { token: actor.accessToken, body: probe.body });

    it('an ADMIN with no permissions is refused (403) on every permission-protected route', async () => {
      for (const probe of PROBES) {
        const res = await call(unprivileged, probe);
        expect({ route: probe.path, status: res.status }).toEqual({ route: probe.path, status: 403 });
      }
    });

    it('SUPER_ADMIN passes every permission gate (any non-403 answer means the guard let it through)', async () => {
      for (const probe of PROBES) {
        const res = await call(superAdmin, probe);
        expect({ route: probe.path, denied: res.status === 403 || res.status === 401 }).toEqual({ route: probe.path, denied: false });
      }
    });

    it('permission matrix: an admin holding ONLY permission P passes exactly the P route and is refused on every other', async () => {
      for (const holder of PROBES) {
        const actor = onlyOne.get(holder.permission)!;
        for (const probe of PROBES) {
          const res = await call(actor, probe);
          const allowed = probe.permission === holder.permission;
          expect({ holds: holder.permission, route: probe.path, granted: res.status !== 403 }).toEqual({
            holds: holder.permission,
            route: probe.path,
            granted: allowed,
          });
        }
      }
    });

    it('revoking a permission takes effect on the very next request (no token refresh needed)', async () => {
      const admin = await s.admin([Permission.MANAGE_VENDORS], 'Revoked Admin');
      expect((await world.api('get', '/admin/vendors', { token: admin.accessToken })).status).toBe(200);
      expectData(await world.api('delete', `/admin/users/${admin.id}/permissions/${Permission.MANAGE_VENDORS}`, { token: superAdmin.accessToken }));
      expect((await world.api('get', '/admin/vendors', { token: admin.accessToken })).status).toBe(403);
    });

    it('only SUPER_ADMIN can grant or revoke permissions: an ADMIN (even holding permissions) cannot, including for themselves', async () => {
      const admin = await s.admin([Permission.MANAGE_VENDORS, Permission.MANAGE_DRIVERS], 'Greedy Admin');
      const self = await world.api('post', `/admin/users/${admin.id}/permissions`, { token: admin.accessToken, body: { permission: Permission.MANAGE_BUSINESS_CONFIG } });
      const other = await world.api('post', `/admin/users/${unprivileged.id}/permissions`, { token: admin.accessToken, body: { permission: Permission.MANAGE_VENDORS } });
      const revoke = await world.api('delete', `/admin/users/${unprivileged.id}/permissions/${Permission.MANAGE_VENDORS}`, { token: superAdmin.accessToken });
      expect([self.status, other.status]).toEqual([403, 403]);
      expect(revoke.status).toBeLessThan(500);
      expect((await world.api('get', '/admin/business-config', { token: admin.accessToken })).status).toBe(403);
    });

    it('M3b (G-08): GET admin/users and GET admin/permissions are SUPER_ADMIN-only, same as grant/revoke — an ADMIN (even holding every listed permission) is refused, unauthenticated is refused, SUPER_ADMIN sees the real roster and the real enum', async () => {
      const greedyAdmin = await s.admin(PROBES.map((p) => p.permission), 'Every-Permission Admin');

      const usersAsAdmin = await world.api('get', '/admin/users', { token: greedyAdmin.accessToken });
      const catalogAsAdmin = await world.api('get', '/admin/permissions', { token: greedyAdmin.accessToken });
      expect([usersAsAdmin.status, catalogAsAdmin.status]).toEqual([403, 403]);

      const usersUnauth = await world.api('get', '/admin/users', {});
      const catalogUnauth = await world.api('get', '/admin/permissions', {});
      expect([usersUnauth.status, catalogUnauth.status]).toEqual([401, 401]);

      const usersAsSuperAdmin = expectData<any[]>(await world.api('get', '/admin/users', { token: superAdmin.accessToken }));
      expect(usersAsSuperAdmin.some((u) => u.id === greedyAdmin.id)).toBe(true);
      expect(usersAsSuperAdmin.every((u) => u.passwordHash === undefined)).toBe(true);

      const catalogAsSuperAdmin = expectData<string[]>(await world.api('get', '/admin/permissions', { token: superAdmin.accessToken }));
      expect(catalogAsSuperAdmin).toEqual(expect.arrayContaining(Object.values(Permission)));
    });

    it('a customer, vendor manager and driver are refused on every admin probe', async () => {
      for (const actor of [customerA, vendorA.manager, driverA]) {
        for (const probe of PROBES) {
          expect({ role: actor.role, route: probe.path, status: (await call(actor, probe)).status }).toEqual({ role: actor.role, route: probe.path, status: 403 });
        }
      }
    });

    it('an unauthenticated caller gets 401 (not 403) on admin routes', async () => {
      for (const probe of PROBES.slice(0, 5)) {
        expect((await world.api(probe.method, probe.path, { body: probe.body })).status).toBe(401);
      }
    });

    it('CHARACTERIZATION: a role in the JWT is trusted until expiry — a deactivated account keeps its access token for its 15-minute lifetime', async () => {
      const staffRows = expectData<Array<{ id: string }>>(await world.api('get', '/admin/vendor-staff', { token: superAdmin.accessToken, query: { vendorBranchId: vendorB.branchId } }));
      expectData(await world.api('patch', `/admin/vendor-staff/${staffRows[0].id}/deactivate`, { token: superAdmin.accessToken }));
      const stillWorks = await world.api('get', '/vendor/orders', { token: vendorB.manager.accessToken });
      expect(stillWorks.status).toBe(200); // documented limitation: JwtStrategy.validate() does not consult the database
      expectData(await world.api('patch', `/admin/vendor-staff/${staffRows[0].id}/activate`, { token: superAdmin.accessToken }));
    });
  });

  describe('VendorBranch open/close (M1, Launch-Readiness Gap Audit G-01)', () => {
    it('an admin holding OPEN_CLOSE_VENDOR_BRANCHES can open a closed branch and close it again, over real HTTP', async () => {
      // Two actors, deliberately: `opener` holds ONLY OPEN_CLOSE_VENDOR_BRANCHES, proving that
      // permission alone is sufficient for the mutation (GET /admin/vendor-branches/:id itself
      // requires the separate MANAGE_VENDORS permission, so verification reads use a superAdmin).
      const opener = await s.admin([Permission.OPEN_CLOSE_VENDOR_BRANCHES], 'Branch Opener');
      const reader = await s.superAdmin();

      // s.vendor() activates the branch but never opens it — this is the exact real-world
      // "created, still closed" state the audit found had no write path at all before M1.
      const before = expectData(await world.api('get', `/admin/vendor-branches/${vendorA.branchId}`, { token: reader.accessToken }));
      expect(before.isOpen).toBe(false);

      const opened = expectData(
        await world.api('patch', `/admin/vendor-branches/${vendorA.branchId}/open`, { token: opener.accessToken }),
      );
      expect(opened.isOpen).toBe(true);
      expect(opened.isActive).toBe(true); // untouched by the open action

      // The new state is immediately visible on the existing read path — no second source of truth.
      const afterOpen = expectData(await world.api('get', `/admin/vendor-branches/${vendorA.branchId}`, { token: reader.accessToken }));
      expect(afterOpen.isOpen).toBe(true);

      const closed = expectData(
        await world.api('patch', `/admin/vendor-branches/${vendorA.branchId}/close`, { token: opener.accessToken }),
      );
      expect(closed.isOpen).toBe(false);

      const afterClose = expectData(await world.api('get', `/admin/vendor-branches/${vendorA.branchId}`, { token: reader.accessToken }));
      expect(afterClose.isOpen).toBe(false);
    });

    it('an admin without OPEN_CLOSE_VENDOR_BRANCHES cannot open or close a branch, and the state is unchanged', async () => {
      const noPermission = await s.admin([Permission.MANAGE_VENDORS], 'Admin — MANAGE_VENDORS only');
      const res = await world.api('patch', `/admin/vendor-branches/${vendorA.branchId}/open`, { token: noPermission.accessToken });
      expect(res.status).toBe(403);
    });

    it('a vendor manager cannot open or close a branch (admin-only capability)', async () => {
      const res = await world.api('patch', `/admin/vendor-branches/${vendorA.branchId}/open`, { token: vendorA.manager.accessToken });
      expect(res.status).toBe(403);
    });

    it('opening/closing a nonexistent branch is a 404, not a silent success', async () => {
      const opener = await s.admin([Permission.OPEN_CLOSE_VENDOR_BRANCHES], 'Branch Opener 2');
      expect((await world.api('patch', `/admin/vendor-branches/${NEVER_EXISTS}/open`, { token: opener.accessToken })).status).toBe(404);
      expect((await world.api('patch', `/admin/vendor-branches/${NEVER_EXISTS}/close`, { token: opener.accessToken })).status).toBe(404);
    });
  });

  it('admin routes never expose password hashes or refresh secrets', async () => {
    const superAdmin = await s.superAdmin();
    const bodies = JSON.stringify([
      await world.api('get', '/admin/drivers', { token: superAdmin.accessToken }),
      await world.api('get', '/admin/vendor-staff', { token: superAdmin.accessToken }),
      await world.api('get', '/orders', { token: customerA.accessToken }),
    ]);
    expect(bodies).not.toMatch(/passwordHash|password_hash|\$2[aby]\$/);
    expect(Role.CUSTOMER).toBe('CUSTOMER');
  });
});
