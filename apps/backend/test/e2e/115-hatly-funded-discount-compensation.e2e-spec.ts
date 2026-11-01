/**
 * PD-015 — the compensating HATLY_FUNDED_OFFER_DISCOUNT_RESTORED financial event, over real HTTP against real PostgreSQL:
 * appended (never an edit of the original), linked to the original event and to the segment, exactly once under repeated and
 * concurrent rejection/cancellation, net values consistent with the order's remaining discount, and invisible to settlement.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData, withQuoteToken } from './support/actors';
import { boundary } from './support/external-boundary';
import { Permission } from '../../src/modules/permissions/permission.enum';

const HOUR = 3600_000;
const window = () => ({ startAt: new Date(Date.now() - HOUR).toISOString(), endAt: new Date(Date.now() + 24 * HOUR).toISOString() });
const ORIGINAL = 'HATLY_FUNDED_OFFER_DISCOUNT_RECORDED';
const RESTORED = 'HATLY_FUNDED_OFFER_DISCOUNT_RESTORED';

describe('E2E — Hatly-funded discount compensation (PD-015)', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string };
  let superAdmin: Actor;
  const home = { lat: 30.425, lng: 31.565 };
  const num = (v: unknown) => Number(v);
  let n = 0;

  const newVendor = async () => {
    n += 1;
    const v = await s.vendor({ name: `PD15 ${n}`, serviceAreaId: area.id, lat: 30.42 + n * 0.001, lng: 31.56 + n * 0.001 });
    return { v, product: await s.product(v, { priceMinor: 20000, inventoryMode: 'OPEN' }) };
  };
  const createOffer = async (body: Record<string, unknown>) =>
    expectData<any>(await world.api('post', '/admin/offers', { token: superAdmin.accessToken, body: { ...window(), ...body } }), 201);
  const place = async (c: Actor, body: Record<string, unknown>) =>
    expectData<any>(
      await world.api('post', '/orders', { token: c.accessToken, body: await withQuoteToken(world, c.accessToken, { deliveryAddress: { line1: 'PD15', latitude: home.lat, longitude: home.lng }, ...body }) }),
      201,
    );
  const cartFor = async (products: Array<{ id: string }>) => {
    const c = await s.customer();
    for (const p of products) await s.addToCart(c, p.id, 1);
    return c;
  };
  const reject = (v: VendorFixture, segmentId: string) =>
    world.api('patch', `/vendor/orders/segments/${segmentId}/status`, { token: v.manager.accessToken, body: { status: 'CANCELLED', reason: 'Out of stock' } });
  const segmentOf = async (orderId: string, v: VendorFixture): Promise<string> =>
    (await world.ds.query('SELECT id FROM order_vendor_segments WHERE order_id = $1 AND vendor_branch_id = $2', [orderId, v.branchId]))[0].id;
  const events = (orderId: string) =>
    world.ds.query(
      `SELECT * FROM financial_events WHERE order_id = $1 AND type IN ('${ORIGINAL}', '${RESTORED}') ORDER BY created_at, id`,
      [orderId],
    );
  const orderRow = async (id: string) => (await world.ds.query('SELECT * FROM orders WHERE id = $1', [id]))[0];
  /** recorded − restored, and the invariant: it always equals the discount the order still carries. */
  const net = async (orderId: string) => {
    const rows = await events(orderId);
    const sum = (t: string) => rows.filter((r: any) => r.type === t).reduce((a: number, r: any) => a + num(r.amount_minor), 0);
    return { recorded: sum(ORIGINAL), restored: sum(RESTORED), net: sum(ORIGINAL) - sum(RESTORED) };
  };

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

  it('a rejected coupon part appends ONE compensating event: positive amount, linked to the original and to the segment, original untouched', async () => {
    const a = await newVendor();
    const b = await newVendor();
    await createOffer({ vendorBranchId: b.v.branchId, name: 'Cpn', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'PERCENTAGE', discountValue: 1000, couponCode: 'PD15A' });
    const c = await cartFor([a.product, b.product]);
    const order = await place(c, { paymentMethod: 'COD', couponCode: 'PD15A' });
    const [original] = await events(order.id);
    expect(original).toMatchObject({ type: ORIGINAL, direction: 'INFORMATIONAL' });
    expect(num(original.amount_minor)).toBe(2000);

    const seg = await segmentOf(order.id, b.v);
    expectData(await reject(b.v, seg));

    const rows = await events(order.id);
    expect(rows).toHaveLength(2);
    const restored = rows.find((r: any) => r.type === RESTORED);
    expect(restored).toMatchObject({ direction: 'INFORMATIONAL', order_vendor_segment_id: seg, related_event_id: original.id, vendor_branch_id: null });
    expect(num(restored.amount_minor)).toBe(2000);
    expect(restored.idempotency_key).toMatch(/^hatly-funded-offer-discount-restored:/);
    // the original is byte-for-byte the same row
    const originalAfter = rows.find((r: any) => r.id === original.id);
    expect(originalAfter).toEqual(original);
    expect(await net(order.id)).toEqual({ recorded: 2000, restored: 2000, net: 0 });
    expect(num((await orderRow(order.id)).discount_minor)).toBe(0);
  });

  it('repeated and concurrent rejection of the same part: exactly one compensating event', async () => {
    const a = await newVendor();
    const b = await newVendor();
    await createOffer({ vendorBranchId: b.v.branchId, name: 'Fx', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 1500 });
    const c = await cartFor([a.product, b.product]);
    const order = await place(c, { paymentMethod: 'COD' });
    const seg = await segmentOf(order.id, b.v);
    const results = await Promise.all([reject(b.v, seg), reject(b.v, seg), reject(b.v, seg)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await reject(b.v, seg)).status).toBe(400);
    expect((await events(order.id)).filter((r: any) => r.type === RESTORED)).toHaveLength(1);
    expect(await net(order.id)).toEqual({ recorded: 1500, restored: 1500, net: 0 });
  });

  it('partial then final rejection: restored amounts add up to exactly what was recorded, and the net always equals the discount the order still carries', async () => {
    const m = [await newVendor(), await newVendor(), await newVendor()];
    const amounts = [500, 700, 900];
    for (let i = 0; i < 3; i++) {
      await createOffer({ vendorBranchId: m[i].v.branchId, name: `A${i}`, mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: amounts[i] });
    }
    const c = await cartFor(m.map((x) => x.product));
    const order = await place(c, { paymentMethod: 'COD' });
    expect((await net(order.id)).net).toBe(2100);

    expectData(await reject(m[0].v, await segmentOf(order.id, m[0].v)));
    expect(await net(order.id)).toEqual({ recorded: 2100, restored: 500, net: 1600 });
    expect(num((await orderRow(order.id)).discount_minor)).toBe(1600);

    expectData(await reject(m[2].v, await segmentOf(order.id, m[2].v)));
    expect((await net(order.id)).net).toBe(700);
    expect(num((await orderRow(order.id)).discount_minor)).toBe(700);

    expectData(await reject(m[1].v, await segmentOf(order.id, m[1].v))); // the last part → whole order cancelled
    expect((await orderRow(order.id)).status).toBe('CANCELLED');
    expect(await net(order.id)).toEqual({ recorded: 2100, restored: 2100, net: 0 });
    const restored = (await events(order.id)).filter((r: any) => r.type === RESTORED);
    expect(restored).toHaveLength(3);
    expect(new Set(restored.map((r: any) => r.order_vendor_segment_id)).size).toBe(3); // one per segment
  });

  it('flash sale + coupon: both are compensated, each against its own segment/amount', async () => {
    const f = await newVendor();
    const pPlain = await s.product(f.v, { priceMinor: 10000, inventoryMode: 'OPEN' });
    await createOffer({ vendorBranchId: f.v.branchId, name: 'Flash', mechanism: 'FLASH_SALE', specialPriceMinor: 15000, productIds: [f.product.id] });
    await createOffer({ vendorBranchId: f.v.branchId, name: 'Cpn', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'PERCENTAGE', discountValue: 1000, couponCode: 'PD15FC', productIds: [pPlain.id] });
    const g = await newVendor();
    const c = await cartFor([f.product, pPlain, g.product]);
    const order = await place(c, { paymentMethod: 'COD', couponCode: 'PD15FC' });
    expect((await net(order.id)).recorded).toBe(5000 + 1000);

    expectData(await reject(f.v, await segmentOf(order.id, f.v)));
    const restored = (await events(order.id)).filter((r: any) => r.type === RESTORED);
    expect(restored.map((r: any) => num(r.amount_minor)).sort((x: number, y: number) => x - y)).toEqual([1000, 5000]);
    expect(new Set(restored.map((r: any) => r.order_vendor_segment_id))).toEqual(new Set([await segmentOf(order.id, f.v)]));
    expect(await net(order.id)).toEqual({ recorded: 6000, restored: 6000, net: 0 });
    expect(num((await orderRow(order.id)).discount_minor)).toBe(0);
  });

  it('whole-order cancellation (customer, then a duplicate; and an admin on another order): compensated once each', async () => {
    const a = await newVendor();
    await createOffer({ vendorBranchId: a.v.branchId, name: 'Whole', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 800 });
    const c1 = await cartFor([a.product]);
    const o1 = await place(c1, { paymentMethod: 'COD' });
    const c2 = await cartFor([a.product]);
    const o2 = await place(c2, { paymentMethod: 'COD' });

    expectData(await world.api('post', `/orders/${o1.id}/cancel`, { token: c1.accessToken, body: {} }), 201);
    expect((await world.api('post', `/orders/${o1.id}/cancel`, { token: c1.accessToken, body: {} })).status).toBe(400);
    expect(await net(o1.id)).toEqual({ recorded: 800, restored: 800, net: 0 });
    expect((await events(o1.id)).filter((r: any) => r.type === RESTORED)).toHaveLength(1);

    expectData(await world.api('patch', `/orders/${o2.id}/status`, { token: superAdmin.accessToken, body: { status: 'CANCELLED', cancellationReason: 'support' } }));
    expect(await net(o2.id)).toEqual({ recorded: 800, restored: 800, net: 0 });
  });

  it('a rejected part WITHOUT a discount appends nothing, and an order without any discount has no events at all', async () => {
    const a = await newVendor();
    const b = await newVendor();
    await createOffer({ vendorBranchId: a.v.branchId, name: 'OnlyA', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 600 });
    const c = await cartFor([a.product, b.product]);
    const order = await place(c, { paymentMethod: 'COD' });
    expectData(await reject(b.v, await segmentOf(order.id, b.v)));
    expect((await events(order.id)).filter((r: any) => r.type === RESTORED)).toHaveLength(0);
    expect((await net(order.id)).net).toBe(600);

    const plain = await newVendor();
    const c2 = await cartFor([plain.product]);
    const o2 = await place(c2, { paymentMethod: 'COD' });
    expectData(await world.api('post', `/orders/${o2.id}/cancel`, { token: c2.accessToken, body: {} }), 201);
    expect(await events(o2.id)).toEqual([]);
  });

  it('the admin order detail reports recorded / restored / net, and lists the compensating event with the others', async () => {
    const a = await newVendor();
    const b = await newVendor();
    await createOffer({ vendorBranchId: b.v.branchId, name: 'Rep', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 1100 });
    const c = await cartFor([a.product, b.product]);
    const order = await place(c, { paymentMethod: 'COD' });
    expectData(await reject(b.v, await segmentOf(order.id, b.v)));
    const detail = expectData<any>(await world.api('get', `/admin/orders/${order.id}`, { token: superAdmin.accessToken }));
    expect(detail.hatlyFundedDiscount).toEqual({ recordedMinor: 1100, restoredMinor: 1100, netMinor: 0 });
    expect(detail.financialEvents.map((e: any) => e.type)).toEqual(expect.arrayContaining([ORIGINAL, RESTORED]));
  });

  it('settlement ignores both events: a vendor whose only activity is a rejected discounted order has nothing to settle', async () => {
    const a = await newVendor();
    await createOffer({ vendorBranchId: a.v.branchId, name: 'Set', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 700 });
    const c = await cartFor([a.product]);
    const order = await place(c, { paymentMethod: 'COD' });
    expectData(await reject(a.v, await segmentOf(order.id, a.v)));
    expect((await net(order.id)).restored).toBe(700);
    // no vendor_branch_id on the events → they are not "vendor activity", and no commission was ever recognised
    expect(await world.ds.query('SELECT id FROM financial_events WHERE vendor_branch_id = $1', [a.v.branchId])).toEqual([]);
    const res = await world.api('post', `/admin/settlement/vendor-branches/${a.v.branchId}/close`, { token: superAdmin.accessToken, body: {} });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('No new activity');
  });

  it('a permission-less admin cannot see settlement either (control: the endpoint is the real one)', async () => {
    const nobody = await s.admin([Permission.VIEW_ORDERS], 'PD15 Viewer');
    const a = await newVendor();
    expect((await world.api('post', `/admin/settlement/vendor-branches/${a.v.branchId}/close`, { token: nobody.accessToken, body: {} })).status).toBe(403);
  });
});
