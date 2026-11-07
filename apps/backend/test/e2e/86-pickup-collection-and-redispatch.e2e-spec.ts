/**
 * U2 + U3 (approved product decisions) — over real HTTP against real PostgreSQL/Redis:
 *
 * U2 — a PICKUP order is completed by the customer collecting it at the branch: READY_FOR_PICKUP → COLLECTED (terminal),
 *      confirmed by that branch's vendor staff (Admin with MANAGE_ORDER_ISSUES as support fallback). Collection books the
 *      vendor commission (same event/rate/key as a delivery's PICKED_UP), earns loyalty and best-selling like DELIVERED and
 *      sends ORDER_COLLECTED. New pickup orders are cash at the counter only.
 * U3 — a DRIVER handing an assigned order back triggers ONE immediate automatic redispatch that never re-offers it to that
 *      driver; nobody else eligible → the existing NO_ELIGIBLE_DRIVER alert, no retry loop; reassignmentCount untouched.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, DriverFixture, VendorFixture, expectData, DEFAULT_PASSWORD } from './support/actors';
import { boundary } from './support/external-boundary';
import { Permission } from '../../src/modules/permissions/permission.enum';
import { Role } from '../../src/common/enums/role.enum';
import { AutomaticDispatchService } from '../../src/modules/delivery/automatic-dispatch.service';

describe('E2E — pickup collection (U2) and redispatch after a driver hand-back (U3)', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string };
  let vendor: VendorFixture;
  let otherVendor: VendorFixture;
  let product: { id: string };
  let superAdmin: Actor;
  let issuesAdmin: Actor; // MANAGE_ORDER_ISSUES — the admin fallback
  let viewerAdmin: Actor; // VIEW_ORDERS only
  const home = { lat: 30.425, lng: 31.565 };
  const near = { lat: 30.4212, lng: 31.5612 };
  const mid = { lat: 30.4212, lng: 31.5712 };
  const far = { lat: 30.4212, lng: 31.5812 };
  const ACTIVE = ['ASSIGNED_TO_DRIVER', 'PICKED_UP', 'ON_THE_WAY'];

  const q = (sql: string, params: unknown[] = []) => world.ds.query(sql, params);
  const statusOf = async (id: string) => (await q('SELECT status FROM orders WHERE id = $1', [id]))[0].status as string;
  const available = async (d: DriverFixture) => (await q('SELECT is_available FROM drivers WHERE id = $1', [d.driverId]))[0].is_available as boolean;
  const deliveries = (orderId: string) => q('SELECT driver_id, reassignment_count FROM deliveries WHERE order_id = $1', [orderId]);
  const events = (orderId: string, type: string) => q('SELECT * FROM financial_events WHERE order_id = $1 AND type = $2', [orderId, type]);
  const points = async (customerId: string, orderId: string) =>
    (await q(`SELECT points_delta FROM loyalty_points_transactions WHERE customer_id = $1 AND order_id = $2 AND type = 'EARNING'`, [customerId, orderId])).map((r: any) => r.points_delta);
  const soldCount = async (productId: string) => Number((await q('SELECT delivered_quantity_count FROM products WHERE id = $1', [productId]))[0].delivered_quantity_count);
  const openAlerts = async (orderId: string) => Number((await q('SELECT count(*)::int AS n FROM dispatch_alerts WHERE order_id = $1 AND resolved_at IS NULL', [orderId]))[0].n);
  const code = (res: any) => res.body?.error?.details?.code;
  const setStatus = (actor: Actor | null, orderId: string, status: string) =>
    world.api('patch', `/orders/${orderId}/status`, { token: actor?.accessToken, body: { status } });

  /** A COD pickup order of `vendor`, prepared to READY_FOR_PICKUP by its vendor (never dispatched). */
  async function readyPickup(customer?: Actor, quantity = 1) {
    const c = customer ?? (await s.customer());
    await s.addToCart(c, product.id, quantity);
    expectData(await world.api('patch', '/cart/fulfillment-type', { token: c.accessToken, body: { fulfillmentType: 'PICKUP' } }));
    const order = expectData<any>(await world.api('post', '/orders', { token: c.accessToken, body: { paymentMethod: 'COD' } }), 201);
    await s.vendorPrepares(vendor, order.id);
    expect(await statusOf(order.id)).toBe('READY_FOR_PICKUP');
    return { order: order as { id: string; orderNumber: string }, customer: c };
  }
  /** A READY delivery order (automatic dispatch decides — tests set the switch first). */
  async function readyDelivery() {
    const order = await s.simpleOrder(await s.customer(), vendor, product.id, home);
    await s.vendorPrepares(vendor, order.id);
    return order as { id: string; orderNumber: string };
  }
  const deliveryIdOf = async (d: DriverFixture, orderId: string) =>
    (expectData<any[]>(await world.api('get', '/driver/deliveries', { token: d.accessToken })).find((x) => x.orderId === orderId) ?? {}).id as string | undefined;
  const release = async (d: DriverFixture, orderId: string) => {
    const id = await deliveryIdOf(d, orderId);
    return id
      ? world.api('patch', `/driver/deliveries/${id}/status`, { token: d.accessToken, body: { status: 'READY_FOR_PICKUP' } })
      : { status: 404, body: null };
  };
  const assign = (orderId: string, driverId: string) =>
    world.api('post', `/admin/orders/${orderId}/assign-driver`, { token: superAdmin.accessToken, body: { driverId } });
  const reassign = (orderId: string, driverId: string, expectedCurrentDriverId: string) =>
    world.api('post', `/admin/orders/${orderId}/reassign-driver`, { token: superAdmin.accessToken, body: { driverId, expectedCurrentDriverId } });
  /** Only these drivers exist for ranking (every other driver of the run goes offline/unavailable). */
  const onlyDrivers = async (...positions: Array<{ lat: number; lng: number }>) => {
    await q('UPDATE drivers SET is_online = false, is_available = false');
    const out: DriverFixture[] = [];
    for (const p of positions) out.push(await s.driver({ ...p }));
    return out;
  };

  /** Order, its single delivery row and the given drivers are mutually consistent. */
  async function expectConsistent(orderId: string, drivers: DriverFixture[]) {
    const status = await statusOf(orderId);
    const rows = await deliveries(orderId);
    expect(rows.length).toBeLessThanOrEqual(1);
    const carrier = ACTIVE.includes(status) ? rows[0].driver_id : null;
    for (const d of drivers) {
      const [{ n }] = await q(
        `SELECT count(*)::int AS n FROM deliveries dl JOIN orders o ON o.id = dl.order_id WHERE dl.driver_id = $1 AND o.status = ANY($2)`,
        [d.driverId, ACTIVE],
      );
      expect(n).toBeLessThanOrEqual(1);
      expect({ driver: d.driverId, available: await available(d) }).toEqual({ driver: d.driverId, available: n === 0 });
    }
    if (carrier) expect(drivers.map((d) => d.driverId)).toContain(carrier);
    return { status, carrier, reassignmentCount: rows[0] ? Number(rows[0].reassignment_count) : null };
  }

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    vendor = await s.vendor({ name: 'Pickup Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561, commissionBasisPoints: 1000 });
    otherVendor = await s.vendor({ name: 'Other Vendor', serviceAreaId: area.id, lat: 30.422, lng: 31.562 });
    product = await s.product(vendor, { priceMinor: 10000, inventoryMode: 'OPEN' });
    superAdmin = await s.superAdmin();
    issuesAdmin = await s.admin([Permission.MANAGE_ORDER_ISSUES, Permission.VIEW_ORDERS], 'Issues Admin');
    viewerAdmin = await s.admin([Permission.VIEW_ORDERS], 'Viewer Admin');
  });
  beforeEach(async () => {
    boundary.reset();
    await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false);
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  // ================================================================== U2 =============================================
  describe('U2 — checkout: a new pickup order is cash at the counter only', () => {
    it('the quote offers only cash for a pickup (no wallet, transfer or pay-at-delivery); a delivery quote is unchanged', async () => {
      const c = await s.customer();
      await s.addToCart(c, product.id, 1);
      expectData(await world.api('patch', '/cart/fulfillment-type', { token: c.accessToken, body: { fulfillmentType: 'PICKUP' } }));
      const quote = expectData<any>(await world.api('post', '/checkout/quote', { token: c.accessToken, body: { paymentMethod: 'COD' } }), 201);
      expect(quote.payment.options).toMatchObject({ cod: true, payAtDelivery: false, manualTransfer: { available: false, reason: 'PICKUP_CASH_ONLY' } });
      expect(quote.payment.wallet.available).toBe(false);
      expect(quote.canPlaceOrder).toBe(true);
    });

    it('the server refuses Wallet / Manual Transfer / Pay at Delivery for a pickup even when submitted directly (PICKUP_CASH_ONLY) — nothing is created', async () => {
      await s.setConfig('MANUAL_TRANSFER_DESTINATION', { label: 'W', phoneOrAccountNumber: '010' });
      await s.setConfig('CUSTOMER_SERVICE_WHATSAPP_NUMBER', '+201000000000');
      const c = await s.customer();
      await s.addToCart(c, product.id, 1);
      expectData(await world.api('patch', '/cart/fulfillment-type', { token: c.accessToken, body: { fulfillmentType: 'PICKUP' } }));
      const before = Number((await q('SELECT count(*)::int AS n FROM orders WHERE customer_id = $1', [c.id]))[0].n);
      for (const body of [
        { paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY' },
        { paymentMethod: 'PAY_AT_DELIVERY', electronicPaymentMethod: 'INSTAPAY' },
        { paymentMethod: 'WALLET' },
        { paymentMethod: 'COD', useWallet: true },
      ]) {
        const res = await world.api('post', '/orders', { token: c.accessToken, body });
        // R20: Pay at Delivery is refused for every new order before the pickup rule is even reached.
        const expected = body.paymentMethod === 'PAY_AT_DELIVERY' ? 'PAY_AT_DELIVERY_NOT_AVAILABLE' : 'PICKUP_CASH_ONLY';
        expect({ body, status: res.status, code: code(res) }).toEqual({ body, status: 400, code: expected });
      }
      expect(Number((await q('SELECT count(*)::int AS n FROM orders WHERE customer_id = $1', [c.id]))[0].n)).toBe(before);
      const cash = expectData<any>(await world.api('post', '/orders', { token: c.accessToken, body: { paymentMethod: 'COD' } }), 201);
      expect(cash).toMatchObject({ paymentMethod: 'COD', fulfillmentType: 'PICKUP', walletAmountMinor: 0 });
    });
  });

  describe('U2 — collection', () => {
    it('the branch vendor manager marks it COLLECTED: commission, loyalty, best-selling and the ORDER_COLLECTED push — once; nothing driver-side', async () => {
      const { order, customer } = await readyPickup();
      expectData(await world.api('post', '/customer/device-token', { token: customer.accessToken, body: { token: 'fcm-pickup-customer', platform: 'android' } }), 201);
      const soldBefore = await soldCount(product.id);

      const res = await setStatus(vendor.manager, order.id, 'COLLECTED');
      expect(expectData<any>(res).status).toBe('COLLECTED');

      const [commission] = await events(order.id, 'VENDOR_COMMISSION_RECOGNIZED');
      expect(commission).toMatchObject({ amount_minor: 1000, vendor_branch_id: vendor.branchId }); // 10% of 100.00, same rule as PICKED_UP
      expect(await events(order.id, 'VENDOR_COMMISSION_RECOGNIZED')).toHaveLength(1);
      expect(await events(order.id, 'DRIVER_COMMISSION_RECOGNIZED')).toHaveLength(0);
      expect(await events(order.id, 'DRIVER_REIMBURSEMENT_OWED')).toHaveLength(0);
      expect(await points(customer.id, order.id)).toEqual([100]); // 1 point / EGP, same as a delivered order
      expect(await soldCount(product.id)).toBe(soldBefore + 1);
      const pushes = boundary.push.filter((p) => p.data.orderId === order.id);
      expect(pushes.map((p) => p.data.type)).toEqual(['ORDER_COLLECTED']);
      expect(pushes[0].tokens).toEqual(['fcm-pickup-customer']);
      expect(await deliveries(order.id)).toHaveLength(0); // never a driver
      const timeline = expectData<any>(await world.api('get', `/orders/${order.id}`, { token: customer.accessToken })).timeline;
      expect(timeline.at(-1)).toMatchObject({ status: 'COLLECTED' });

      // repeated request: refused, and nothing is booked twice
      const again = await setStatus(vendor.manager, order.id, 'COLLECTED');
      expect(again.status).toBe(400);
      expect(await events(order.id, 'VENDOR_COMMISSION_RECOGNIZED')).toHaveLength(1);
      expect(await points(customer.id, order.id)).toEqual([100]);
      expect(await soldCount(product.id)).toBe(soldBefore + 1);
      expect(boundary.push.filter((p) => p.data.orderId === order.id)).toHaveLength(1);
    });

    it('concurrent collection by the vendor, a second vendor staff member and the admin: exactly one wins; side effects exactly once', async () => {
      const staffPhone = `+2010${`${Date.now()}`.slice(-8)}`;
      expectData(
        await world.api('post', '/admin/vendor-staff', {
          token: superAdmin.accessToken,
          body: { phone: staffPhone, fullName: 'Counter Staff', vendorBranchId: vendor.branchId, password: DEFAULT_PASSWORD, role: Role.VENDOR },
        }),
        201,
      );
      const counterStaff = await s.login('/auth/password/login', { phone: staffPhone, fullName: 'Counter Staff', role: Role.VENDOR });
      for (let round = 0; round < 3; round++) {
        const { order, customer } = await readyPickup();
        const soldBefore = await soldCount(product.id);
        const results = await Promise.all([
          setStatus(vendor.manager, order.id, 'COLLECTED'),
          setStatus(counterStaff, order.id, 'COLLECTED'),
          setStatus(issuesAdmin, order.id, 'COLLECTED'),
        ]);
        expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400]); // the losers find it already COLLECTED
        expect(await statusOf(order.id)).toBe('COLLECTED');
        expect(await events(order.id, 'VENDOR_COMMISSION_RECOGNIZED')).toHaveLength(1);
        expect(await points(customer.id, order.id)).toEqual([100]);
        expect(await soldCount(product.id)).toBe(soldBefore + 1);
        expect(Number((await q(`SELECT count(*)::int AS n FROM order_status_events WHERE order_id = $1 AND to_status = 'COLLECTED'`, [order.id]))[0].n)).toBe(1);
      }
    });

    it('a plain VENDOR (counter staff) of the branch may collect; the admin fallback works with MANAGE_ORDER_ISSUES', async () => {
      const staffPhone = `+2010${`${Date.now() + 7}`.slice(-8)}`;
      expectData(
        await world.api('post', '/admin/vendor-staff', {
          token: superAdmin.accessToken,
          body: { phone: staffPhone, fullName: 'Counter Staff 2', vendorBranchId: vendor.branchId, password: DEFAULT_PASSWORD, role: Role.VENDOR },
        }),
        201,
      );
      const staff = await s.login('/auth/password/login', { phone: staffPhone, fullName: 'Counter Staff 2', role: Role.VENDOR });
      const a = await readyPickup();
      expectData(await setStatus(staff, a.order.id, 'COLLECTED'));
      const b = await readyPickup();
      expectData(await setStatus(issuesAdmin, b.order.id, 'COLLECTED'));
      expect([await statusOf(a.order.id), await statusOf(b.order.id)]).toEqual(['COLLECTED', 'COLLECTED']);
      expect((await q(`SELECT actor_role FROM order_status_events WHERE order_id = $1 AND to_status = 'COLLECTED'`, [b.order.id]))[0].actor_role).toBe('ADMIN');
    });

    it('authorization: another branch (404, no IDOR), the customer, a driver, an admin without MANAGE_ORDER_ISSUES (403) and anonymous (401) are refused — nothing changes', async () => {
      const { order, customer } = await readyPickup();
      const [driver] = await onlyDrivers(near);
      const results = {
        otherBranch: (await setStatus(otherVendor.manager, order.id, 'COLLECTED')).status,
        customer: (await setStatus(customer, order.id, 'COLLECTED')).status,
        driver: (await setStatus(driver, order.id, 'COLLECTED')).status,
        viewerAdmin: (await setStatus(viewerAdmin, order.id, 'COLLECTED')).status,
        anonymous: (await setStatus(null, order.id, 'COLLECTED')).status,
      };
      expect(results).toEqual({ otherBranch: 404, customer: 400, driver: 404, viewerAdmin: 403, anonymous: 401 });
      const missing = await setStatus(vendor.manager, '00000000-0000-4000-8000-000000000000', 'COLLECTED');
      expect(missing.status).toBe(404); // same answer as another branch's order: existence is never revealed
      expect(await statusOf(order.id)).toBe('READY_FOR_PICKUP');
      expect(await events(order.id, 'VENDOR_COMMISSION_RECOGNIZED')).toHaveLength(0);
    });

    it('guards: only READY_FOR_PICKUP; never a DELIVERY order; never after cancellation; COLLECTED is terminal; a pickup is never assigned a driver', async () => {
      // not yet ready
      const c = await s.customer();
      await s.addToCart(c, product.id, 1);
      expectData(await world.api('patch', '/cart/fulfillment-type', { token: c.accessToken, body: { fulfillmentType: 'PICKUP' } }));
      const pending = expectData<any>(await world.api('post', '/orders', { token: c.accessToken, body: { paymentMethod: 'COD' } }), 201);
      expect((await setStatus(vendor.manager, pending.id, 'COLLECTED')).status).toBe(400);
      expect(await statusOf(pending.id)).toBe('PENDING');

      // a delivery order can never be collected
      const delivery = await readyDelivery();
      const refused = await setStatus(vendor.manager, delivery.id, 'COLLECTED');
      expect([refused.status, code(refused)]).toEqual([409, 'NOT_A_PICKUP_ORDER']);

      // cancelled → never collected
      const cancelled = await readyPickup();
      expectData(await setStatus(vendor.manager, cancelled.order.id, 'CANCELLED'));
      expect((await setStatus(vendor.manager, cancelled.order.id, 'COLLECTED')).status).toBe(400);
      expect(await events(cancelled.order.id, 'VENDOR_COMMISSION_RECOGNIZED')).toHaveLength(0);

      // terminal
      const done = await readyPickup();
      expectData(await setStatus(vendor.manager, done.order.id, 'COLLECTED'));
      for (const to of ['CANCELLED', 'READY_FOR_PICKUP', 'ASSIGNED_TO_DRIVER', 'DELIVERED', 'FAILED_DELIVERY', 'PICKED_UP']) {
        const res = await setStatus(superAdmin, done.order.id, to);
        expect({ to, status: res.status }).toEqual({ to, status: 400 });
      }
      expect(await statusOf(done.order.id)).toBe('COLLECTED');
      const segment = (await q('SELECT id FROM order_vendor_segments WHERE order_id = $1', [done.order.id]))[0];
      expect((await world.api('patch', `/vendor/orders/segments/${segment.id}/status`, { token: vendor.manager.accessToken, body: { status: 'CANCELLED', reason: 'Out of stock' } })).status).toBeGreaterThanOrEqual(400);

      // the generic endpoint can never hand a pickup to a driver either
      const pickup = await readyPickup();
      const viaGeneric = await setStatus(superAdmin, pickup.order.id, 'ASSIGNED_TO_DRIVER');
      expect([viaGeneric.status, code(viaGeneric)]).toEqual([409, 'PICKUP_ORDER_NOT_DISPATCHABLE']);
      expect(await statusOf(pickup.order.id)).toBe('READY_FOR_PICKUP');
    });

    it('an EXISTING pickup order keeps its original payment method and can still be collected (the cash-only rule is for new orders)', async () => {
      const { order } = await readyPickup();
      await q(`UPDATE orders SET payment_method = 'PAY_AT_DELIVERY', electronic_payment_method = 'INSTAPAY' WHERE id = $1`, [order.id]); // as created before U2
      expectData(await setStatus(vendor.manager, order.id, 'COLLECTED'));
      expect((await q('SELECT payment_method, electronic_payment_method FROM orders WHERE id = $1', [order.id]))[0]).toEqual({
        payment_method: 'PAY_AT_DELIVERY',
        electronic_payment_method: 'INSTAPAY',
      });
      expect(await events(order.id, 'VENDOR_COMMISSION_RECOGNIZED')).toHaveLength(1);
    });

    it('a weighed item without its recorded weight blocks collection (WEIGHT_NOT_RECORDED); once recorded, it is collected', async () => {
      const weighed = await s.product(vendor, { priceMinor: 5000, inventoryMode: 'OPEN', pricingUnit: 'WEIGHT' });
      const c = await s.customer();
      expectData(await world.api('post', '/cart/items', { token: c.accessToken, body: { productId: weighed.id, quantity: 1, requestedWeightGrams: 1000 } }), 201);
      expectData(await world.api('patch', '/cart/fulfillment-type', { token: c.accessToken, body: { fulfillmentType: 'PICKUP' } }));
      const order = expectData<any>(await world.api('post', '/orders', { token: c.accessToken, body: { paymentMethod: 'COD' } }), 201);
      await s.vendorPrepares(vendor, order.id);
      const blocked = await setStatus(vendor.manager, order.id, 'COLLECTED');
      expect([blocked.status, code(blocked)]).toEqual([400, 'WEIGHT_NOT_RECORDED']);
      const [item] = await q('SELECT oi.id FROM order_items oi JOIN order_vendor_segments s ON s.id = oi.order_vendor_segment_id WHERE s.order_id = $1', [order.id]);
      expectData(await world.api('post', `/vendor/orders/order-items/${item.id}/weight`, { token: vendor.manager.accessToken, body: { weightGrams: 950 } }), 201);
      expectData(await setStatus(vendor.manager, order.id, 'COLLECTED'));
    });

    it('customer views: COLLECTED is in the "completed" tab with no ETA countdown; the vendor and its products can be rated, there is no driver to rate', async () => {
      const { order, customer } = await readyPickup();
      expectData(await setStatus(vendor.manager, order.id, 'COLLECTED'));
      const completed = expectData<any[]>(await world.api('get', '/orders?tab=completed', { token: customer.accessToken }));
      expect(completed.map((o) => o.id)).toContain(order.id);
      expect(expectData<any[]>(await world.api('get', '/orders?tab=active', { token: customer.accessToken })).map((o) => o.id)).not.toContain(order.id);
      const tracking = expectData<any>(await world.api('get', `/orders/${order.id}/tracking`, { token: customer.accessToken }));
      expect(tracking.status).toBe('COLLECTED');
      expect(tracking.eta).toMatchObject({ estimatedAt: null });
      const rating = expectData<any>(await world.api('get', `/orders/${order.id}/rating-state`, { token: customer.accessToken }));
      expect(rating.driver).toBeNull();
      expect(rating.vendorSegments).toHaveLength(1);
      const segmentId = rating.vendorSegments[0].orderVendorSegmentId;
      expectData(await world.api('post', '/ratings/vendor', { token: customer.accessToken, body: { orderVendorSegmentId: segmentId, stars: 5 } }), 201);
    });

    it('a failure while booking the commission never undoes the collection, and a retry can never book it twice (idempotent key)', async () => {
      const { order } = await readyPickup();
      await q(`CREATE OR REPLACE FUNCTION e2e_injected_failure() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'e2e injected failure'; END $$ LANGUAGE plpgsql`);
      await q(`CREATE TRIGGER e2e_fault BEFORE INSERT ON financial_events FOR EACH ROW WHEN (NEW.type = 'VENDOR_COMMISSION_RECOGNIZED') EXECUTE FUNCTION e2e_injected_failure()`);
      try {
        expectData(await setStatus(vendor.manager, order.id, 'COLLECTED')); // the collection itself still succeeds
      } finally {
        await q('DROP TRIGGER IF EXISTS e2e_fault ON financial_events');
        await q('DROP FUNCTION IF EXISTS e2e_injected_failure()');
      }
      expect(await statusOf(order.id)).toBe('COLLECTED');
      expect(await events(order.id, 'VENDOR_COMMISSION_RECOGNIZED')).toHaveLength(0);
      // the single chokepoint, re-run (what an operator replay does): booked exactly once, however often it runs
      const { OrderFinancialEventsService } = await import('../../src/modules/finance/order-financial-events.service');
      const fin = world.app.get(OrderFinancialEventsService);
      const row = (await q('SELECT * FROM orders WHERE id = $1', [order.id]))[0];
      const asOrder = { id: row.id, paymentMethod: row.payment_method, deliveryFeeMinor: row.delivery_fee_minor } as any;
      await Promise.all([fin.handleTransition(asOrder, 'COLLECTED' as any), fin.handleTransition(asOrder, 'COLLECTED' as any)]);
      await fin.handleTransition(asOrder, 'COLLECTED' as any);
      expect(await events(order.id, 'VENDOR_COMMISSION_RECOGNIZED')).toHaveLength(1);
    });

    it('admin views: Control Tower counts it out of "pickup ready" once collected; admin search finds it COLLECTED with no driver', async () => {
      const { order } = await readyPickup();
      const before = expectData<any>(await world.api('get', '/admin/control-tower/summary', { token: superAdmin.accessToken })).attention.readyForCustomerPickup;
      expectData(await setStatus(issuesAdmin, order.id, 'COLLECTED'));
      const after = expectData<any>(await world.api('get', '/admin/control-tower/summary', { token: superAdmin.accessToken })).attention.readyForCustomerPickup;
      expect(after).toBe(before - 1);
      const found = expectData<any[]>(await world.api('get', `/admin/orders?search=${order.orderNumber}`, { token: superAdmin.accessToken }));
      expect(found[0]).toMatchObject({ status: 'COLLECTED', fulfillmentType: 'PICKUP' });
      const detail = expectData<any>(await world.api('get', `/admin/orders/${order.id}`, { token: superAdmin.accessToken }));
      expect(detail).toMatchObject({ status: 'COLLECTED', driver: null, delivery: null });
      const collectedOnly = expectData<any[]>(await world.api('get', '/admin/orders?status=COLLECTED&limit=50', { token: superAdmin.accessToken }));
      expect(collectedOnly.every((o) => o.status === 'COLLECTED')).toBe(true);
    });
  });

  // ================================================================== U3 =============================================
  describe('R17 (supersedes U3): drivers cannot hand an assignment back — only Operations release and reassign', () => {
    it.each([true, false])('automatic dispatch %p: the driver release is refused on both endpoints; the order, its driver and the timeline are unchanged', async (auto) => {
      const [d1, d2] = await onlyDrivers(near, mid);
      const order = await readyDelivery();
      expectData(await assign(order.id, d1.driverId), 201);
      await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', auto);

      const viaDriver = await release(d1, order.id);
      expect(viaDriver.status).toBe(400);
      const viaGeneric = await world.api('patch', `/orders/${order.id}/status`, { token: d1.accessToken, body: { status: 'READY_FOR_PICKUP' } });
      expect(viaGeneric.status).toBeGreaterThanOrEqual(400);
      expect(viaGeneric.status).toBeLessThan(500);

      const { status, carrier, reassignmentCount } = await expectConsistent(order.id, [d1, d2]);
      expect([status, carrier, reassignmentCount]).toEqual(['ASSIGNED_TO_DRIVER', d1.driverId, 0]);
      expect(await available(d1)).toBe(false);
      const released = await q(`SELECT count(*)::int AS n FROM order_status_events WHERE order_id = $1 AND to_status = 'READY_FOR_PICKUP' AND from_status = 'ASSIGNED_TO_DRIVER'`, [order.id]);
      expect(released[0].n).toBe(0);
      await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false);
    });

    it('Operations reassign the order to another driver: old driver freed, new one busy, one delivery row', async () => {
      const [d1, d2] = await onlyDrivers(near, mid);
      const order = await readyDelivery();
      expectData(await assign(order.id, d1.driverId), 201);
      expect((await reassign(order.id, d2.driverId, d1.driverId)).status).toBe(201);
      const { status, carrier } = await expectConsistent(order.id, [d1, d2]);
      expect([status, carrier]).toEqual(['ASSIGNED_TO_DRIVER', d2.driverId]);
      expect(await available(d1)).toBe(true);
      expect(await deliveries(order.id)).toHaveLength(1);
    });
  });
});
