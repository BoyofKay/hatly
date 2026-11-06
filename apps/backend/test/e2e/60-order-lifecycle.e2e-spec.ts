/**
 * Group 8 / phases 9 & 12 — the order lifecycle over real HTTP: single- and multi-vendor happy
 * paths through vendor segments, automatic dispatch and the driver's delivery steps, with the
 * push notifications, financial events and state persisted along the way; then the full
 * role × transition matrix against an independently-written statement of the rules.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData, withQuoteToken } from './support/actors';
import { boundary } from './support/external-boundary';
import { Permission } from '../../src/modules/permissions/permission.enum';
import { Role } from '../../src/common/enums/role.enum';

// COLLECTED (U2) is listed so the matrix below (a DELIVERY order) proves it is unreachable for delivery and terminal;
// the pickup-order side (READY_FOR_PICKUP → COLLECTED by its vendor / an admin) is proven in 86-pickup-collection-and-redispatch.
const STATUSES = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED_TO_DRIVER', 'PICKED_UP', 'ON_THE_WAY', 'DELIVERED', 'CANCELLED', 'FAILED_DELIVERY', 'COLLECTED'] as const;
type Status = (typeof STATUSES)[number];

describe('E2E — order lifecycle', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string; lat: number; lng: number };
  let superAdmin: Actor;
  const home = { lat: 30.425, lng: 31.565 };

  const orderRow = async (id: string) => (await world.ds.query('SELECT * FROM orders WHERE id = $1', [id]))[0];
  const statusOf = async (id: string) => (await orderRow(id)).status as Status;
  const events = async (orderId: string) => world.ds.query('SELECT type, amount_minor, direction FROM financial_events WHERE order_id = $1 ORDER BY created_at', [orderId]);
  const driverStep = (driver: Actor, deliveryId: string, status: string, extra: Record<string, unknown> = {}) =>
    world.api('patch', `/driver/deliveries/${deliveryId}/status`, { token: driver.accessToken, body: { status, ...extra } });
  const deliveryOf = async (driver: Actor) => expectData<any[]>(await world.api('get', '/driver/deliveries', { token: driver.accessToken }))[0];

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    superAdmin = await s.superAdmin();
  });
  beforeEach(() => boundary.reset());
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('single-vendor COD happy path', () => {
    it('PENDING → (vendor accepts, prepares, marks ready) → auto-dispatch → picked up → on the way → delivered, with notifications and financial events at the right moments', async () => {
      const vendor = await s.vendor({ name: 'Happy Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561, commissionBasisPoints: 1000 });
      const product = await s.product(vendor, { priceMinor: 20000 });
      const driver = await s.driver({ lat: 30.4215, lng: 31.5615 });
      expectData(await world.api('patch', `/admin/drivers/${driver.driverId}/commission-rate`, { token: superAdmin.accessToken, body: { commissionRateBasisPoints: 2000 } }));
      const customer = await s.customer('Happy Customer');
      expectData(await world.api('post', '/customer/device-token', { token: customer.accessToken, body: { token: 'fcm-customer-1', platform: 'android' } }), 201);
      expectData(await world.api('post', '/driver/device-token', { token: driver.accessToken, body: { token: 'fcm-driver-1', platform: 'ios' } }), 201);

      const order = await s.simpleOrder(customer, vendor, product.id, home, 2);
      expect(order).toMatchObject({ status: 'PENDING', paymentMethod: 'COD', subtotalMinor: 40000 });
      expect(await world.ds.query('SELECT id FROM payments WHERE order_id = $1', [order.id])).toEqual([]); // COD: no payment row
      expect(await events(order.id)).toEqual([]);

      // the vendor walks its segment; the ORDER follows automatically
      const view = expectData(await world.api('get', `/vendor/orders/${order.id}`, { token: vendor.manager.accessToken }));
      const segmentId = view.segments[0].id;
      const seg = (status: string, extra: Record<string, unknown> = {}) =>
        world.api('patch', `/vendor/orders/segments/${segmentId}/status`, { token: vendor.manager.accessToken, body: { status, ...extra } });
      expectData(await seg('CONFIRMED'));
      expect(await statusOf(order.id)).toBe('PENDING'); // one vendor's confirmation alone does not advance the order
      expectData(await seg('PREPARING', { expectedReadyAt: new Date(Date.now() + 600_000).toISOString() }));
      expect((await world.ds.query('SELECT expected_ready_at FROM order_vendor_segments WHERE id = $1', [segmentId]))[0].expected_ready_at).not.toBeNull();
      expectData(await seg('READY_FOR_PICKUP'));

      // readiness cascaded CONFIRMED → PREPARING → READY_FOR_PICKUP → (automatic dispatch) ASSIGNED_TO_DRIVER
      expect(await statusOf(order.id)).toBe('ASSIGNED_TO_DRIVER');
      const delivery = await deliveryOf(driver);
      expect(delivery).toMatchObject({ orderId: order.id, orderStatus: 'ASSIGNED_TO_DRIVER', paymentMethod: 'COD', totalMinor: order.totalMinor, customerName: 'Happy Customer' });
      expect(delivery.segments[0]).toMatchObject({ vendorBranchId: vendor.branchId, vendorBranchName: `${vendor.name} Main` });
      expect(boundary.push.map((p) => p.data.type)).toEqual(expect.arrayContaining(['ORDER_CONFIRMED', 'ORDER_ASSIGNED']));
      expect(boundary.push.find((p) => p.data.type === 'ORDER_ASSIGNED')).toMatchObject({ tokens: ['fcm-driver-1'], data: { orderId: order.id, deliveryId: delivery.id } });
      expect(boundary.push.find((p) => p.data.type === 'ORDER_CONFIRMED')).toMatchObject({ tokens: ['fcm-customer-1'] });

      expectData(await driverStep(driver, delivery.id, 'PICKED_UP'));
      expect(await statusOf(order.id)).toBe('PICKED_UP');
      expect((await events(order.id)).map((e: any) => e.type)).toEqual(['VENDOR_COMMISSION_RECOGNIZED']);
      expect((await events(order.id))[0].amount_minor).toBe(4000); // 10% of 400.00

      expectData(await driverStep(driver, delivery.id, 'ON_THE_WAY'));
      expect(boundary.push.some((p) => p.data.type === 'ORDER_ON_THE_WAY' && p.data.orderId === order.id)).toBe(true);
      expect(await statusOf(order.id)).toBe('ON_THE_WAY');
      // M4 — Proof of Delivery is required for the DELIVERED transition.
      expectData(await driverStep(driver, delivery.id, 'DELIVERED', { proofPhotoUrl: await s.uploadFakePhoto(driver.accessToken) }));

      const done = await orderRow(order.id);
      expect(done.status).toBe('DELIVERED');
      const finance = await events(order.id);
      expect(finance.map((e: any) => e.type)).toEqual(['VENDOR_COMMISSION_RECOGNIZED', 'DRIVER_COMMISSION_RECOGNIZED']);
      expect(finance[1].amount_minor).toBe(Math.round((order.deliveryFeeMinor * 2000) / 10000));
      expect(boundary.push.some((p) => p.data.type === 'ORDER_DELIVERED')).toBe(true);
      expect(await world.ds.query('SELECT delivered_at, picked_up_at FROM deliveries WHERE order_id = $1', [order.id])).toEqual([{ delivered_at: expect.any(Date), picked_up_at: expect.any(Date) }]);
      // driver becomes reachable for the next order again is checked in the dispatch spec
      const customerView = expectData(await world.api('get', `/orders/${order.id}`, { token: customer.accessToken }));
      expect(customerView.status).toBe('DELIVERED');
    });

    it('a terminal order is immutable: DELIVERED, CANCELLED and FAILED_DELIVERY (and COLLECTED — see 86) reject every further transition', async () => {
      const vendor = await s.vendor({ serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
      const product = await s.product(vendor, {});
      const customer = await s.customer();
      const order = await s.simpleOrder(customer, vendor, product.id, home);
      expectData(await world.api('patch', `/orders/${order.id}/status`, { token: superAdmin.accessToken, body: { status: 'CANCELLED', cancellationReason: 'test' } }));
      for (const to of STATUSES) {
        const res = await world.api('patch', `/orders/${order.id}/status`, { token: superAdmin.accessToken, body: { status: to } });
        expect({ to, status: res.status }).toEqual({ to, status: 400 });
      }
      expect(await statusOf(order.id)).toBe('CANCELLED');
      const row = await orderRow(order.id);
      expect(row.cancelled_by_role).toBe(Role.SUPER_ADMIN);
      expect(row.cancellation_reason).toBe('test');
    });
  });

  describe('status transition matrix (every role × every from/to pair, against the written rules)', () => {
    // Independent restatement of the intended rules (NOT imported from production code).
    const ALLOWED: Record<string, Partial<Record<Status, string[]>>> = {
      PENDING: { CONFIRMED: ['ADMIN'], CANCELLED: ['VENDOR', 'ADMIN'] },
      CONFIRMED: { PREPARING: ['ADMIN'], CANCELLED: ['VENDOR', 'ADMIN'] },
      PREPARING: { READY_FOR_PICKUP: ['ADMIN'], CANCELLED: ['VENDOR', 'ADMIN'] },
      READY_FOR_PICKUP: { ASSIGNED_TO_DRIVER: ['ADMIN'], CANCELLED: ['VENDOR', 'ADMIN'] },
      // R17: only Operations release; R3: Operations may cancel before pickup (the customer through its own endpoint).
      ASSIGNED_TO_DRIVER: { PICKED_UP: ['DRIVER'], READY_FOR_PICKUP: ['ADMIN'], CANCELLED: ['ADMIN'] },
      PICKED_UP: { ON_THE_WAY: ['DRIVER'], FAILED_DELIVERY: ['DRIVER', 'ADMIN'] },
      ON_THE_WAY: { FAILED_DELIVERY: ['DRIVER', 'ADMIN'], DELIVERED: ['DRIVER'] },
    };

    it('only the documented (from, to, role) triples succeed; everything else is refused and leaves the order untouched', async () => {
      const vendor = await s.vendor({ serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
      const product = await s.product(vendor, { inventoryMode: 'OPEN' });
      await s.driver({ lat: 30.4215, lng: 31.5615 });
      const customer = await s.customer();
      const order = await s.simpleOrder(customer, vendor, product.id, home);
      await s.vendorPrepares(vendor, order.id);
      expect(await statusOf(order.id)).toBe('ASSIGNED_TO_DRIVER'); // a delivery row now exists
      const assignedDriver = await s.driverAssignedTo(order.id);
      expect(assignedDriver.driverId).toBeDefined();
      // This matrix exercises the TRANSITION TABLE only, resetting the order's status with SQL between attempts. Since U3 a
      // driver's hand-back (ASSIGNED_TO_DRIVER → READY_FOR_PICKUP) triggers an immediate automatic redispatch to ANOTHER
      // driver, which would move the delivery away from `assignedDriver` mid-matrix; dispatch is proven in 70/83/86.
      await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false);
      const admin = await s.admin([Permission.MANAGE_ORDER_ISSUES]);
      const actors: Array<{ role: string; actor: Actor }> = [
        { role: 'CUSTOMER', actor: customer },
        { role: 'VENDOR', actor: vendor.manager },
        { role: 'DRIVER', actor: assignedDriver },
        { role: 'ADMIN', actor: admin },
        { role: 'SUPER_ADMIN', actor: superAdmin },
      ];
      const reset = (status: Status) => world.ds.query('UPDATE orders SET status = $2, cancellation_reason = NULL, cancelled_by_role = NULL, failure_reason = NULL, failed_at = NULL WHERE id = $1', [order.id, status]);

      // M4 — Proof of Delivery is required for a DRIVER's DELIVERED transition, on this
      // generic endpoint too (see OrdersController's own comment) — supplied once and
      // reused: the matrix only actually reaches the state machine's DELIVERED transition
      // when `from` is ON_THE_WAY, and ProofOfDeliveryService is idempotent per delivery,
      // so reusing the same photo across every (from, to, role) iteration is safe.
      const driverProofPhotoUrl = await s.uploadFakePhoto(assignedDriver.accessToken);
      const mismatches: string[] = [];
      try {
        for (const from of STATUSES) {
          for (const to of STATUSES) {
            for (const { role, actor } of actors) {
              await reset(from);
              const extra: Record<string, unknown> = { cancellationReason: 'matrix', failureReason: 'matrix' };
              if (role === 'DRIVER' && to === 'DELIVERED') extra.proofPhotoUrl = driverProofPhotoUrl;
              const res = await world.api('patch', `/orders/${order.id}/status`, { token: actor.accessToken, body: { status: to, ...extra } });
              // SUPER_ADMIN may do everything ADMIN may (plus READY→ASSIGNED, which ADMIN also has)
              const rolesAllowed = ALLOWED[from]?.[to] ?? [];
              const expected = rolesAllowed.includes(role) || (role === 'SUPER_ADMIN' && rolesAllowed.includes('ADMIN'));
              const succeeded = res.status === 200;
              if (res.status >= 500) mismatches.push(`${role} ${from}->${to}: HTTP ${res.status}`);
              else if (succeeded !== expected) mismatches.push(`${role} ${from}->${to}: expected ${expected ? 'allowed' : 'refused'}, got ${res.status}`);
              if (!succeeded) expect(await statusOf(order.id)).toBe(from);
            }
          }
        }
      } finally {
        await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', true); // later tests in this file rely on automatic dispatch
      }
      expect(mismatches).toEqual([]);
    });
  });

  describe('vendor segment machine', () => {
    it('follows PENDING → CONFIRMED → PREPARING → READY_FOR_PICKUP; skipping, going backwards, and moving a cancelled/ready segment are refused', async () => {
      const vendor = await s.vendor({ serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
      const product = await s.product(vendor, { inventoryMode: 'OPEN' });
      const customer = await s.customer();
      const order = await s.simpleOrder(customer, vendor, product.id, home);
      const segmentId = (await world.ds.query('SELECT id FROM order_vendor_segments WHERE order_id = $1', [order.id]))[0].id;
      const go = (status: string) => world.api('patch', `/vendor/orders/segments/${segmentId}/status`, { token: vendor.manager.accessToken, body: { status, ...(status === 'CANCELLED' ? { reason: 'Out of stock' } : {}) } });
      expect((await go('PREPARING')).status).toBe(400); // skip
      expect((await go('READY_FOR_PICKUP')).status).toBe(400); // skip
      expect((await go('PICKED_UP')).status).toBe(400); // never a vendor action
      expect((await go('NOT_A_STATUS')).status).toBe(400);
      expectData(await go('CONFIRMED'));
      expect((await go('PENDING')).status).toBe(400); // backwards
      expect((await go('CONFIRMED')).status).toBe(400); // same state
      expectData(await go('CANCELLED'));
      expect((await go('PREPARING')).status).toBe(400); // cancelled is terminal
    });

    it('the vendor cannot hand over a segment that still has an unpriced custom item (UNPRICED_CUSTOM_ITEMS_REMAIN) until it prices it; pricing is once-only', async () => {
      const vendor = await s.vendor({ serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
      await s.allowCustomRequests(vendor);
      const product = await s.product(vendor, { inventoryMode: 'OPEN', priceMinor: 10000 });
      const customer = await s.customer();
      const base = await s.addToCart(customer, product.id, 1);
      expectData(await world.api('post', '/cart/vendor-custom-items', { token: customer.accessToken, body: { cartVendorGroupId: base.groups[0].id, freeTextDescription: 'Cough syrup, any brand' } }), 201);
      const order = await s.checkout(customer, home);
      const view = expectData(await world.api('get', `/vendor/orders/${order.id}`, { token: vendor.manager.accessToken }));
      const segmentId = view.segments[0].id;
      const custom = view.segments[0].items.find((i: any) => i.productId === null);
      const go = (status: string) => world.api('patch', `/vendor/orders/segments/${segmentId}/status`, { token: vendor.manager.accessToken, body: { status, ...(status === 'CANCELLED' ? { reason: 'Out of stock' } : {}) } });
      expectData(await go('CONFIRMED'));
      expectData(await go('PREPARING'));
      const blocked = await go('READY_FOR_PICKUP');
      expect(blocked.status).toBe(400);
      expect(blocked.body.error.details).toEqual({ code: 'UNPRICED_CUSTOM_ITEMS_REMAIN' });
      const priced = await world.api('post', `/vendor/orders/order-items/${custom.id}/price`, { token: vendor.manager.accessToken, body: { amountMinor: 4500 } });
      expect(priced.status).toBeLessThan(300);
      const again = await world.api('post', `/vendor/orders/order-items/${custom.id}/price`, { token: vendor.manager.accessToken, body: { amountMinor: 1 } });
      expect(again.status).toBe(409);
      expect(again.body.error.details.code).toBe('PURCHASE_ALREADY_RECORDED');
      expectData(await go('READY_FOR_PICKUP'));
      const stored = await orderRow(order.id);
      expect(Number(stored.subtotal_minor)).toBe(14500); // 100.00 + the 45.00 the vendor priced
    });
  });

  describe('multi-vendor orders', () => {
    let v1: VendorFixture;
    let v2: VendorFixture;
    let v3: VendorFixture;
    let p1: { id: string; priceMinor: number };
    let p2: { id: string; priceMinor: number };
    let p3: { id: string; priceMinor: number };

    beforeAll(async () => {
      v1 = await s.vendor({ name: 'Multi 1', serviceAreaId: area.id, lat: 30.421, lng: 31.561, commissionBasisPoints: 1000 });
      v2 = await s.vendor({ name: 'Multi 2', serviceAreaId: area.id, lat: 30.431, lng: 31.571, commissionBasisPoints: 500 });
      v3 = await s.vendor({ name: 'Multi 3', serviceAreaId: area.id, lat: 30.441, lng: 31.581 });
      p1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'OPEN' });
      p2 = await s.product(v2, { priceMinor: 20000, inventoryMode: 'OPEN' });
      p3 = await s.product(v3, { priceMinor: 30000, inventoryMode: 'OPEN' });
      await s.driver({ lat: 30.4212, lng: 31.5612 });
    });

    it('one order, one segment per vendor; each vendor sees only its own; the order advances only when EVERY vendor is ready; commission is per segment', async () => {
      const customer = await s.customer();
      await s.addToCart(customer, p1.id, 1);
      await s.addToCart(customer, p2.id, 2);
      await s.addToCart(customer, p3.id, 1);
      const order = await s.checkout(customer, home);
      expect(order.segments).toHaveLength(3);
      expect(order.subtotalMinor).toBe(10000 + 40000 + 30000);
      expect(order.deliveryFeeBreakdownSnapshot.vendorSequence).toHaveLength(3);
      expect(order.deliveryFeeBreakdownSnapshot.additionalVendorChargeMinor).toBe(1000); // 2 extra vendors × 5.00
      expect(order.totalMinor).toBe(order.subtotalMinor + order.deliveryFeeMinor);

      for (const [vendor, expectedSubtotal] of [[v1, 10000], [v2, 40000], [v3, 30000]] as const) {
        const view = expectData(await world.api('get', `/vendor/orders/${order.id}`, { token: vendor.manager.accessToken }));
        expect(view.segments).toHaveLength(1); // never sees the other vendors' items
        expect(view.segments[0]).toMatchObject({ vendorBranchId: vendor.branchId, subtotalMinor: expectedSubtotal });
      }

      const segmentOf = async (vendor: VendorFixture) => (await world.ds.query('SELECT id FROM order_vendor_segments WHERE order_id = $1 AND vendor_branch_id = $2', [order.id, vendor.branchId]))[0].id as string;
      const walk = async (vendor: VendorFixture, statuses: string[]) => {
        const id = await segmentOf(vendor);
        for (const status of statuses) expectData(await world.api('patch', `/vendor/orders/segments/${id}/status`, { token: vendor.manager.accessToken, body: { status } }));
      };
      await walk(v1, ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']);
      expect(await statusOf(order.id)).toBe('PENDING'); // v2 and v3 have not even confirmed
      await walk(v2, ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']);
      expect(await statusOf(order.id)).toBe('PENDING');
      await walk(v3, ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']);
      expect(await statusOf(order.id)).toBe('ASSIGNED_TO_DRIVER');

      const driver = await s.driverAssignedTo(order.id);
      const delivery = await deliveryOf(driver);
      expect(delivery.segments).toHaveLength(3);
      expectData(await driverStep(driver, delivery.id, 'PICKED_UP'));
      const commissions = await world.ds.query("SELECT amount_minor, vendor_branch_id FROM financial_events WHERE order_id = $1 AND type = 'VENDOR_COMMISSION_RECOGNIZED'", [order.id]);
      expect(commissions).toHaveLength(2); // v3 has no rate configured → fails closed, nothing fabricated
      expect(commissions.find((c: any) => c.vendor_branch_id === v1.branchId).amount_minor).toBe(1000);
      expect(commissions.find((c: any) => c.vendor_branch_id === v2.branchId).amount_minor).toBe(2000);
      await driverStep(driver, delivery.id, 'ON_THE_WAY');
      // M4 — Proof of Delivery is required for the DELIVERED transition.
      expectData(await driverStep(driver, delivery.id, 'DELIVERED', { proofPhotoUrl: await s.uploadFakePhoto(driver.accessToken) }));
    });

    it('MULTI_VENDOR_ORDERS_ENABLED=false refuses a multi-vendor checkout without touching the cart, but single-vendor checkout still works', async () => {
      await s.setConfig('MULTI_VENDOR_ORDERS_ENABLED', false);
      const customer = await s.customer();
      await s.addToCart(customer, p1.id, 1);
      await s.addToCart(customer, p2.id, 1);
      const orderBody = { deliveryAddress: { line1: 'x', latitude: home.lat, longitude: home.lng }, paymentMethod: 'COD' };
      const refused = await world.api('post', '/orders', { token: customer.accessToken, body: await withQuoteToken(world, customer.accessToken, orderBody) });
      try {
        expect(refused.status).toBe(409);
        expect(refused.body.error.details).toEqual({ code: 'MULTI_VENDOR_ORDERS_DISABLED' });
        expect((await world.api('get', '/cart', { token: customer.accessToken })).body.data.groups).toHaveLength(2);
        expect(await world.ds.query('SELECT id FROM orders WHERE customer_id = $1', [customer.id])).toEqual([]);
        await world.api('delete', `/cart/items/${(await world.api('get', '/cart', { token: customer.accessToken })).body.data.groups[1].items[0].id}`, { token: customer.accessToken });
        expectData(await world.api('post', '/orders', { token: customer.accessToken, body: await withQuoteToken(world, customer.accessToken, orderBody) }), 201);
      } finally {
        await s.setConfig('MULTI_VENDOR_ORDERS_ENABLED', true);
      }
    });

    it('per-branch auto-accept: only the branch that enabled it starts CONFIRMED; the other stays PENDING', async () => {
      expectData(await world.api('patch', `/admin/vendor-branches/${v1.branchId}/auto-accept`, { token: superAdmin.accessToken, body: { autoAcceptEnabled: true } }));
      const customer = await s.customer();
      await s.addToCart(customer, p1.id, 1);
      await s.addToCart(customer, p2.id, 1);
      const order = await s.checkout(customer, home);
      const rows = await world.ds.query('SELECT vendor_branch_id, status FROM order_vendor_segments WHERE order_id = $1', [order.id]);
      expect(rows.find((r: any) => r.vendor_branch_id === v1.branchId).status).toBe('CONFIRMED');
      expect(rows.find((r: any) => r.vendor_branch_id === v2.branchId).status).toBe('PENDING');
      expectData(await world.api('patch', `/admin/vendor-branches/${v1.branchId}/auto-accept`, { token: superAdmin.accessToken, body: { autoAcceptEnabled: false } }));
    });

    it('a vendor cancelling ITS segment lets the rest of the order proceed; stock of the cancelled portion comes back, no commission is booked on it (Group 8 fixes)', async () => {
      const t1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'TRACKED', quantity: 10 });
      const t2 = await s.product(v2, { priceMinor: 20000, inventoryMode: 'TRACKED', quantity: 10 });
      const stock = async (id: string) => (await world.ds.query('SELECT quantity FROM products WHERE id = $1', [id]))[0].quantity as number;
      const customer = await s.customer();
      await s.addToCart(customer, t1.id, 1);
      await s.addToCart(customer, t2.id, 2);
      const order = await s.checkout(customer, home);
      expect([await stock(t1.id), await stock(t2.id)]).toEqual([9, 8]);
      const segments = await world.ds.query('SELECT id, vendor_branch_id FROM order_vendor_segments WHERE order_id = $1', [order.id]);
      const of = (vendor: VendorFixture) => segments.find((r: any) => r.vendor_branch_id === vendor.branchId).id as string;

      const before = await orderRow(order.id);
      expectData(await world.api('patch', `/vendor/orders/segments/${of(v2)}/status`, { token: v2.manager.accessToken, body: { status: 'CANCELLED', reason: 'Out of stock' } }));
      expect(await stock(t2.id)).toBe(10); // the 2 units of the cancelled vendor are back
      expect(await stock(t1.id)).toBe(9); // the other vendor's units are untouched

      for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']) {
        expectData(await world.api('patch', `/vendor/orders/segments/${of(v1)}/status`, { token: v1.manager.accessToken, body: { status } }));
      }
      expect(await statusOf(order.id)).toBe('ASSIGNED_TO_DRIVER');
      const driver = await s.driverAssignedTo(order.id);
      const delivery = await deliveryOf(driver);
      for (const status of ['PICKED_UP', 'ON_THE_WAY', 'DELIVERED']) {
        // M4 — Proof of Delivery is required for the DELIVERED transition.
        const extra = status === 'DELIVERED' ? { proofPhotoUrl: await s.uploadFakePhoto(driver.accessToken) } : {};
        expectData(await driverStep(driver, delivery.id, status, extra));
      }
      const commissions = await world.ds.query("SELECT vendor_branch_id, amount_minor FROM financial_events WHERE order_id = $1 AND type = 'VENDOR_COMMISSION_RECOGNIZED'", [order.id]);
      expect(commissions).toEqual([{ vendor_branch_id: v1.branchId, amount_minor: 1000 }]); // none for the cancelled vendor

      // APPROVED PRODUCT DECISION (docs/PRODUCT_DECISIONS.md PD-002/PD-003), now implemented: the cancelled segment leaves the
      // subtotal/discounts/total and exactly one Additional Vendor Fee is dropped; the base delivery fee stays as quoted.
      // (Full money scenarios — refunds, 3 vendors, last segment, idempotency — are in 62-partial-cancellation.e2e-spec.ts.)
      const row = await orderRow(order.id);
      expect(Number(row.subtotal_minor)).toBe(10000); // only the remaining vendor's merchandise
      expect(Number(row.delivery_fee_minor)).toBe(Number(before.delivery_fee_minor) - 500); // one additional-vendor fee (500) fewer
      expect(Number(row.total_minor)).toBe(Number(row.subtotal_minor) + Number(row.delivery_fee_minor) - Number(row.discount_minor));
    });

    it('cancelling a segment and then the whole order restores each unit exactly once', async () => {
      const t1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'TRACKED', quantity: 10 });
      const t2 = await s.product(v2, { priceMinor: 20000, inventoryMode: 'TRACKED', quantity: 10 });
      const stock = async (id: string) => (await world.ds.query('SELECT quantity FROM products WHERE id = $1', [id]))[0].quantity as number;
      const customer = await s.customer();
      await s.addToCart(customer, t1.id, 3);
      await s.addToCart(customer, t2.id, 4);
      const order = await s.checkout(customer, home);
      const segments = await world.ds.query('SELECT id, vendor_branch_id FROM order_vendor_segments WHERE order_id = $1', [order.id]);
      const of = (vendor: VendorFixture) => segments.find((r: any) => r.vendor_branch_id === vendor.branchId).id as string;
      expectData(await world.api('patch', `/vendor/orders/segments/${of(v2)}/status`, { token: v2.manager.accessToken, body: { status: 'CANCELLED', reason: 'Out of stock' } }));
      expectData(await world.api('patch', `/orders/${order.id}/status`, { token: superAdmin.accessToken, body: { status: 'CANCELLED', cancellationReason: 'both' } }));
      expect([await stock(t1.id), await stock(t2.id)]).toEqual([10, 10]);
      // and cancelling the other way round (order first, then a segment) does not restore twice either
      const c2 = await s.customer();
      await s.addToCart(c2, t1.id, 2);
      await s.addToCart(c2, t2.id, 2);
      const o2 = await s.checkout(c2, home);
      const seg2 = await world.ds.query('SELECT id, vendor_branch_id FROM order_vendor_segments WHERE order_id = $1', [o2.id]);
      expectData(await world.api('patch', `/orders/${o2.id}/status`, { token: superAdmin.accessToken, body: { status: 'CANCELLED', cancellationReason: 'first' } }));
      await world.api('patch', `/vendor/orders/segments/${seg2.find((r: any) => r.vendor_branch_id === v2.branchId).id}/status`, { token: v2.manager.accessToken, body: { status: 'CANCELLED', reason: 'Out of stock' } });
      expect([await stock(t1.id), await stock(t2.id)]).toEqual([10, 10]);
    });
  });
});
