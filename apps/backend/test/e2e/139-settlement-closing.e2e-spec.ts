/**
 * Courier shift closing and vendor period closing over real HTTP / PostgreSQL (2026-11-13):
 *  - a real multi-store COD order, delivered through the real driver flow, closes to "the courier owes only Hatly's commission";
 *  - preview writes nothing; the close settles exactly the preview (token), once; a second close is refused; payments are partial;
 *  - each store's part is settled under its own store by handover time; the S26/S27 report totals equal the closing totals;
 *  - permissions are the existing ones, nobody else gets in, and bad input is refused.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — courier shift closing & vendor period closing', () => {
  let world: World;
  let s: Scenario;
  let v1: VendorFixture;
  let v2: VendorFixture;
  let p1: { id: string; priceMinor: number };
  let p2: { id: string; priceMinor: number };
  let admin: Actor;
  const home = { lat: 30.425, lng: 31.565 };
  const api = (method: 'get' | 'post', a: Actor | undefined, path: string, body?: unknown, query?: Record<string, string>, headers?: Record<string, string>) =>
    world.api(method, path, { token: a?.accessToken, body, query, headers } as any);
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    await s.setConfig('VENDOR_SETTLEMENT_FREQUENCY', 'WEEKLY');
    const area = await s.serviceArea({ radiusMeters: 50000 });
    v1 = await s.vendor({ name: 'Closing One', serviceAreaId: area.id, lat: 30.421, lng: 31.561, commissionBasisPoints: 1000 });
    v2 = await s.vendor({ name: 'Closing Two', serviceAreaId: area.id, lat: 30.431, lng: 31.571, commissionBasisPoints: 500 });
    p1 = await s.product(v1, { priceMinor: 12000, inventoryMode: 'OPEN' });
    p2 = await s.product(v2, { priceMinor: 8000, inventoryMode: 'OPEN' });
    admin = await s.superAdmin();
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  /** A real two-store COD order delivered by a real courier (dispatch chooses the courier; it gets a 10% rate). */
  async function deliveredTwoStoreOrder() {
    const c = await s.customer();
    await s.driver({ lat: 30.42, lng: 31.56 });
    await s.addToCart(c, p1.id, 1);
    await s.addToCart(c, p2.id, 1);
    const order = await s.checkout(c, home, 'COD');
    await s.vendorPrepares(v1, order.id);
    await s.vendorPrepares(v2, order.id);
    const d = await s.driverAssignedTo(order.id);
    expectData(await api('get', admin, `/admin/settlement/drivers/${d.driverId}/close-preview`)); // a courier with nothing delivered previews fine
    await world.ds.query(`UPDATE drivers SET commission_rate_basis_points = 1000 WHERE id = $1`, [d.driverId]);
    const delivery = expectData<any[]>(await api('get', d, '/driver/deliveries')).find((x) => x.orderId === order.id);
    const step = (status: string, extra: Record<string, unknown> = {}) => world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: d.accessToken, body: { status, ...extra } });
    expectData(await step('PICKED_UP'));
    expectData(await step('ON_THE_WAY'));
    expectData(await step('DELIVERED', { proofPhotoUrl: await s.uploadFakePhoto(d.accessToken), recipientName: 'Mona' }));
    const [o] = await world.ds.query(`SELECT total_minor, amount_due_minor, delivery_fee_minor FROM orders WHERE id = $1`, [order.id]);
    return { c, order, d, o };
  }

  let closedCourier: any;
  let courierId: string;

  it('COD, two stores: preview shows each part of the money separately; the courier owes Hatly only the commission; preview writes nothing', async () => {
    const { order, d, o } = await deliveredTwoStoreOrder();
    courierId = d.driverId!;
    const [ev] = await world.ds.query(`SELECT amount_minor, rate_snapshot FROM financial_events WHERE order_id = $1 AND type = 'DRIVER_COMMISSION_RECOGNIZED'`, [order.id]);
    const before = Number((await world.ds.query(`SELECT count(*)::int AS n FROM driver_settlement_periods`))[0].n);
    const preview = expectData<any>(await api('get', admin, `/admin/settlement/drivers/${courierId}/close-preview`));
    expect(Number((await world.ds.query(`SELECT count(*)::int AS n FROM driver_settlement_periods`))[0].n)).toBe(before);
    const line = preview.lines.find((l: any) => l.orderId === order.id);
    expect(line).toMatchObject({
      paymentMethod: 'COD',
      feeEntitlementMinor: Number(ev.rate_snapshot.baseAmountMinor),
      commissionMinor: Number(ev.amount_minor),
      paymentFlow: 'COD',
      goodsPaidToStoresMinor: 12000 + 8000,
      goodsPassThroughMinor: 12000 + 8000, // collected from the customer and paid to the stores — excluded from the net
      goodsReimbursementMinor: 0,
      cashCollectedMinor: Number(o.amount_due_minor),
      cashHeldMinor: Number(o.amount_due_minor) - 20000, // the delivery fee the courier keeps
      netToCourierMinor: -Number(ev.amount_minor), // rule A: cash at the door covers goods + fee; only Hatly's % is owed
    });
    expect(Number(o.total_minor)).toBe(20000 + Number(ev.rate_snapshot.baseAmountMinor)); // the order total is goods + the courier's compensation (R28)
    expect(preview.totals.netToCourierMinor).toBe(preview.lines.reduce((t: number, l: any) => t + l.netToCourierMinor, 0));
    expect(preview.previewToken).toMatch(/^[0-9a-f]{32}$/);

    const res = await api('post', admin, `/admin/settlement/drivers/${courierId}/close`, { previewToken: preview.previewToken });
    expect(res.status).toBe(201);
    closedCourier = res.body.data;
    expect(closedCourier).toMatchObject({ status: 'CLOSED', frequency: 'DAILY', methodVersion: 2, netPayableMinor: preview.totals.netToCourierMinor });
    expect(closedCourier.reference).toMatch(/^CS-\d{8}-[0-9A-F]{6}$/);
    // the order itself and its financial events are untouched by a closing
    expect((await world.ds.query(`SELECT status FROM orders WHERE id = $1`, [order.id]))[0].status).toBe('DELIVERED');
  });

  it('double close is refused (stale token → 409, no token → 400 nothing to close); history and search find the closing', async () => {
    const again = await api('post', admin, `/admin/settlement/drivers/${courierId}/close`, { previewToken: 'f'.repeat(32) });
    expect(again.status).toBe(409);
    expect(again.body.error?.details?.code ?? JSON.stringify(again.body)).toContain('PREVIEW_CHANGED');
    const none = await api('post', admin, `/admin/settlement/drivers/${courierId}/close`, {});
    expect(none.status).toBe(400);
    const found = await api('get', admin, '/admin/settlements/driver-periods', undefined, { search: closedCourier.reference });
    expect(found.body.data.map((p: any) => p.id)).toEqual([closedCourier.id]);
    expect(found.body.data[0]).toMatchObject({ reference: closedCourier.reference, methodVersion: 2, direction: 'COLLECTION', dueMinor: Math.abs(closedCourier.netPayableMinor) });
    const statement = expectData<any>(await api('get', admin, `/admin/settlements/driver-periods/${closedCourier.id}`));
    expect(statement.exceptions).toEqual([]);
    expect(statement.lines.reduce((t: number, l: any) => t + l.netToCourierMinor, 0)).toBe(closedCourier.netPayableMinor);
  });

  it('partial settlement of the courier closing, then the range statement shows settled and what remains; S26 totals equal the closing', async () => {
    const due = Math.abs(closedCourier.netPayableMinor);
    const part = Math.max(1, Math.floor(due / 2));
    const pay = await api('post', admin, `/admin/settlements/driver/periods/${closedCourier.id}/payments`, { amountMinor: part, method: 'CASH', paidOn: today() }, undefined, { 'idempotency-key': `e2e-139-${closedCourier.id}` });
    expect(pay.status).toBe(201);
    const st = expectData<any>(await api('get', admin, `/admin/settlement/drivers/${courierId}/statement`, undefined, { from: today(), to: today() }));
    expect(st.periods.find((p: any) => p.id === closedCourier.id)).toMatchObject({ settledMinor: part, remainingMinor: due - part, paymentStatus: due - part > 0 ? 'PARTIAL' : 'PAID' });
    const report = expectData<any>(await api('post', admin, '/admin/reports/S26/run', { params: { from: today(), to: today(), driverId: courierId }, limit: 100 }), 201);
    expect(report.totals.netMinor).toBe(st.totals.netToCourierMinor);
    expect(report.totals.commissionMinor).toBe(st.totals.commissionMinor);
  });

  it('vendor closing: each store gets its own part (by handover), commission owed BY the store, nothing collected for it; S27 = closing', async () => {
    for (const [v, rate] of [[v1, 1000], [v2, 500]] as const) {
      const preview = expectData<any>(await api('get', admin, `/admin/settlement/vendor-branches/${v.branchId}/close-preview`));
      expect(preview.lines.length).toBeGreaterThanOrEqual(1);
      for (const l of preview.lines) expect(l.commissionMinor).toBe(Math.round((l.segmentSubtotalMinor * rate) / 10000));
      expect(preview.totals.collectedByHatlyForVendorMinor).toBe(0);
      const closed = expectData<any>(await api('post', admin, `/admin/settlement/vendor-branches/${v.branchId}/close`, { previewToken: preview.previewToken }), 201);
      expect(closed).toMatchObject({ grossSalesMinor: preview.totals.grossSalesMinor, totalCommissionOwedMinor: preview.totals.commissionOwedByVendorMinor, frequency: 'WEEKLY' });
      const report = expectData<any>(await api('post', admin, '/admin/reports/S27/run', { params: { from: today(), to: today(), vendorBranchId: v.branchId }, limit: 100 }), 201);
      expect([report.totals.salesMinor, report.totals.commissionMinor]).toEqual([closed.grossSalesMinor, closed.totalCommissionOwedMinor]);
      expect((await api('post', admin, `/admin/settlement/vendor-branches/${v.branchId}/close`, {})).status).toBe(400);
      const st = expectData<any>(await api('get', admin, `/admin/settlement/vendor-branches/${v.branchId}/statement`, undefined, { from: today(), to: today() }));
      expect(st.totals).toMatchObject({ grossSalesMinor: closed.grossSalesMinor, commissionOwedByVendorMinor: closed.totalCommissionOwedMinor, collectedByHatlyForVendorMinor: 0 });
    }
  });

  it('the open lists show who has something to close', async () => {
    const couriers = expectData<any[]>(await api('get', admin, '/admin/settlement/couriers/open'));
    expect(couriers.find((c) => c.id === courierId)).toMatchObject({ deliveredOpen: 0 });
    const branches = expectData<any[]>(await api('get', admin, '/admin/settlement/vendor-branches/open'));
    expect(branches.find((b) => b.id === v1.branchId)).toMatchObject({ partsOpen: 0 });
  });

  it('stage 3 "Drivers today": the open figure equals the preview; close + cash at the desk are two records (closing, then a CASH payment on it); a partial payment leaves the rest unpaid', async () => {
    const { d, order } = await deliveredTwoStoreOrder();
    const row = async () => expectData<any[]>(await api('get', admin, '/admin/settlement/couriers/today')).find((r) => r.id === d.driverId);
    const preview = expectData<any>(await api('get', admin, `/admin/settlement/drivers/${d.driverId}/close-preview`));
    const before = await row();
    expect(before.deliveredToday).toBeGreaterThanOrEqual(1); // dispatch may reuse a courier from an earlier test
    expect(before).toMatchObject({ relevant: true, open: expect.objectContaining({ orders: preview.totals.orders, netToCourierMinor: preview.totals.netToCourierMinor }) });
    expect(preview.totals.netToCourierMinor).toBeLessThan(0); // COD: the courier owes only the commission
    expect(preview.lines.map((l: any) => l.orderId)).toContain(order.id);

    const closed = expectData<any>(await api('post', admin, `/admin/settlement/drivers/${d.driverId}/close`, { previewToken: preview.previewToken }), 201);
    const due = Math.abs(closed.netPayableMinor);
    const part = due > 1 ? Math.floor(due / 2) : due;
    const pay = expectData<any>(await api('post', admin, `/admin/settlements/driver/periods/${closed.id}/payments`, { amountMinor: part, method: 'CASH', reference: closed.reference, paidOn: today() }, undefined, { 'Idempotency-Key': `dt-${closed.id}` }), 201);
    expect(pay.payment).toMatchObject({ direction: 'COLLECTION', amountMinor: part, method: 'CASH', reference: closed.reference });
    // the same key again (a retry from the panel) never records twice
    expect(expectData<any>(await api('post', admin, `/admin/settlements/driver/periods/${closed.id}/payments`, { amountMinor: part, method: 'CASH', reference: closed.reference, paidOn: today() }, undefined, { 'Idempotency-Key': `dt-${closed.id}` }), 201).replayed).toBe(true);

    const after = await row();
    expect(after.open.orders).toBe(0);
    expect(after.lastClosing.reference).toBe(closed.reference);
    const unpaid = after.unpaidClosings.find((u: any) => u.periodId === closed.id);
    if (part < due) expect(unpaid).toMatchObject({ direction: 'COLLECTION', remainingMinor: due - part, reference: closed.reference });
    else expect(unpaid).toBeUndefined();

    const viewer = await s.admin([Permission.VIEW_DRIVER_SETTLEMENTS], 'Today viewer');
    expect((await api('get', viewer, '/admin/settlement/couriers/today')).status).toBe(403);
    const closer = await s.admin([Permission.CLOSE_DRIVER_SETTLEMENTS], 'Today closer');
    expect((await api('get', closer, '/admin/settlement/couriers/today')).status).toBe(200);
    // a closer without the payments permission cannot record the cash (the panel hides the option for them)
    expect((await api('post', closer, `/admin/settlements/driver/periods/${closed.id}/payments`, { amountMinor: 1, method: 'CASH', paidOn: today() }, undefined, { 'Idempotency-Key': `dt2-${closed.id}` })).status).toBe(403);
  });

  it('permissions: the existing ones exactly — view-only cannot close, close-only cannot read statements; other roles are refused', async () => {
    const viewer = await s.admin([Permission.VIEW_DRIVER_SETTLEMENTS, Permission.VIEW_VENDOR_FINANCIAL_REPORTS], 'Settlement Viewer');
    const closer = await s.admin([Permission.CLOSE_DRIVER_SETTLEMENTS, Permission.CLOSE_VENDOR_SETTLEMENTS], 'Settlement Closer');
    expect((await api('get', viewer, `/admin/settlement/drivers/${courierId}/close-preview`)).status).toBe(403);
    expect((await api('post', viewer, `/admin/settlement/drivers/${courierId}/close`, {})).status).toBe(403);
    expect((await api('get', viewer, `/admin/settlement/drivers/${courierId}/statement`)).status).toBe(200);
    expect((await api('get', closer, `/admin/settlement/drivers/${courierId}/close-preview`)).status).toBe(200);
    expect((await api('get', closer, `/admin/settlement/drivers/${courierId}/statement`)).status).toBe(403);
    expect((await api('get', closer, `/admin/settlement/vendor-branches/${v1.branchId}/statement`)).status).toBe(403);
    for (const who of [await s.customer(), v1.manager]) {
      expect((await api('get', who, `/admin/settlement/drivers/${courierId}/close-preview`)).status).toBe(403);
      expect((await api('get', who, '/admin/settlement/couriers/open')).status).toBe(403);
    }
    expect((await api('get', undefined, `/admin/settlement/drivers/${courierId}/close-preview`)).status).toBe(401);
  });

  it('bad input is refused: unknown fields, a malformed date, an unknown or malformed id', async () => {
    expect((await api('post', admin, `/admin/settlement/drivers/${courierId}/close`, { amountMinor: 5 })).status).toBe(400);
    expect((await api('get', admin, `/admin/settlement/vendor-branches/${v1.branchId}/close-preview`, undefined, { periodEnd: 'yesterday' })).status).toBe(400);
    expect((await api('get', admin, `/admin/settlement/drivers/${courierId}/statement`, undefined, { from: '13/11/2026' })).status).toBe(400);
    expect((await api('get', admin, '/admin/settlement/drivers/not-a-uuid/close-preview')).status).toBe(400);
    expect((await api('get', admin, '/admin/settlement/drivers/00000000-0000-4000-8000-000000000000/close-preview')).status).toBe(404);
    // a future period end is never accepted as-is: it is capped at now
    const p = expectData<any>(await api('get', admin, `/admin/settlement/vendor-branches/${v1.branchId}/close-preview`, undefined, { periodEnd: '2999-01-01' }));
    expect(new Date(p.periodEnd).getTime()).toBeLessThanOrEqual(Date.now());
  });
});
