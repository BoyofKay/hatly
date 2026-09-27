/**
 * Group 8 / phase 7 — inventory under concurrent HTTP checkouts. Real sockets, real PostgreSQL
 * row updates (`UPDATE ... WHERE quantity >= :amount`), real transactions: overselling must be
 * impossible, a failed checkout must leave NO partial writes, and a cancellation restores stock once.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';

describe('E2E — inventory concurrency', () => {
  let world: World;
  let s: Scenario;
  let vendor: VendorFixture;
  const home = { lat: 30.425, lng: 31.565 };

  const stockOf = async (productId: string) => (await world.ds.query('SELECT quantity FROM products WHERE id = $1', [productId]))[0].quantity as number;
  const orderCount = async () => Number((await world.ds.query('SELECT count(*)::int AS n FROM orders'))[0].n);
  const checkoutBody = { deliveryAddress: { line1: 'Race Street', latitude: home.lat, longitude: home.lng }, paymentMethod: 'COD' };
  // A delivery order now requires a confirmed quote token (production-readiness slice) — the SAME quote/order round trip the
  // real app makes; a race is still exactly a race, since every racer reads the (not-yet-decremented) stock at quote time.
  const place = async (c: Actor) => {
    const quote = await world.api('post', '/checkout/quote', { token: c.accessToken, body: checkoutBody });
    const quoteToken = quote.status === 201 ? quote.body.data.quoteToken : undefined;
    return world.api('post', '/orders', { token: c.accessToken, body: { ...checkoutBody, quoteToken } });
  };
  const customersWithCart = async (n: number, productId: string, quantity: number, extra: Record<string, unknown> = {}) => {
    const out: Actor[] = [];
    for (let i = 0; i < n; i += 1) {
      const c = await s.customer(`Racer ${i}`);
      await s.addToCart(c, productId, quantity, extra);
      out.push(c);
    }
    return out;
  };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    vendor = await s.vendor({ name: 'Race Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('8 customers race for 5 units: exactly 5 orders succeed, 3 get INSUFFICIENT_INVENTORY, stock ends at exactly 0', async () => {
    const product = await s.product(vendor, { name: 'Last Five', priceMinor: 1000, inventoryMode: 'TRACKED', quantity: 5 });
    const racers = await customersWithCart(8, product.id, 1);
    const before = await orderCount();

    const results = await Promise.all(racers.map(place));

    const ok = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status !== 201);
    expect(ok).toHaveLength(5);
    expect(rejected).toHaveLength(3);
    for (const r of rejected) {
      expect(r.status).toBe(400);
      expect(r.body.error.details).toMatchObject({ code: 'INSUFFICIENT_INVENTORY', productId: product.id });
    }
    expect(await stockOf(product.id)).toBe(0);
    expect((await orderCount()) - before).toBe(5);
    // no partial write for the losers: their carts are still ACTIVE with their item, and they own no order
    const loserIds = racers.filter((_, i) => results[i].status !== 201).map((c) => c.id);
    for (const id of loserIds) {
      expect(await world.ds.query('SELECT id FROM orders WHERE customer_id = $1', [id])).toEqual([]);
      const carts = await world.ds.query("SELECT status FROM carts WHERE customer_id = $1 AND status = 'ACTIVE'", [id]);
      expect(carts).toHaveLength(1);
    }
    // stock ledger consistency: units sold == units removed
    const sold = await world.ds.query(
      `SELECT COALESCE(SUM(i.quantity), 0)::int AS units FROM order_items i WHERE i.product_id = $1`,
      [product.id],
    );
    expect(sold[0].units).toBe(5);
  });

  it('multi-unit contention: 4 customers each want 3 of 10 → 3 succeed (9 units), 1 fails, 1 unit left', async () => {
    const product = await s.product(vendor, { name: 'Ten Units', priceMinor: 1000, inventoryMode: 'TRACKED', quantity: 10 });
    const racers = await customersWithCart(4, product.id, 3);
    const results = await Promise.all(racers.map(place));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 400)).toHaveLength(1);
    expect(await stockOf(product.id)).toBe(1);
  });

  it('the same customer double-submitting one cart concurrently (5 parallel POST /orders) creates exactly ONE order and decrements once', async () => {
    const product = await s.product(vendor, { name: 'Double Tap', priceMinor: 2500, inventoryMode: 'TRACKED', quantity: 10 });
    const [customer] = await customersWithCart(1, product.id, 2);
    const results = await Promise.all(Array.from({ length: 5 }, () => place(customer)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 201).every((r) => [400, 404, 409].includes(r.status))).toBe(true);
    expect(await world.ds.query('SELECT id FROM orders WHERE customer_id = $1', [customer.id])).toHaveLength(1);
    expect(await stockOf(product.id)).toBe(8);
  });

  it('weight-tracked stock is counted in grams: 5000 g, two carts of 3000 g → one wins', async () => {
    const cheese = await s.product(vendor, { name: 'Cheese Block', priceMinor: 30000, pricingUnit: 'WEIGHT', inventoryMode: 'TRACKED', quantity: 5000 });
    const racers = await customersWithCart(2, cheese.id, 1, { requestedWeightGrams: 3000 });
    const results = await Promise.all(racers.map(place));
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await stockOf(cheese.id)).toBe(2000);
  });

  it('OPEN inventory never blocks or decrements, however many buy', async () => {
    const product = await s.product(vendor, { name: 'Open Stock', priceMinor: 1000, inventoryMode: 'OPEN' });
    const racers = await customersWithCart(6, product.id, 5);
    const results = await Promise.all(racers.map(place));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect((await world.ds.query('SELECT quantity FROM products WHERE id = $1', [product.id]))[0].quantity).toBeNull();
  });

  it('a failed checkout rolls EVERYTHING back: an in-stock line is not decremented when another line in the cart is sold out', async () => {
    const plenty = await s.product(vendor, { name: 'Plenty', priceMinor: 1000, inventoryMode: 'TRACKED', quantity: 5 });
    const scarce = await s.product(vendor, { name: 'Scarce', priceMinor: 1000, inventoryMode: 'TRACKED', quantity: 1 });
    const c = await s.customer('Atomic');
    await s.addToCart(c, plenty.id, 2);
    await s.addToCart(c, scarce.id, 1);
    expectData(await world.api('patch', `/vendor/products/${scarce.id}`, { token: vendor.manager.accessToken, body: { quantity: 0 } }));
    const res = await place(c);
    expect(res.status).toBe(400);
    expect(res.body.error.details).toMatchObject({ code: 'INSUFFICIENT_INVENTORY', productId: scarce.id });
    expect(await stockOf(plenty.id)).toBe(5); // untouched: the transaction rolled back
    expect(await world.ds.query('SELECT id FROM orders WHERE customer_id = $1', [c.id])).toEqual([]);
  });

  it('cancellation restores exactly the units the order took — once, even if cancelled from two places at the same time', async () => {
    const product = await s.product(vendor, { name: 'Restorable', priceMinor: 1000, inventoryMode: 'TRACKED', quantity: 10 });
    const c = await s.customer();
    await s.addToCart(c, product.id, 4);
    const order = await s.checkout(c, home);
    expect(await stockOf(product.id)).toBe(6);
    const superAdmin = await s.superAdmin();
    const cancels = await Promise.all([
      world.api('patch', `/orders/${order.id}/status`, { token: superAdmin.accessToken, body: { status: 'CANCELLED', cancellationReason: 'dup 1' } }),
      world.api('patch', `/orders/${order.id}/status`, { token: vendor.manager.accessToken, body: { status: 'CANCELLED', cancellationReason: 'dup 2' } }),
      world.api('patch', `/orders/${order.id}/status`, { token: superAdmin.accessToken, body: { status: 'CANCELLED', cancellationReason: 'dup 3' } }),
    ]);
    expect(cancels.filter((r) => r.status === 200)).toHaveLength(1);
    expect(cancels.filter((r) => r.status === 400)).toHaveLength(2);
    expect(await stockOf(product.id)).toBe(10); // 6 + 4, not 14 or 18
  });

  it('50 parallel requests of mixed kinds never produce a 5xx', async () => {
    const product = await s.product(vendor, { name: 'Mixed Load', priceMinor: 1000, inventoryMode: 'TRACKED', quantity: 20 });
    const racers = await customersWithCart(10, product.id, 1);
    const calls: Array<Promise<{ status: number }>> = [];
    for (const c of racers) {
      calls.push(place(c));
      calls.push(world.api('get', '/cart', { token: c.accessToken }));
      calls.push(world.api('get', '/orders', { token: c.accessToken }));
      calls.push(world.api('get', `/vendor-branches/${vendor.branchId}/products`));
      calls.push(world.api('get', '/search', { query: { q: 'Mixed' } }));
    }
    const results = await Promise.all(calls);
    expect(results.filter((r) => r.status >= 500)).toEqual([]);
  });
});
