/**
 * ETA / Manual Transfer timing (production-readiness slice). A pending Manual Transfer must never show a normal preparation
 * countdown — it hasn't started (PREPARING is gated until PAID) — and once approved, timing is RE-ANCHORED from the moment
 * of approval, not from whenever the order was created (so a long payment review never silently eats into the ETA).
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData, withQuoteToken } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — ETA behaviour while a Manual Transfer is pending / after approval', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string; lat: number; lng: number };
  let superAdmin: Actor;
  let reviewer: Actor;
  let v1: VendorFixture;
  let p1: { id: string };
  const home = { lat: 30.425, lng: 31.565 };

  const num = (v: unknown) => Number(v);
  const q = (sql: string, params: unknown[] = []) => world.ds.query(sql, params);
  const addr = () => ({ line1: 'ETA Review Street 1', latitude: home.lat, longitude: home.lng });
  const place = async (c: Actor, body: Record<string, unknown>) => world.api('post', '/orders', { token: c.accessToken, body: await withQuoteToken(world, c.accessToken, { deliveryAddress: addr(), ...body }) });
  const details = (c: Actor, id: string) => world.api('get', `/orders/${id}`, { token: c.accessToken });
  const tracking = (c: Actor, id: string) => world.api('get', `/orders/${id}/tracking`, { token: c.accessToken });
  const list = (c: Actor) => world.api('get', '/orders', { token: c.accessToken });
  const segmentRow = async (orderId: string) => (await q('SELECT expected_ready_at, preparation_estimate_minutes FROM order_vendor_segments WHERE order_id = $1', [orderId]))[0];
  const paymentOf = async (orderId: string) => (await q('SELECT * FROM payments WHERE order_id = $1', [orderId]))[0];
  const claim = (c: Actor, orderId: string) => world.api('post', `/payments/manual-transfer/orders/${orderId}/claim`, { token: c.accessToken, body: {} });
  const approve = (paymentId: string) => world.api('post', `/admin/manual-transfer-payments/${paymentId}/approve`, { token: reviewer.accessToken });
  const patchBranch = async (body: Record<string, unknown>) => expectData(await world.api('patch', `/admin/vendor-branches/${v1.branchId}`, { token: superAdmin.accessToken, body }));

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    superAdmin = await s.superAdmin();
    reviewer = await s.admin([Permission.VERIFY_MANUAL_PAYMENTS]);
    v1 = await s.vendor({ name: 'ETA 1', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    p1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'OPEN' });
    await s.setConfig('MANUAL_TRANSFER_DESTINATION', { label: 'Hatly', phoneOrAccountNumber: '01000000000' });
    await s.setConfig('CUSTOMER_SERVICE_WHATSAPP_NUMBER', '+201000000000');
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('a pending Manual Transfer never shows a countdown: list, details and tracking all report UNAVAILABLE / PAYMENT_NOT_APPROVED — even though the branch has a real preparation time', async () => {
    await patchBranch({ preparationTimeMinutes: 20 });
    const c = await s.customer();
    await s.addToCart(c, p1.id, 1);
    const order = expectData<any>(await place(c, { paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY' }), 201);

    // The segment DOES have a real expectedReadyAt stamped at creation — proving the UI-facing UNAVAILABLE is a presentation
    // decision (ETA computation), never a missing/absent value at the data layer.
    const before = await segmentRow(order.id);
    expect(before.preparation_estimate_minutes).toBe(20);
    expect(before.expected_ready_at).not.toBeNull();

    const d = expectData<any>(await details(c, order.id));
    expect(d.eta).toMatchObject({ state: 'UNAVAILABLE', reason: 'PAYMENT_NOT_APPROVED', estimatedAt: null, estimatedUntil: null });
    const t = expectData<any>(await tracking(c, order.id));
    expect(t.eta).toMatchObject({ state: 'UNAVAILABLE', reason: 'PAYMENT_NOT_APPROVED' });
    const l = expectData<any[]>(await list(c));
    expect(l.find((o) => o.id === order.id).eta).toMatchObject({ state: 'UNAVAILABLE', reason: 'PAYMENT_NOT_APPROVED' });

    await patchBranch({ preparationTimeMinutes: null });
  });

  it('claimed / under review: still UNAVAILABLE (payment is not YET approved, whatever the customer has done on their side)', async () => {
    await patchBranch({ preparationTimeMinutes: 20 });
    const c = await s.customer();
    await s.addToCart(c, p1.id, 1);
    const order = expectData<any>(await place(c, { paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY' }), 201);
    await claim(c, order.id);
    expect((await paymentOf(order.id)).status).toBe('UNDER_REVIEW');
    const d = expectData<any>(await details(c, order.id));
    expect(d.eta.state).toBe('UNAVAILABLE');
    expect(d.eta.reason).toBe('PAYMENT_NOT_APPROVED');
    await patchBranch({ preparationTimeMinutes: null });
  });

  it('APPROVED: preparation timing is RE-ANCHORED from the approval moment, not from order creation — the ETA becomes a real ESTIMATE starting from there', async () => {
    await patchBranch({ preparationTimeMinutes: 20 });
    const c = await s.customer();
    await s.addToCart(c, p1.id, 1);
    const order = expectData<any>(await place(c, { paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY' }), 201);
    const beforeApproval = await segmentRow(order.id);
    await claim(c, order.id);
    const payment = await paymentOf(order.id);

    const beforeApprove = Date.now();
    expectData(await approve(payment.id), 201);
    const afterApprove = Date.now();

    const afterApproval = await segmentRow(order.id);
    // The stamp genuinely moved (re-anchored), and it now sits ~20 minutes after the APPROVAL instant, not after creation.
    expect(new Date(afterApproval.expected_ready_at).getTime()).not.toBe(new Date(beforeApproval.expected_ready_at).getTime());
    const readyAt = new Date(afterApproval.expected_ready_at).getTime();
    expect(readyAt).toBeGreaterThanOrEqual(beforeApprove + 20 * 60_000 - 2_000);
    expect(readyAt).toBeLessThanOrEqual(afterApprove + 20 * 60_000 + 2_000);

    const d = expectData<any>(await details(c, order.id));
    expect(d.eta.state).toBe('ESTIMATED');
    expect(d.eta.reason).toBeUndefined();
    expect(new Date(d.eta.estimatedAt).getTime()).toBeGreaterThanOrEqual(beforeApprove);

    await patchBranch({ preparationTimeMinutes: null });
  });

  it('REJECTED: fulfilment stays blocked, so the ETA stays UNAVAILABLE (never re-anchored for a transfer that will not proceed)', async () => {
    await patchBranch({ preparationTimeMinutes: 20 });
    const c = await s.customer();
    await s.addToCart(c, p1.id, 1);
    const order = expectData<any>(await place(c, { paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY' }), 201);
    await claim(c, order.id);
    const payment = await paymentOf(order.id);
    expectData(await world.api('post', `/admin/manual-transfer-payments/${payment.id}/reject`, { token: reviewer.accessToken, body: { reason: 'no funds received' } }), 201);
    const d = expectData<any>(await details(c, order.id));
    expect(d.eta).toMatchObject({ state: 'UNAVAILABLE', reason: 'PAYMENT_NOT_APPROVED' });
    await patchBranch({ preparationTimeMinutes: null });
  });

  it('COD / PAY_AT_DELIVERY / FULL WALLET are never affected — ETA counts down normally from creation', async () => {
    await patchBranch({ preparationTimeMinutes: 20 });
    for (const body of [{ paymentMethod: 'COD' }, { paymentMethod: 'PAY_AT_DELIVERY', electronicPaymentMethod: 'VODAFONE_CASH' }]) {
      const c = await s.customer();
      await s.addToCart(c, p1.id, 1);
      const order = expectData<any>(await place(c, body), 201);
      const d = expectData<any>(await details(c, order.id));
      expect(d.eta.state).toBe('ESTIMATED');
    }
    await patchBranch({ preparationTimeMinutes: null });
  });
});
