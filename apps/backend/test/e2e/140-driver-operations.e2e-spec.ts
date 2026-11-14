/**
 * Driver operations (2026-11-13) over real HTTP / PostgreSQL:
 *  - delivery without a photo (owner decision), with a photo, after a failed upload; unchanged guards (ownership, state);
 *  - the active list (`scope=active`) never contains delivered / cancelled orders; several orders of one driver stay independent;
 *  - history = the driver's real delivered orders, with their money state (also for a driver with no commission rate), never another
 *    driver's, no duplicates for multi-store orders; earnings = the Admin closing preview, exactly; a repeated DELIVERED changes nothing;
 *  - manual assignment up to the configured capacity, the exact limit, a clear refusal beyond it, and two operators racing for the last slot;
 *  - DRIVER_OFFLINE operations alerts: on switching offline (and, when configured, a silent app), one per incident, resolved on reconnect
 *    or reassignment, none for finished orders, one per active order.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, DriverFixture, expectData } from './support/actors';
import { OpsAlertsService } from '../../src/modules/notifications/ops-alerts.service';

describe('E2E — driver operations: photo, active list, history, earnings, capacity, offline alerts', () => {
  let world: World;
  let s: Scenario;
  let v1: VendorFixture;
  let v2: VendorFixture;
  let p1: { id: string; priceMinor: number };
  let p2: { id: string; priceMinor: number };
  let admin: Actor;
  let alerts: OpsAlertsService;
  const home = { lat: 30.425, lng: 31.565 };
  const near = { lat: 30.4212, lng: 31.5612 };

  const api = (method: 'get' | 'post' | 'patch', a: Actor | undefined, path: string, body?: unknown, query?: Record<string, string>) =>
    world.api(method, path, { token: a?.accessToken, body, query } as any);
  const retireAllDrivers = () => world.ds.query('UPDATE drivers SET is_online = false, is_available = false');

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    v1 = await s.vendor({ name: 'Ops One', serviceAreaId: area.id, lat: 30.421, lng: 31.561, commissionBasisPoints: 1000 });
    v2 = await s.vendor({ name: 'Ops Two', serviceAreaId: area.id, lat: 30.431, lng: 31.571, commissionBasisPoints: 1000 });
    p1 = await s.product(v1, { priceMinor: 30000, inventoryMode: 'OPEN' });
    p2 = await s.product(v2, { priceMinor: 5000, inventoryMode: 'OPEN' });
    admin = await s.superAdmin();
    alerts = world.app.get(OpsAlertsService);
  });
  beforeEach(async () => {
    await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', true);
    await retireAllDrivers();
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  /** A ready order assigned (by automatic dispatch) to a fresh, sole eligible courier with the given commission rate (null = none). */
  async function assignedOrder(opts: { rate?: number | null; payment?: string; twoStores?: boolean; driver?: DriverFixture } = {}) {
    if (!opts.driver) await retireAllDrivers(); // the new courier is the only eligible one
    const d = opts.driver ?? (await s.driver({ ...near }));
    if (!opts.driver) await world.ds.query(`UPDATE drivers SET commission_rate_basis_points = $2 WHERE id = $1`, [d.driverId, opts.rate === undefined ? 1000 : opts.rate]);
    const c = await s.customer();
    await s.addToCart(c, p1.id, 1);
    if (opts.twoStores) await s.addToCart(c, p2.id, 1);
    const transfer = opts.payment === 'MANUAL_TRANSFER';
    if (transfer) {
      await s.setConfig('MANUAL_TRANSFER_DESTINATION', { label: 'Hatly', phoneOrAccountNumber: '01000000000' });
      await s.setConfig('CUSTOMER_SERVICE_WHATSAPP_NUMBER', '+201000000000');
    }
    const order = await s.checkout(c, home, opts.payment ?? 'COD', transfer ? { electronicPaymentMethod: 'INSTAPAY' } : {});
    if (transfer) {
      // R2: verified before the store sees it — the real customer claim + Operations approval
      await api('post', c, `/payments/manual-transfer/orders/${order.id}/claim`, {});
      const [pay] = await world.ds.query(`SELECT id FROM payments WHERE order_id = $1`, [order.id]);
      expectData(await api('post', admin, `/admin/manual-transfer-payments/${pay.id}/approve`), 201);
    }
    await s.vendorPrepares(v1, order.id);
    if (opts.twoStores) await s.vendorPrepares(v2, order.id);
    const [dl] = await world.ds.query(`SELECT id, driver_id FROM deliveries WHERE order_id = $1`, [order.id]);
    expect(dl?.driver_id).toBe(d.driverId);
    return { d, order, deliveryId: dl.id as string };
  }
  const step = (d: Actor, deliveryId: string, status: string, extra: Record<string, unknown> = {}) =>
    api('patch', d, `/driver/deliveries/${deliveryId}/status`, { status, ...extra });
  async function deliver(d: Actor, deliveryId: string, extra: Record<string, unknown> = {}) {
    expectData(await step(d, deliveryId, 'PICKED_UP'));
    expectData(await step(d, deliveryId, 'ON_THE_WAY'));
    return step(d, deliveryId, 'DELIVERED', extra);
  }

  describe('optional delivery photo', () => {
    it('delivered WITHOUT a photo: accepted; the proof row records the delivery with no photo', async () => {
      const { d, order, deliveryId } = await assignedOrder();
      const res = await deliver(d, deliveryId, { recipientName: 'Mona' });
      expect(res.status).toBe(200);
      expect((await world.ds.query(`SELECT status FROM orders WHERE id = $1`, [order.id]))[0].status).toBe('DELIVERED');
      expect(await world.ds.query(`SELECT photo_url, recipient_name FROM proof_of_deliveries WHERE delivery_id = $1`, [deliveryId])).toEqual([{ photo_url: null, recipient_name: 'Mona' }]);
    });

    it('delivered WITH a photo keeps it; a URL that is not this driver\'s upload is still refused', async () => {
      const { d, deliveryId } = await assignedOrder();
      expectData(await step(d, deliveryId, 'PICKED_UP'));
      expectData(await step(d, deliveryId, 'ON_THE_WAY'));
      const bad = await step(d, deliveryId, 'DELIVERED', { proofPhotoUrl: 'https://evil.example/x.jpg' });
      expect(bad.status).toBe(400);
      expect(JSON.stringify(bad.body)).toContain('INVALID_PROOF_PHOTO');
      const photo = await s.uploadFakePhoto(d.accessToken);
      expectData(await step(d, deliveryId, 'DELIVERED', { proofPhotoUrl: photo }));
      expect((await world.ds.query(`SELECT photo_url FROM proof_of_deliveries WHERE delivery_id = $1`, [deliveryId]))[0].photo_url).toBe(photo);
    });

    it('guards are unchanged: another driver cannot deliver it; a delivered or cancelled order cannot be delivered (again)', async () => {
      const { d, order, deliveryId } = await assignedOrder();
      const other = await s.driver({ ...near });
      expectData(await step(d, deliveryId, 'PICKED_UP'));
      expectData(await step(d, deliveryId, 'ON_THE_WAY'));
      expect((await step(other, deliveryId, 'DELIVERED')).status).toBe(404);
      expectData(await step(d, deliveryId, 'DELIVERED'));
      const events = Number((await world.ds.query(`SELECT count(*)::int AS n FROM financial_events WHERE order_id = $1`, [order.id]))[0].n);
      expect((await step(d, deliveryId, 'DELIVERED')).status).toBe(200); // a retry of the applied change is a no-op …
      expect(Number((await world.ds.query(`SELECT count(*)::int AS n FROM financial_events WHERE order_id = $1`, [order.id]))[0].n)).toBe(events); // … with no second event
      const c2 = await assignedOrder();
      await world.ds.query(`UPDATE orders SET status = 'CANCELLED' WHERE id = $1`, [c2.order.id]);
      expect((await step(c2.d, c2.deliveryId, 'DELIVERED')).status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('active list, history and earnings', () => {
    it('several orders of one driver are independent; delivered ones leave the active list and appear once in history; earnings = Admin preview', async () => {
      const d = await s.driver({ ...near });
      await world.ds.query(`UPDATE drivers SET commission_rate_basis_points = 1000, capacity_override = 3 WHERE id = $1`, [d.driverId]);
      await world.ds.query(`UPDATE drivers SET is_available = true WHERE id = $1`, [d.driverId]);
      const a = await assignedOrder({ driver: d, twoStores: true });
      const b = await assignedOrder({ driver: d });
      const activeIds = async () => expectData<any[]>(await api('get', d, '/driver/deliveries', undefined, { scope: 'active' })).map((x) => x.orderId).sort();
      expect(await activeIds()).toEqual([a.order.id, b.order.id].sort());

      expectData(await deliver(d, a.deliveryId)); // the two-store order, no photo
      expect(await activeIds()).toEqual([b.order.id]); // b untouched, a gone
      expect((await world.ds.query(`SELECT status FROM orders WHERE id = $1`, [b.order.id]))[0].status).toBe('ASSIGNED_TO_DRIVER');
      // the old, unscoped list (installed apps) still carries finished orders, as before
      expect(expectData<any[]>(await api('get', d, '/driver/deliveries')).map((x) => x.orderId)).toContain(a.order.id);

      const history = await api('get', d, '/driver/transactions', undefined, { limit: '50' });
      const rows = history.body.data.filter((r: any) => r.orderId === a.order.id);
      expect(rows).toHaveLength(1); // one row for a two-store order
      expect(rows[0]).toMatchObject({ deliveryId: a.deliveryId, settlementState: 'PENDING', paymentMethod: 'COD' });
      expect(rows[0].vendors).toContain('Ops One');
      expect(rows[0].vendors).toContain('Ops Two');
      expect(history.body.data.map((r: any) => r.orderId)).not.toContain(b.order.id); // not delivered yet

      const earnings = expectData<any>(await api('get', d, '/driver/earnings'));
      const preview = expectData<any>(await api('get', admin, `/admin/settlement/drivers/${d.driverId}/close-preview`));
      expect(earnings.open.breakdown).toEqual(preview.totals);
      expect(earnings.open.netMinor).toBe(preview.totals.netToCourierMinor);
      expect(rows[0].netMinor).toBe(preview.lines.find((l: any) => l.orderId === a.order.id).netToCourierMinor);
      expect(preview.lines.find((l: any) => l.orderId === a.order.id)).toMatchObject({ paymentFlow: 'COD', goodsReimbursementMinor: 0, netToCourierMinor: -preview.lines.find((l: any) => l.orderId === a.order.id).commissionMinor });
      expect(earnings.open.inProgress).toBe(1);

      // after the Admin closes the shift, the same order shows as settled with the reference, and its numbers do not change
      const closed = expectData<any>(await api('post', admin, `/admin/settlement/drivers/${d.driverId}/close`, { previewToken: preview.previewToken }), 201);
      const after = (await api('get', d, '/driver/transactions', undefined, { limit: '50' })).body.data.find((r: any) => r.orderId === a.order.id);
      expect(after).toMatchObject({ settlementState: 'SETTLED', settlementReference: closed.reference, netMinor: rows[0].netMinor });
      const e2 = expectData<any>(await api('get', d, '/driver/earnings'));
      expect(e2.closedPeriods[0]).toMatchObject({ reference: closed.reference, methodVersion: 2, netMinor: closed.netPayableMinor });
      expect(e2.closedPeriods[0].breakdown.netToCourierMinor).toBe(closed.netPayableMinor);
    });

    it('a driver WITHOUT a commission rate: history is not empty — the delivered order is listed as excluded with the reason; earnings list it as held', async () => {
      const { d, order, deliveryId } = await assignedOrder({ rate: null });
      expectData(await deliver(d, deliveryId));
      const row = (await api('get', d, '/driver/transactions')).body.data.find((r: any) => r.orderId === order.id);
      expect(row).toMatchObject({ settlementState: 'EXCLUDED', excludedReason: 'RATE_UNDEFINED', netMinor: 0 });
      const earnings = expectData<any>(await api('get', d, '/driver/earnings'));
      expect(earnings.open.excluded).toEqual([expect.objectContaining({ orderId: order.id, reason: 'RATE_UNDEFINED' })]);
      expect(earnings.deliveredToday).toBe(1);
    });

    it('an electronic (manual transfer) order: Hatly owes goods + fee − commission, the same on both sides', async () => {
      const { d, order, deliveryId } = await assignedOrder({ payment: 'MANUAL_TRANSFER' });
      expectData(await deliver(d, deliveryId));
      const preview = expectData<any>(await api('get', admin, `/admin/settlement/drivers/${d.driverId}/close-preview`));
      const line = preview.lines.find((l: any) => l.orderId === order.id);
      expect(line).toMatchObject({ paymentFlow: 'ELECTRONIC', goodsReimbursementMinor: 30000, cashCollectedMinor: 0, cashHeldMinor: 0 });
      expect(line.netToCourierMinor).toBe(30000 + line.feeEntitlementMinor - line.commissionMinor);
      const row = (await api('get', d, '/driver/transactions')).body.data.find((r: any) => r.orderId === order.id);
      expect(row.netMinor).toBe(line.netToCourierMinor);
    });

    it('history never shows another driver\'s orders', async () => {
      const one = await assignedOrder();
      expectData(await deliver(one.d, one.deliveryId));
      const other = await s.driver({ ...near });
      const theirs = (await api('get', other, '/driver/transactions')).body.data.map((r: any) => r.orderId);
      expect(theirs).not.toContain(one.order.id);
    });
  });

  describe('manual assignment within the configured capacity', () => {
    it('up to the exact limit, then a clear at-capacity refusal (existing code, reason AT_CAPACITY) with the numbers; Admin sees load and capacity', async () => {
      await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false);
      const d = await s.driver({ ...near });
      await world.ds.query(`UPDATE drivers SET capacity_override = 2 WHERE id = $1`, [d.driverId]);
      await world.ds.query(`UPDATE drivers SET is_available = true WHERE id = $1`, [d.driverId]);
      const ready = async () => {
        const c = await s.customer();
        const order = await s.simpleOrder(c, v1, p1.id, home);
        await s.vendorPrepares(v1, order.id);
        return order.id as string;
      };
      const [o1, o2, o3] = [await ready(), await ready(), await ready()];
      const assign = (orderId: string) => api('post', admin, `/admin/orders/${orderId}/assign-driver`, { driverId: d.driverId });
      expect((await assign(o1)).status).toBe(201);
      expect((await assign(o2)).status).toBe(201); // exactly at the limit
      const refused = await assign(o3);
      expect(refused.status).toBe(409);
      expect(refused.body.error.details).toMatchObject({ code: 'NO_AVAILABLE_DRIVER', reason: 'AT_CAPACITY', active: 2, capacity: 2 });
      expect(JSON.stringify(refused.body)).toMatch(/2 active order\(s\).*limit is 2/);
      expect((await world.ds.query(`SELECT status FROM orders WHERE id = $1`, [o3]))[0].status).toBe('READY_FOR_PICKUP'); // nothing changed
      const list = expectData<any[]>(await api('get', admin, '/admin/control-tower/drivers'));
      expect(list.find((x) => x.id === d.driverId)).toMatchObject({ activeCount: 2, capacity: 2 });
      expect((await assign(o1)).status).toBeGreaterThanOrEqual(400); // the same order twice is refused
    });

    it('two operators racing for the last slot: exactly one wins, the driver never exceeds capacity', async () => {
      await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false);
      const d = await s.driver({ ...near });
      await world.ds.query(`UPDATE drivers SET capacity_override = 1 WHERE id = $1`, [d.driverId]);
      const ids: string[] = [];
      for (let i = 0; i < 2; i++) {
        const order = await s.simpleOrder(await s.customer(), v1, p1.id, home);
        await s.vendorPrepares(v1, order.id);
        ids.push(order.id);
      }
      const res = await Promise.all(ids.map((id) => api('post', admin, `/admin/orders/${id}/assign-driver`, { driverId: d.driverId })));
      expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(Number((await world.ds.query(`SELECT count(*)::int AS n FROM deliveries dl JOIN orders o ON o.id = dl.order_id WHERE dl.driver_id = $1 AND o.status = 'ASSIGNED_TO_DRIVER'`, [d.driverId]))[0].n)).toBe(1);
    });
  });

  describe('DRIVER_OFFLINE operations alerts', () => {
    const offlineAlerts = (orderId: string) => world.ds.query(`SELECT * FROM ops_alerts WHERE category = 'DRIVER_OFFLINE' AND order_id = $1 ORDER BY created_at`, [orderId]);

    it('an online driver raises nothing; switching offline raises ONE alert per active order (no duplicates on rescans); reconnecting resolves them', async () => {
      const d = await s.driver({ ...near });
      await world.ds.query(`UPDATE drivers SET capacity_override = 2, is_available = true WHERE id = $1`, [d.driverId]);
      const a = await assignedOrder({ driver: d });
      const b = await assignedOrder({ driver: d });
      await alerts.scan();
      expect(await offlineAlerts(a.order.id)).toHaveLength(0);

      expectData(await api('patch', d, '/driver/online-status', { isOnline: false }));
      await alerts.scan();
      await alerts.scan();
      for (const o of [a, b]) {
        const rows = await offlineAlerts(o.order.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ priority: 'CRITICAL', resolved_at: null });
        expect(rows[0].detail).toMatch(/^OFFLINE\|/);
        expect(rows[0].alert_key).toContain(d.driverId);
      }
      // the Admin list shows it, linked to the order
      const listed = expectData<any[]>(await api('get', admin, '/admin/ops-alerts')).filter((x) => x.category === 'DRIVER_OFFLINE' && x.orderId === a.order.id);
      expect(listed).toHaveLength(1);
      expect(listed[0].href).toContain(a.order.id);

      expectData(await api('patch', d, '/driver/online-status', { isOnline: true }));
      await alerts.scan();
      for (const o of [a, b]) expect((await offlineAlerts(o.order.id))[0]).toMatchObject({ resolution: 'DRIVER_RECONNECTED' });
      expect((await world.ds.query(`SELECT status FROM orders WHERE id = $1`, [a.order.id]))[0].status).toBe('ASSIGNED_TO_DRIVER'); // never reassigned
    });

    it('a later, separate disconnection raises a fresh alert; a finished order raises none; reassignment resolves', async () => {
      const { d, order, deliveryId } = await assignedOrder();
      expectData(await api('patch', d, '/driver/online-status', { isOnline: false }));
      await alerts.scan();
      expectData(await api('patch', d, '/driver/online-status', { isOnline: true }));
      await alerts.scan();
      await new Promise((r) => setTimeout(r, 1100)); // a new incident has a new start second
      expectData(await api('patch', d, '/driver/online-status', { isOnline: false }));
      await alerts.scan();
      const rows = await offlineAlerts(order.id);
      expect(rows).toHaveLength(2);
      expect(rows.filter((r: any) => !r.resolved_at)).toHaveLength(1);

      // Operations move the order to another driver → resolved as reassigned
      const other = await s.driver({ ...near });
      expectData(await api('post', admin, `/admin/orders/${order.id}/reassign-driver`, { driverId: other.driverId }), 201);
      await alerts.scan();
      expect((await offlineAlerts(order.id)).filter((r: any) => !r.resolved_at)).toHaveLength(0);
      expect((await offlineAlerts(order.id)).pop().resolution).toBe('DRIVER_REASSIGNED');
      void deliveryId;

      // a delivered order of an offline driver: no alert
      const done = await assignedOrder();
      expectData(await deliver(done.d, done.deliveryId));
      expectData(await api('patch', done.d, '/driver/online-status', { isOnline: false }));
      await alerts.scan();
      expect(await offlineAlerts(done.order.id)).toHaveLength(0);
    });

    it('a silent app (no API call) alerts ONLY when DRIVER_PRESENCE_STALE_MINUTES is set; the driver calling again resolves it', async () => {
      const { d, order } = await assignedOrder();
      await world.ds.query(`UPDATE drivers SET last_seen_at = now() - interval '20 minutes' WHERE id = $1`, [d.driverId]);
      await world.ds.query(`UPDATE deliveries SET assigned_at = now() - interval '20 minutes' WHERE order_id = $1`, [order.id]);
      await alerts.scan();
      expect(await offlineAlerts(order.id)).toHaveLength(0); // setting unset → this alert is off (no invented threshold)

      expect((await world.api('put', '/admin/business-config/DRIVER_PRESENCE_STALE_MINUTES', { token: admin.accessToken, body: { value: 1 } })).status).toBe(400); // below the allowed range
      await s.setConfig('DRIVER_PRESENCE_STALE_MINUTES', 10);
      try {
        await alerts.scan();
        const rows = await offlineAlerts(order.id);
        expect(rows).toHaveLength(1);
        expect(rows[0].detail).toMatch(/^SILENT\|\d{4}-/);
        expectData(await api('get', d, '/driver/deliveries', undefined, { scope: 'active' })); // the app calls again
        await alerts.scan();
        expect((await offlineAlerts(order.id))[0].resolution).toBe('DRIVER_RECONNECTED');
      } finally {
        await world.ds.query(`DELETE FROM business_config WHERE key = 'DRIVER_PRESENCE_STALE_MINUTES'`);
      }
    });
  });
  it('2026-11-15: the driver app reads its online switch from the server (GET); only the driver may read it', async () => {
    const d = await s.driver({ ...near });
    expect(expectData<any>(await api('get', d, '/driver/online-status'))).toEqual({ isOnline: true }); // s.driver() brings the driver online
    expectData(await api('patch', d, '/driver/online-status', { isOnline: false }));
    expect(expectData<any>(await api('get', d, '/driver/online-status'))).toEqual({ isOnline: false });
    expectData(await api('patch', d, '/driver/online-status', { isOnline: true }));
    expect(expectData<any>(await api('get', d, '/driver/online-status'))).toEqual({ isOnline: true });
    expect((await api('get', admin, '/driver/online-status')).status).toBe(403);
    expect((await api('get', await s.customer(), '/driver/online-status')).status).toBe(403);
    expect((await api('get', undefined, '/driver/online-status')).status).toBe(401);
  });
});
