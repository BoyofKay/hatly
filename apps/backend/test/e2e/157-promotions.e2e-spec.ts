/**
 * Hatly promotions (owner decision 2026-11-27): Hatly-wide / per-store codes and automatic delivery-fee campaigns.
 * Codes on items with minimum spend and per-customer limit; uses recorded with the order and given back on cancellation; wrong-code
 * guessing paused; a non-stackable code never combines; a delivery campaign lowers the fee the customer pays, and the driver earns on the
 * full fee when Hatly pays the discount, on the reduced fee when the driver bears it.
 */
import { bootWorld, World } from './support/world';
import { Actor, Scenario, VendorFixture, expectData, withQuoteToken } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — Hatly promotions', () => {
  let world: World;
  let s: Scenario;
  let admin: Actor;
  let vendor: VendorFixture;
  let product: { id: string };
  const home = { lat: 30.425, lng: 31.565 };
  const near = { lat: 30.4212, lng: 31.5612 };
  const call = (method: 'get' | 'post' | 'put' | 'patch', token: string, path: string, body?: unknown) => world.api(method, path, { token, body });
  const day = 86_400_000;
  const promo = async (body: Record<string, unknown>) =>
    expectData<any>(await call('post', admin.accessToken, '/admin/promotions', {
      name: 'Promo', kind: 'CODE', target: 'ITEMS', discountType: 'PERCENTAGE', discountValue: 10, scopeType: 'ALL',
      startsAt: new Date(Date.now() - day).toISOString(), endsAt: new Date(Date.now() + day).toISOString(), ...body,
    }), 201);
  const quote = async (c: Actor, couponCode?: string) =>
    expectData<any>(await call('post', c.accessToken, '/checkout/quote', { deliveryAddress: { line1: 'Promo St', latitude: home.lat, longitude: home.lng }, paymentMethod: 'COD', ...(couponCode ? { couponCode } : {}) }), 201);
  const order = async (c: Actor, couponCode?: string) => {
    const body = { deliveryAddress: { line1: 'Promo St', latitude: home.lat, longitude: home.lng }, paymentMethod: 'COD', ...(couponCode ? { couponCode } : {}) };
    return world.api('post', '/orders', { token: c.accessToken, body: await withQuoteToken(world, c.accessToken, body) });
  };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing({ per100mMinor: 1000, minimumMinor: 1500 });
    const area = await s.serviceArea({ radiusMeters: 50000 });
    vendor = await s.vendor({ name: 'Promo Grill', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    product = await s.product(vendor, { priceMinor: 20000, inventoryMode: 'OPEN' });
    admin = await s.admin([Permission.MANAGE_OFFERS], 'Promo Manager');
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('admin rules: permission, unique code, valid values', async () => {
    const outsider = await s.admin([Permission.VIEW_ORDERS], 'No Offers');
    expect((await call('get', outsider.accessToken, '/admin/promotions')).status).toBe(403);
    await promo({ code: 'UNIQUE1' });
    const dup = await call('post', admin.accessToken, '/admin/promotions', { name: 'x', kind: 'CODE', code: 'unique1', target: 'ITEMS', discountType: 'FIXED', discountValue: 100, scopeType: 'ALL', startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + day).toISOString() });
    expect(dup.body.error.details.code).toBe('PROMO_CODE_TAKEN');
    const badFee = await call('post', admin.accessToken, '/admin/promotions', { name: 'x', kind: 'AUTOMATIC', target: 'ITEMS', discountType: 'FIXED_FEE', discountValue: 0, scopeType: 'ALL', startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + day).toISOString() });
    expect(badFee.status).toBe(400);
  });

  it('item code: minimum spend, applied with the order, per-customer limit, cancellation gives it back', async () => {
    const p = await promo({ code: 'TENOFF', minSubtotalMinor: 30000, perCustomerLimit: 1, maxDiscountMinor: 5000 });
    const c = await s.customer('Promo Customer');
    await s.addToCart(c, product.id, 1);
    let q = await quote(c, 'tenoff');
    expect(q.coupon).toMatchObject({ status: 'REJECTED', reasonCode: 'PROMO_MIN_SUBTOTAL' });
    await s.addToCart(c, product.id, 1); // 2 × 200 EGP
    q = await quote(c, 'TENOFF');
    expect(q.coupon).toMatchObject({ status: 'APPLIED', code: 'TENOFF', discountMinor: 4000 });
    expect(q.promotions).toEqual([expect.objectContaining({ code: 'TENOFF', target: 'ITEMS', discountMinor: 4000 })]);
    expect(q.summary.discountMinor).toBe(4000);
    const placed = expectData<any>(await order(c, 'TENOFF'), 201);
    const [row] = await world.ds.query(`SELECT discount_minor, promotion_discount_minor, total_minor, subtotal_minor, delivery_fee_minor FROM orders WHERE id = $1`, [placed.id]);
    expect(Number(row.promotion_discount_minor)).toBe(4000);
    expect(Number(row.total_minor)).toBe(Number(row.subtotal_minor) + Number(row.delivery_fee_minor) - 4000);
    let stats = expectData<any[]>(await call('get', admin.accessToken, '/admin/promotions')).find((x) => x.id === p.id);
    expect(stats).toMatchObject({ usesCount: 1, discountGivenMinor: 4000, state: 'RUNNING' });

    await s.addToCart(c, product.id, 2);
    expect((await quote(c, 'TENOFF')).coupon.reasonCode).toBe('PROMO_CUSTOMER_LIMIT');
    expectData(await call('post', c.accessToken, `/orders/${placed.id}/cancel`, {}), 201);
    stats = expectData<any[]>(await call('get', admin.accessToken, '/admin/promotions')).find((x) => x.id === p.id);
    expect(stats).toMatchObject({ usesCount: 0, discountGivenMinor: 0 });
    expect((await quote(c, 'TENOFF')).coupon.status).toBe('APPLIED'); // usable again
    const used = expectData<any[]>(await call('get', admin.accessToken, `/admin/promotions/${p.id}/redemptions`));
    expect(used[0].reversedAt).toBeTruthy();
  });

  it('wrong codes are paused after 10 tries in an hour; a placed order with a bad code is refused', async () => {
    const c = await s.customer('Guesser');
    await s.addToCart(c, product.id, 1);
    for (let i = 0; i < 10; i++) expect((await quote(c, `NOPE${i}`)).coupon.status).toBe('REJECTED');
    expect((await quote(c, 'NOPE99')).coupon.reasonCode).toBe('PROMO_TOO_MANY_ATTEMPTS');
    expect((await order(c, 'NOPE99')).body.error.details.code).toBe('PROMO_TOO_MANY_ATTEMPTS');
    await world.redis.del(`promo-fail:${c.id}`);
  });

  it('delivery campaign: fee lowered for the customer; HATLY pays → driver earns on the full fee; DRIVER bears → reduced fee', async () => {
    await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', true);
    const campaign = await promo({ kind: 'AUTOMATIC', code: undefined, target: 'DELIVERY_FEE', discountType: 'PERCENTAGE', discountValue: 50, stackable: true, feeBearer: 'HATLY' });
    const run = async (bearer: 'HATLY' | 'DRIVER') => {
      await call('put', admin.accessToken, `/admin/promotions/${campaign.id}`, { ...campaign, code: undefined, feeBearer: bearer, startsAt: campaign.startsAt, endsAt: campaign.endsAt });
      const d = await s.driver({ ...near, fullName: `Fee ${bearer}` });
      await world.ds.query(`UPDATE drivers SET commission_rate_basis_points = 1000 WHERE id = $1`, [d.driverId]);
      const c = await s.customer(`Fee customer ${bearer}`);
      await s.addToCart(c, product.id, 1);
      const q = await quote(c);
      expect(q.deliveryFeeDiscountMinor).toBeGreaterThan(0);
      const placed = expectData<any>(await order(c), 201);
      await s.vendorPrepares(vendor, placed.id);
      const carrier = await s.driverAssignedTo(placed.id);
      const delivery = expectData<any[]>(await call('get', carrier.accessToken, '/driver/deliveries')).find((x) => x.orderId === placed.id);
      expectData(await call('post', carrier.accessToken, `/driver/deliveries/${delivery.id}/acknowledge`), 201);
      for (const status of ['PICKED_UP', 'ON_THE_WAY']) expectData(await call('patch' as never, carrier.accessToken, `/driver/deliveries/${delivery.id}/status`, { status }));
      expectData(await call('patch' as never, carrier.accessToken, `/driver/deliveries/${delivery.id}/status`, { status: 'DELIVERED', proofPhotoUrl: await s.uploadFakePhoto(carrier.accessToken), recipientName: 'C' }));
      const [o] = await world.ds.query(`SELECT delivery_fee_minor, delivery_fee_discount_minor, delivery_fee_discount_bearer FROM orders WHERE id = $1`, [placed.id]);
      const [ev] = await world.ds.query(`SELECT rate_snapshot FROM financial_events WHERE order_id = $1 AND type = 'DRIVER_COMMISSION_RECOGNIZED'`, [placed.id]);
      return { charged: Number(o.delivery_fee_minor), discount: Number(o.delivery_fee_discount_minor), bearer: o.delivery_fee_discount_bearer, basis: Number(ev.rate_snapshot.baseAmountMinor) };
    };
    const h = await run('HATLY');
    expect(h.bearer).toBe('HATLY');
    expect(h.basis).toBe(h.charged + h.discount);
    const dr = await run('DRIVER');
    expect(dr.bearer).toBe('DRIVER');
    expect(dr.basis).toBe(dr.charged);
    await call('patch', admin.accessToken, `/admin/promotions/${campaign.id}/active`, { active: false });
    await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false);
  });
});
