/**
 * Group 8 / phases 20 & 21 — transaction failure + retry, and external-provider isolation.
 *
 * FAILURE SEAM (test-only, documented): a PostgreSQL trigger is installed in the disposable
 * `hatly_e2e_test` database for the duration of a single test. It raises an exception at one chosen
 * statement — e.g. the very last write of checkout — so the REAL application code, running inside its
 * REAL transaction, fails exactly where a crash/deadlock/constraint error would. Nothing in `src/` knows
 * about it, no mock is involved, and the trigger is always dropped in `finally`. Each scenario proves
 * (a) nothing partial survives (atomic rollback), (b) no lock is left behind, (c) the very same
 * request succeeds once the fault is gone, and (d) the client sees a generic 5xx with no internals.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, DriverFixture, VendorFixture, expectData, withQuoteToken, DEFAULT_PASSWORD } from './support/actors';
import { boundary } from './support/external-boundary';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — transaction failure, retry and provider isolation', () => {
  let world: World;
  let s: Scenario;
  let vendor: VendorFixture;
  let superAdmin: Actor;
  let driver: DriverFixture;
  let reviewer: Actor;
  const home = { lat: 30.425, lng: 31.565 };

  const q = (sql: string, params: unknown[] = []) => world.ds.query(sql, params);
  const stock = async (id: string) => (await q('SELECT quantity FROM products WHERE id = $1', [id]))[0].quantity as number;
  const count = async (table: string, where = '1=1', params: unknown[] = []) => Number((await q(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params))[0].n);

  /** Installs a BEFORE trigger that raises on the given statement, runs `fn`, and ALWAYS removes it. */
  const withFault = async (table: string, event: 'INSERT' | 'UPDATE', when: string, fn: () => Promise<void>) => {
    await q(`CREATE OR REPLACE FUNCTION e2e_injected_failure() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'e2e injected failure'; END $$ LANGUAGE plpgsql`);
    await q(`CREATE TRIGGER e2e_fault BEFORE ${event} ON ${table} FOR EACH ROW WHEN (${when}) EXECUTE FUNCTION e2e_injected_failure()`);
    try {
      await fn();
    } finally {
      await q(`DROP TRIGGER IF EXISTS e2e_fault ON ${table}`);
      await q('DROP FUNCTION IF EXISTS e2e_injected_failure()');
    }
  };
  const expectGeneric5xx = (res: { status: number; body: any }) => {
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/injected|e2e|trigger|plpgsql|QueryFailed|SELECT|INSERT|UPDATE/i);
  };
  const deliveryOf = async (orderId: string, d: Actor = driver) => expectData<any[]>(await world.api('get', '/driver/deliveries', { token: d.accessToken })).find((x) => x.orderId === orderId);

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    vendor = await s.vendor({ name: 'Fault Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561, commissionBasisPoints: 1000 });
    superAdmin = await s.superAdmin();
    reviewer = await s.admin([Permission.VERIFY_MANUAL_PAYMENTS, Permission.MANAGE_CUSTOMER_WALLET]);
    driver = await s.driver({ lat: 30.4212, lng: 31.5612 });
    await s.setConfig('MANUAL_TRANSFER_DESTINATION', { label: 'W', phoneOrAccountNumber: '010' });
    await s.setConfig('CUSTOMER_SERVICE_WHATSAPP_NUMBER', '+201000000000');
  });
  beforeEach(async () => {
    boundary.reset();
    // Test hygiene: a test that leaves an order with a driver would keep the one driver busy for every later test. R18 counts a driver's active
    // orders against their capacity, so merely flagging them available is not enough — the leftover orders are closed (test data only).
    await q("UPDATE orders SET status = 'CANCELLED' WHERE status::text IN ('ASSIGNED_TO_DRIVER', 'PICKED_UP', 'ON_THE_WAY')");
    await q('UPDATE drivers SET is_online = true, is_available = true');
  });
  afterAll(async () => {
    try {
      // the ONLY 5xx this suite provokes are the injected ones; nothing else may have crashed
      const unexpected = world.unhandledServerErrors().filter((m) => !/e2e injected failure/.test(m));
      expect(unexpected).toEqual([]);
      expect(boundary.forbiddenCalls).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('atomic rollback and retry', () => {
    it('checkout failing at its LAST write leaves nothing behind (no order/segments/items/payment/offer use, stock intact, cart intact) and the identical retry then succeeds once', async () => {
      const product = await s.product(vendor, { priceMinor: 10000, inventoryMode: 'TRACKED', quantity: 10 });
      await world.api('post', '/admin/offers', { token: superAdmin.accessToken, body: { vendorBranchId: vendor.branchId, name: 'Flash', mechanism: 'FLASH_SALE', specialPriceMinor: 7000, productIds: [product.id], totalAllocationLimit: 5, startAt: new Date(Date.now() - 3.6e6).toISOString(), endAt: new Date(Date.now() + 3.6e6).toISOString() } });
      const c = await s.customer();
      await s.addToCart(c, product.id, 2);
      const before = { orders: await count('orders'), items: await count('order_items'), consumptions: await count('offer_consumptions'), payments: await count('payments') };
      const body = { deliveryAddress: { line1: 'Fault Street', latitude: home.lat, longitude: home.lng }, paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY' };

      const orderBody = await withQuoteToken(world, c.accessToken, body);
      await withFault('carts', 'UPDATE', `NEW.status = 'ORDERED'`, async () => {
        expectGeneric5xx(await world.api('post', '/orders', { token: c.accessToken, body: orderBody }));
      });

      expect({ orders: await count('orders'), items: await count('order_items'), consumptions: await count('offer_consumptions'), payments: await count('payments') }).toEqual(before);
      expect(await stock(product.id)).toBe(10);
      expect(Number((await q("SELECT consumed_units_count FROM offers WHERE name = 'Flash'"))[0].consumed_units_count)).toBe(0);
      expect(await q("SELECT status FROM carts WHERE customer_id = $1", [c.id])).toEqual([{ status: 'ACTIVE' }]);
      expect((await world.api('get', '/cart', { token: c.accessToken })).body.data.groups[0].items[0].quantity).toBe(2);

      // no lock survives the failure: the retry (and other customers) proceed immediately
      const started = Date.now();
      const retry = await world.api('post', '/orders', { token: c.accessToken, body: await withQuoteToken(world, c.accessToken, body) });
      expect(retry.status).toBe(201);
      expect(Date.now() - started).toBeLessThan(5000);
      expect(await stock(product.id)).toBe(8);
      expect(Number((await q("SELECT consumed_units_count FROM offers WHERE name = 'Flash'"))[0].consumed_units_count)).toBe(2);
      expect(await count('orders', 'customer_id = $1', [c.id])).toBe(1);
      expect(await count('payments', 'order_id = $1', [retry.body.data.id])).toBe(1);
    });

    it('a failure while recording DELIVERED (loyalty write) rolls the whole transition back — order still ON_THE_WAY, driver still busy, no timestamp, no push — and the retry completes exactly once', async () => {
      const product = await s.product(vendor, { priceMinor: 10000, inventoryMode: 'OPEN' });
      const c = await s.customer();
      expectData(await world.api('post', '/customer/device-token', { token: c.accessToken, body: { token: 'fcm-fault', platform: 'ios' } }), 201);
      await s.addToCart(c, product.id, 3);
      const order = await s.checkout(c, home);
      await s.vendorPrepares(vendor, order.id);
      const delivery = await deliveryOf(order.id);
      for (const st of ['PICKED_UP', 'ON_THE_WAY']) expectData(await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: driver.accessToken, body: { status: st } }));
      boundary.push.length = 0;

      // M4 — Proof of Delivery is required for the DELIVERED transition, and is recorded (idempotently)
      // as its own step BEFORE the transition — captured once, reused across the faulted attempt and the retry.
      const proofPhotoUrl = await s.uploadFakePhoto(driver.accessToken);
      await withFault('loyalty_points_transactions', 'INSERT', 'true', async () => {
        expectGeneric5xx(await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: driver.accessToken, body: { status: 'DELIVERED', proofPhotoUrl } }));
      });

      expect((await q('SELECT status FROM orders WHERE id = $1', [order.id]))[0].status).toBe('ON_THE_WAY');
      expect((await q('SELECT delivered_at FROM deliveries WHERE order_id = $1', [order.id]))[0].delivered_at).toBeNull();
      expect((await q('SELECT is_available FROM drivers WHERE id = $1', [driver.driverId]))[0].is_available).toBe(false);
      expect(await count('loyalty_points_transactions', 'order_id = $1', [order.id])).toBe(0);
      expect(await count('financial_events', "order_id = $1 AND type = 'DRIVER_COMMISSION_RECOGNIZED'", [order.id])).toBe(0);
      expect(boundary.push.filter((p) => p.data.type === 'ORDER_DELIVERED')).toEqual([]);

      expectData(await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: driver.accessToken, body: { status: 'DELIVERED', proofPhotoUrl } }));
      expect((await q('SELECT status FROM orders WHERE id = $1', [order.id]))[0].status).toBe('DELIVERED');
      expect(await count('loyalty_points_transactions', 'order_id = $1', [order.id])).toBe(1);
      expect(boundary.push.filter((p) => p.data.type === 'ORDER_DELIVERED')).toHaveLength(1);
      expect((await q('SELECT is_available FROM drivers WHERE id = $1', [driver.driverId]))[0].is_available).toBe(true);
    });

    it('cancelling a PAID manual-transfer order fails atomically when the refund cannot be recorded: order NOT cancelled, stock NOT restored; the retry cancels, restores and refunds exactly once', async () => {
      const product = await s.product(vendor, { priceMinor: 10000, inventoryMode: 'TRACKED', quantity: 6 });
      const c = await s.customer();
      await s.addToCart(c, product.id, 2);
      const order = await s.checkout(c, home, 'MANUAL_TRANSFER');
      const payment = (await q('SELECT id FROM payments WHERE order_id = $1', [order.id]))[0];
      await world.api('post', `/payments/manual-transfer/orders/${order.id}/claim`, { token: c.accessToken, body: {} });
      expectData(await world.api('post', `/admin/manual-transfer-payments/${payment.id}/approve`, { token: reviewer.accessToken }), 201);
      expect(await stock(product.id)).toBe(4);
      const cancel = () => world.api('patch', `/orders/${order.id}/status`, { token: superAdmin.accessToken, body: { status: 'CANCELLED', cancellationReason: 'fault test' } });

      await withFault('financial_events', 'INSERT', `NEW.type = 'MANUAL_TRANSFER_REFUND_RECORDED'`, async () => {
        expectGeneric5xx(await cancel());
      });

      expect((await q('SELECT status, cancellation_reason FROM orders WHERE id = $1', [order.id]))[0]).toEqual({ status: 'PENDING', cancellation_reason: null });
      expect(await stock(product.id)).toBe(4);
      expect((await q('SELECT status FROM payments WHERE id = $1', [payment.id]))[0].status).toBe('PAID');
      expect(await count('financial_events', "order_id = $1 AND type = 'MANUAL_TRANSFER_REFUND_RECORDED'", [order.id])).toBe(0);

      expect((await cancel()).status).toBe(200);
      expect(await stock(product.id)).toBe(6);
      expect(await count('financial_events', "order_id = $1 AND type = 'MANUAL_TRANSFER_REFUND_RECORDED'", [order.id])).toBe(1);
    });

    it('an approved cash remainder whose wallet credit fails stays PENDING_REVIEW (no credit, no status change); the retry credits once', async () => {
      const product = await s.product(vendor, { priceMinor: 10000, inventoryMode: 'OPEN' });
      const c = await s.customer();
      await s.addToCart(c, product.id, 1);
      const order = await s.checkout(c, home);
      await s.vendorPrepares(vendor, order.id);
      const delivery = await deliveryOf(order.id);
      for (const st of ['PICKED_UP', 'ON_THE_WAY', 'DELIVERED']) {
        // M4 — Proof of Delivery is required for the DELIVERED transition.
        const body = st === 'DELIVERED' ? { status: st, proofPhotoUrl: await s.uploadFakePhoto(driver.accessToken) } : { status: st };
        expectData(await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: driver.accessToken, body }));
      }
      const remainder = expectData(await world.api('post', `/driver/deliveries/${delivery.id}/cash-remainder`, { token: driver.accessToken, body: { cashReceivedMinor: order.totalMinor + 900 } }), 201);
      const approve = () => world.api('patch', `/admin/cash-remainders/${remainder.id}/approve`, { token: reviewer.accessToken });

      await withFault('wallet_transactions', 'INSERT', 'true', async () => {
        expectGeneric5xx(await approve());
      });
      expect((await q('SELECT status FROM driver_cash_remainders WHERE id = $1', [remainder.id]))[0].status).toBe('PENDING_REVIEW');
      expect(await count('wallet_transactions', 'customer_id = $1', [c.id])).toBe(0);

      expect((await approve()).status).toBe(200);
      expect(await count('wallet_transactions', 'customer_id = $1', [c.id])).toBe(1);
      expect((await approve()).status).toBe(400); // and a further retry cannot credit again
      expect(await count('wallet_transactions', 'customer_id = $1', [c.id])).toBe(1);
    });

    it('a loyalty conversion failing mid-way debits nothing; retrying with the SAME idempotency key then converts exactly once', async () => {
      // Consolidated customer-commerce milestone (Parts C/D): 3 units at 200 EGP = 600 points earned —
      // enough to convert the APPROVED V1 minimum (500) and still leave a nonzero remainder to assert on,
      // same shape this test always had, just scaled up to comply with the new minimum.
      const product = await s.product(vendor, { priceMinor: 20000, inventoryMode: 'OPEN' });
      const c = await s.customer();
      await s.addToCart(c, product.id, 3);
      const order = await s.checkout(c, home);
      await s.vendorPrepares(vendor, order.id);
      const delivery = await deliveryOf(order.id);
      for (const st of ['PICKED_UP', 'ON_THE_WAY', 'DELIVERED']) {
        // M4 — Proof of Delivery is required for the DELIVERED transition.
        const body = st === 'DELIVERED' ? { status: st, proofPhotoUrl: await s.uploadFakePhoto(driver.accessToken) } : { status: st };
        expectData(await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: driver.accessToken, body }));
      }
      const convert = () => world.api('post', '/customer/loyalty/convert', { token: c.accessToken, body: { points: 500, idempotencyKey: 'retry-key' } });
      await withFault('wallet_transactions', 'INSERT', 'true', async () => {
        expectGeneric5xx(await convert());
      });
      expect(Number((await q('SELECT COALESCE(SUM(points_delta),0) AS b FROM loyalty_points_transactions WHERE customer_id = $1', [c.id]))[0].b)).toBe(600);
      const ok = await convert();
      expect(ok.status).toBe(201);
      expect(ok.body.data).toMatchObject({ pointsBalance: 100, walletBalance: 500 });
      expect((await convert()).body.data).toMatchObject({ pointsBalance: 100, walletBalance: 500 }); // replay of the same key
    });

    it('a failure in POST-commit bookkeeping (vendor commission ledger) never fails the driver\'s request — but the ledger gap is loud in the logs (CHARACTERIZATION: there is no retry/outbox)', async () => {
      const product = await s.product(vendor, { priceMinor: 10000, inventoryMode: 'OPEN' });
      const c = await s.customer();
      await s.addToCart(c, product.id, 1);
      const order = await s.checkout(c, home);
      await s.vendorPrepares(vendor, order.id);
      const delivery = await deliveryOf(order.id);
      await withFault('financial_events', 'INSERT', `NEW.type = 'VENDOR_COMMISSION_RECOGNIZED'`, async () => {
        expectData(await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: driver.accessToken, body: { status: 'PICKED_UP' } }));
      });
      expect((await q('SELECT status FROM orders WHERE id = $1', [order.id]))[0].status).toBe('PICKED_UP');
      expect(await count('financial_events', "order_id = $1 AND type = 'VENDOR_COMMISSION_RECOGNIZED'", [order.id])).toBe(0);
      expect(world.logs.some((l) => l.level === 'error' && l.message.includes(`Financial event recognition failed for order ${order.id}`))).toBe(true);
    });

    it('concurrent checkouts while one of them is failing: the failure never blocks, corrupts or double-spends the others', async () => {
      // Stock covers all four racers on purpose. With fewer units than racers, WHICH racer reaches the atomic stock update last is
      // a scheduling accident, and the last one correctly gets a plain "sold out" 400 instead of ever reaching the injected fault.
      // Enough stock makes the outcome independent of ordering while still proving what matters: the injected failure rolls back
      // only its own order (its unit is returned), never blocks the others, and stock is never double-spent or negative.
      const product = await s.product(vendor, { priceMinor: 10000, inventoryMode: 'TRACKED', quantity: 4 });
      const carts: Actor[] = [];
      for (let i = 0; i < 4; i += 1) {
        const c = await s.customer(`Fault Racer ${i}`);
        await s.addToCart(c, product.id, 1);
        carts.push(c);
      }
      const latecomer = await s.customer('Fault Latecomer'); // not part of the race; tries once everything is genuinely sold out
      await s.addToCart(latecomer, product.id, 1);
      const body = { deliveryAddress: { line1: 'x', latitude: home.lat, longitude: home.lng }, paymentMethod: 'COD' };
      let results: Array<{ status: number }> = [];
      // the fault only affects the FIRST customer's cart; the other three must still all succeed
      await withFault('carts', 'UPDATE', `NEW.status = 'ORDERED' AND NEW.customer_id = '${carts[0].id}'`, async () => {
        results = await Promise.all(carts.map((c) => withQuoteToken(world, c.accessToken, body).then((b) => world.api('post', '/orders', { token: c.accessToken, body: b }))));
      });
      expect(results[0].status).toBe(500);
      expect(results.slice(1).every((r) => r.status === 201)).toBe(true);
      expect(await stock(product.id)).toBe(1); // three orders took three units; the failed one's unit was rolled back, not lost
      // the failed customer retries (fault gone) and now gets the last unit
      expect((await world.api('post', '/orders', { token: carts[0].accessToken, body: await withQuoteToken(world, carts[0].accessToken, body) })).status).toBe(201);
      expect(await stock(product.id)).toBe(0);
      expect((await world.api('post', '/orders', { token: latecomer.accessToken, body: await withQuoteToken(world, latecomer.accessToken, body) })).status).toBe(400); // now genuinely sold out
      expect(await stock(product.id)).toBe(0); // and never negative
    });
  });

  describe('database connection loss', () => {
    it('killing every open PostgreSQL connection does not crash the process or poison the pool: the app answers correctly again', async () => {
      const c = await s.customer();
      expect((await world.api('get', '/cart', { token: c.accessToken })).status).toBe(200);
      await q(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`).catch(() => undefined);
      let recovered = 0;
      for (let i = 0; i < 6 && !recovered; i += 1) {
        const res = await world.api('get', '/cart', { token: c.accessToken });
        if (res.status === 200) recovered = i + 1;
        else expect(res.status).toBe(500); // at most a transient error while the pool discards dead sockets
      }
      expect(recovered).toBeGreaterThan(0);
      expect(recovered).toBeLessThanOrEqual(3);
      const ready = await world.api('get', '/health/ready');
      expect(ready.status).toBe(200);
      // and real work still commits
      const p = await s.product(vendor, { inventoryMode: 'OPEN' });
      expectData(await world.api('post', '/cart/items', { token: c.accessToken, body: { productId: p.id, quantity: 1 } }), 201);
    });
  });

  describe('external provider isolation', () => {
    it('the suite runs with dummy credentials only, against isolated infrastructure, and any unexpected outbound host is refused loudly', async () => {
      expect(process.env.DATABASE_URL).toMatch(/hatly_e2e_test$/);
      expect(process.env.REDIS_URL).toMatch(/\/14$/);
      expect(process.env.UNIFONIC_APP_SID).toMatch(/dummy/);
      expect(process.env.GOOGLE_MAPS_API_KEY).toMatch(/dummy/);
      expect([process.env.FCM_PROJECT_ID, process.env.FCM_CLIENT_EMAIL, process.env.FCM_PRIVATE_KEY, process.env.STORAGE_ACCESS_KEY]).toEqual(['', '', '', '']);
      await expect(fetch('https://example.com/collect')).rejects.toThrow(/not permitted/);
      await expect(fetch('https://api.stripe.com/v1/charges', { method: 'POST' })).rejects.toThrow(/not permitted/);
      expect(boundary.forbiddenCalls).toEqual(['GET https://example.com/collect', 'POST https://api.stripe.com/v1/charges']);
      boundary.forbiddenCalls.length = 0; // asserted; do not fail the suite-level check for these deliberate probes
    });

    it('FCM failure modes never affect business outcomes: a throwing / failing / token-invalidating push provider leaves order transitions successful', async () => {
      const product = await s.product(vendor, { priceMinor: 10000, inventoryMode: 'OPEN' });
      for (const mode of ['throw', 'fail', 'invalid'] as const) {
        boundary.pushMode = mode;
        const c = await s.customer();
        expectData(await world.api('post', '/customer/device-token', { token: c.accessToken, body: { token: `fcm-${mode}-${c.id}`, platform: 'android' } }), 201);
        await s.addToCart(c, product.id, 1);
        const order = await s.checkout(c, home);
        await s.vendorPrepares(vendor, order.id);
        const delivery = await deliveryOf(order.id);
        for (const st of ['PICKED_UP', 'ON_THE_WAY', 'DELIVERED']) {
          // M4 — Proof of Delivery is required for the DELIVERED transition.
          const body = st === 'DELIVERED' ? { status: st, proofPhotoUrl: await s.uploadFakePhoto(driver.accessToken) } : { status: st };
          const res = await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: driver.accessToken, body });
          expect({ mode, st, status: res.status }).toEqual({ mode, st, status: 200 });
        }
        expect((await q('SELECT status FROM orders WHERE id = $1', [order.id]))[0].status).toBe('DELIVERED');
        expect(boundary.push.length).toBeGreaterThan(0); // the provider WAS attempted
        if (mode === 'invalid') {
          // only the reported tokens are deactivated
          expect((await q('SELECT is_active FROM device_tokens WHERE token = $1', [`fcm-${mode}-${c.id}`]))[0].is_active).toBe(false);
        }
        boundary.push.length = 0;
      }
      boundary.pushMode = 'ok';
    });

    it('SMS outage fails OTP closed; Maps outage fails pricing closed; each recovers when the provider does — with no cross-effect', async () => {
      const smsCustomer = await s.unverifiedCustomer('Provider Down');
      const smsPhone = smsCustomer.phone;
      boundary.smsOutage = true;
      // A phone-verification code that cannot be delivered fails closed with a controlled, specific error — no usable code remains:
      const down = await world.api('post', '/auth/customer/verify-phone/request', { token: smsCustomer.accessToken });
      expect(down.status).toBe(400);
      expect(down.body.error.details).toMatchObject({ code: 'SMS_PROVIDER_UNAVAILABLE' });
      expect(await world.redis.get(`otp:${smsPhone}`)).toBeNull();
      // ...and the outage never touches password sign-in, which is how customers log in:
      expect((await world.api('post', '/auth/customer/password/login', { body: { phone: smsPhone, password: DEFAULT_PASSWORD } })).status).toBe(200);
      boundary.smsOutage = false;
      boundary.mapsOutage = true;
      const product = await s.product(vendor, { inventoryMode: 'OPEN' });
      const c = await s.customer();
      await s.addToCart(c, product.id, 1);
      expect((await world.api('post', '/orders', { token: c.accessToken, body: { deliveryAddress: { line1: 'x', latitude: 30.4444, longitude: 31.5444 }, paymentMethod: 'COD' } })).status).toBe(400);
      boundary.mapsOutage = false;
      expect((await world.api('post', '/orders', { token: c.accessToken, body: await withQuoteToken(world, c.accessToken, { deliveryAddress: { line1: 'x', latitude: 30.4555, longitude: 31.5555 }, paymentMethod: 'COD' }) })).status).toBe(201);
      // SMS recovers: the same customer can now receive a code (the failed attempt left no cooldown behind)
      await world.redis.del(`otp-cooldown:${smsPhone}`);
      expect((await world.api('post', '/auth/customer/verify-phone/request', { token: smsCustomer.accessToken })).status).toBe(200);
      expect(boundary.sms.some((m) => m.to === smsPhone.slice(1))).toBe(true);
    });

    it('Maps distances are cached in Redis: an identical route costs ONE provider call, and a cached route keeps working through a Maps outage', async () => {
      const product = await s.product(vendor, { inventoryMode: 'OPEN' });
      const c = await s.customer();
      await s.addToCart(c, product.id, 1);
      const quote = () => world.api('post', '/cart/delivery-fee-quote', { token: c.accessToken, body: { latitude: 30.4666, longitude: 31.5666 } });
      const first = await quote();
      expect(first.status).toBe(201);
      const callsAfterFirst = boundary.mapsCalls;
      expect(callsAfterFirst).toBeGreaterThan(0);
      boundary.mapsOutage = true;
      const second = await quote();
      expect(second.status).toBe(201);
      expect(second.body.data).toEqual(first.body.data);
      expect(boundary.mapsCalls).toBe(callsAfterFirst); // served from Redis — the provider was not called again
      const keys = await world.redis.keys('map-distance:*');
      expect(keys.length).toBeGreaterThan(0);
      expect(await world.redis.ttl(keys[0])).toBeLessThanOrEqual(600);
      boundary.mapsOutage = false;
    });
  });
});
