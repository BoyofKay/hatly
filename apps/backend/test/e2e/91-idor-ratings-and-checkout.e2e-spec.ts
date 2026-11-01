/**
 * Object-level authorization gaps not covered by 20-authorization: ratings (a customer may only rate THEIR OWN delivered order's
 * vendor segment / item) and checkout (a saved address id of another customer is never usable, in a quote or an order).
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData, withQuoteToken } from './support/actors';

describe('E2E — IDOR: ratings and checkout', () => {
  let world: World;
  let s: Scenario;
  let vendor: VendorFixture;
  let product: { id: string };
  const home = { lat: 30.425, lng: 31.565 };
  const q = (sql: string, params: unknown[] = []) => world.ds.query(sql, params);

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    vendor = await s.vendor({ name: 'IDOR Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    product = await s.product(vendor, { priceMinor: 10000 });
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  async function deliveredOrder(c: Actor) {
    const order = await s.simpleOrder(c, vendor, product.id, home);
    await q("UPDATE orders SET status = 'DELIVERED' WHERE id = $1", [order.id]);
    await q("UPDATE order_vendor_segments SET status = 'DELIVERED' WHERE order_id = $1", [order.id]);
    const [segment] = await q('SELECT id FROM order_vendor_segments WHERE order_id = $1', [order.id]);
    const [item] = await q('SELECT oi.id FROM order_items oi WHERE oi.order_vendor_segment_id = $1', [segment.id]);
    return { order, segmentId: segment.id as string, itemId: item.id as string };
  }
  const ratingCount = async (table: string) => Number((await q(`SELECT count(*)::int AS n FROM ${table}`))[0].n);

  it("a customer cannot rate another customer's vendor segment or item; the owner can (positive control)", async () => {
    const owner = await s.customer('Owner');
    const intruder = await s.customer('Intruder');
    const { segmentId, itemId } = await deliveredOrder(owner);

    const vendorBefore = await ratingCount('vendor_ratings');
    const vendorRefused = await world.api('post', '/ratings/vendor', { token: intruder.accessToken, body: { orderVendorSegmentId: segmentId, stars: 1, comment: 'not mine' } });
    expect(vendorRefused.status).toBeGreaterThanOrEqual(400);
    expect(vendorRefused.status).toBeLessThan(500);
    expect(await ratingCount('vendor_ratings')).toBe(vendorBefore);

    const productBefore = await ratingCount('product_ratings');
    const productRefused = await world.api('post', '/ratings/product', { token: intruder.accessToken, body: { orderItemId: itemId, stars: 1 } });
    expect(productRefused.status).toBeGreaterThanOrEqual(400);
    expect(productRefused.status).toBeLessThan(500);
    expect(await ratingCount('product_ratings')).toBe(productBefore);

    expect([200, 201]).toContain((await world.api('post', '/ratings/vendor', { token: owner.accessToken, body: { orderVendorSegmentId: segmentId, stars: 5 } })).status);
    expect(await ratingCount('vendor_ratings')).toBe(vendorBefore + 1);
  });

  it("another customer's saved address is unusable at checkout: the quote blocks it and the order is refused, nothing is created", async () => {
    const owner = await s.customer('Address Owner');
    const intruder = await s.customer('Address Thief');
    const theirs = await s.address(owner, { lat: home.lat, lng: home.lng });
    await s.addToCart(intruder, product.id, 1);

    const quote = await world.api('post', '/checkout/quote', { token: intruder.accessToken, body: { addressId: theirs.id, paymentMethod: 'COD' } });
    const blocked = quote.status >= 400 || expectData<any>(quote, 201).canPlaceOrder === false;
    expect(blocked).toBe(true);
    if (quote.status < 400) expect(JSON.stringify(expectData<any>(quote, 201).address?.snapshot ?? null)).not.toContain('9 Customer Street');

    const order = await world.api('post', '/orders', { token: intruder.accessToken, body: { addressId: theirs.id, paymentMethod: 'COD' } });
    expect(order.status).toBeGreaterThanOrEqual(400);
    expect(order.status).toBeLessThan(500);
    expect(Number((await q('SELECT count(*)::int AS n FROM orders WHERE customer_id = $1', [intruder.id]))[0].n)).toBe(0);
  });

  it("the wallet and loyalty views only ever show the caller's own ledger (no id parameter exists to forge)", async () => {
    const a = await s.customer('Wallet A');
    const b = await s.customer('Wallet B');
    await q("INSERT INTO wallet_transactions (customer_id, amount_delta_minor, type, idempotency_key, reason) VALUES ($1, 5000, 'ADMIN_CREDIT', $2, 'idor seed')", [a.id, `idor-${a.id}`]);
    const viewA = JSON.stringify((await world.api('get', '/customer/wallet/transactions', { token: a.accessToken })).body);
    const viewB = JSON.stringify((await world.api('get', '/customer/wallet/transactions', { token: b.accessToken })).body);
    expect(viewA).toContain('5000');
    expect(viewB).not.toContain('5000');
    expect((await world.api('get', `/customer/wallet/transactions?customerId=${a.id}`, { token: b.accessToken })).body).not.toEqual((await world.api('get', '/customer/wallet/transactions', { token: a.accessToken })).body);
  });

  it('a retried / double-submitted checkout creates exactly ONE order and one set of side effects (cart lock + status flip)', async () => {
    const c = await s.customer('Double Submit');
    await s.addToCart(c, product.id, 1);
    const body = await withQuoteToken(world, c.accessToken, { paymentMethod: 'COD', deliveryAddress: { line1: 'x', latitude: home.lat, longitude: home.lng } });
    const results = await Promise.all(Array.from({ length: 5 }, () => world.api('post', '/orders', { token: c.accessToken, body })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status >= 500)).toHaveLength(0);
    expect(Number((await q('SELECT count(*)::int AS n FROM orders WHERE customer_id = $1', [c.id]))[0].n)).toBe(1);
    const [{ n }] = await q("SELECT count(*)::int AS n FROM customer_notifications WHERE customer_id = $1 AND type = 'ORDER_PLACED'", [c.id]);
    expect(n).toBe(1);
  });

  it('the wallet cannot be spent twice: two concurrent orders each wanting the whole balance — one wins, the balance never goes negative', async () => {
    const c = await s.customer('Wallet Race');
    const needed = 10000; // the product price; delivery is extra, so wallet covers part and the rest is cash
    await q("INSERT INTO wallet_transactions (customer_id, amount_delta_minor, type, idempotency_key, reason) VALUES ($1, $2, 'ADMIN_CREDIT', $3, 'race seed')", [c.id, needed, `race-${c.id}`]);
    // two separate carts cannot exist at once, so race two orders created back-to-back from the same cart plus a second cart afterwards
    await s.addToCart(c, product.id, 1);
    const body = await withQuoteToken(world, c.accessToken, { paymentMethod: 'COD', useWallet: true, deliveryAddress: { line1: 'x', latitude: home.lat, longitude: home.lng } });
    const racing = await Promise.all([world.api('post', '/orders', { token: c.accessToken, body }), world.api('post', '/orders', { token: c.accessToken, body })]);
    expect(racing.filter((r) => r.status === 201)).toHaveLength(1);
    await s.addToCart(c, product.id, 1);
    await world.api('post', '/orders', { token: c.accessToken, body: await withQuoteToken(world, c.accessToken, { paymentMethod: 'COD', useWallet: true, deliveryAddress: { line1: 'x', latitude: home.lat, longitude: home.lng } }) });
    const [{ balance }] = await q('SELECT COALESCE(SUM(amount_delta_minor), 0)::bigint AS balance FROM wallet_transactions WHERE customer_id = $1', [c.id]);
    expect(Number(balance)).toBeGreaterThanOrEqual(0);
  });
});
