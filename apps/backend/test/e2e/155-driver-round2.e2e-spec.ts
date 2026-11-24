/**
 * Driver app round 2 (owner decision 2026-11-22):
 *  - "Forgot password?" sends a request to Operations (same answer for any phone); Operations see it on the Drivers page; resetting the
 *    password closes it; it can also be dismissed.
 *  - Orders tab: Today (not yet closed) | Previous (closed; default this week), search, status filter, KPIs incl. ignored offers.
 *  - Earnings tab: Current shift (the closing preview: cash in pocket, revenue, loan, allowance, balance, unsettled) | Previous (closings).
 */
import { bootWorld, World } from './support/world';
import { Actor, Scenario, VendorFixture, expectData } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — driver app round 2', () => {
  let world: World;
  let s: Scenario;
  let sa: Actor;
  let vendor: VendorFixture;
  let product: { id: string };
  const near = { lat: 30.4212, lng: 31.5612 };
  const home = { lat: 30.425, lng: 31.565 };
  const call = (method: 'get' | 'post' | 'patch', token: string | undefined, path: string, body?: unknown) => world.api(method, path, { token, body });

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    vendor = await s.vendor({ name: 'Round Two Grill', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    product = await s.product(vendor, { priceMinor: 10000, inventoryMode: 'OPEN' });
    sa = await s.superAdmin();
    await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', true);
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  const deliver = async (d: { accessToken: string }, orderId: string) => {
    const delivery = expectData<any[]>(await call('get', d.accessToken, '/driver/deliveries')).find((x) => x.orderId === orderId);
    expectData(await call('post', d.accessToken, `/driver/deliveries/${delivery.id}/acknowledge`), 201);
    for (const status of ['PICKED_UP', 'ON_THE_WAY']) expectData(await call('patch', d.accessToken, `/driver/deliveries/${delivery.id}/status`, { status }));
    expectData(await call('patch', d.accessToken, `/driver/deliveries/${delivery.id}/status`, { status: 'DELIVERED', proofPhotoUrl: await s.uploadFakePhoto(d.accessToken), recipientName: 'Customer' }));
  };

  it('forgot password: same answer for any phone; Operations see it; a reset closes it; dismiss works', async () => {
    await world.ds.query('UPDATE drivers SET is_online = false, is_available = false');
    const d = await s.driver({ ...near, fullName: 'Forgetful Rider' });
    const [{ phone }] = await world.ds.query(`SELECT phone FROM users WHERE id = $1`, [d.id]);
    const known = await call('post', undefined, '/auth/driver/password-reset-request', { phone });
    const unknown = await call('post', undefined, '/auth/driver/password-reset-request', { phone: '+201099999999' });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(unknown.body.message).toBe(known.body.message);
    await call('post', undefined, '/auth/driver/password-reset-request', { phone }); // a repeat keeps one open request

    const list = expectData<any[]>(await call('get', sa.accessToken, '/admin/drivers/password-reset-requests'));
    expect(list.filter((r) => r.driverId === d.driverId)).toHaveLength(1);
    const team = await s.admin([Permission.VIEW_ORDERS], 'No Drivers Access');
    expect((await call('get', team.accessToken, '/admin/drivers/password-reset-requests')).status).toBe(403);

    expect((await call('post', sa.accessToken, `/admin/drivers/${d.driverId}/reset-password`, { newPassword: 'Temp-Pass-123' })).status).toBe(204);
    expect(expectData<any[]>(await call('get', sa.accessToken, '/admin/drivers/password-reset-requests')).some((r) => r.driverId === d.driverId)).toBe(false);

    await call('post', undefined, '/auth/driver/password-reset-request', { phone });
    const again = expectData<any[]>(await call('get', sa.accessToken, '/admin/drivers/password-reset-requests')).find((r) => r.driverId === d.driverId);
    expect((await call('post', sa.accessToken, `/admin/drivers/password-reset-requests/${again.id}/dismiss`)).status).toBe(204);
    expect(expectData<any[]>(await call('get', sa.accessToken, '/admin/drivers/password-reset-requests')).some((r) => r.driverId === d.driverId)).toBe(false);
  });

  it('orders + earnings: Today/Current shift until the closing, then Previous; KPIs, search, status filter, ignored offers', async () => {
    await world.ds.query('UPDATE drivers SET is_online = false, is_available = false');
    const d = await s.driver({ ...near, fullName: 'Round Two Rider' });
    await world.ds.query(`UPDATE drivers SET commission_rate_basis_points = 1000 WHERE id = $1`, [d.driverId]);
    expectData(await call('post', d.accessToken, '/driver/shift/start'), 201);

    const order = await s.simpleOrder(await s.customer(), vendor, product.id, home);
    await s.vendorPrepares(vendor, order.id);
    expect((await s.driverAssignedTo(order.id)).driverId).toBe(d.driverId);
    await deliver(d, order.id);
    // an ignored offer is counted (Operations were alerted for him)
    await world.ds.query(`INSERT INTO dispatch_attempts (order_id, outcome, driver_id, detail) VALUES ($1, 'ACKNOWLEDGEMENT_OVERDUE', $2, 'e2e')`, [order.id, d.driverId]);

    const [{ order_number }] = await world.ds.query(`SELECT order_number FROM orders WHERE id = $1`, [order.id]);
    let today = expectData<any>(await call('get', d.accessToken, '/driver/orders/overview?tab=today'));
    expect(today.items.map((i: any) => i.orderNumber)).toContain(order_number);
    expect(today.kpis).toMatchObject({ all: 1, completed: 1, cancelled: 0, failed: 0, ignored: 0, accepted: 0, acceptanceRatePercent: null });
    const hit = today.items.find((i: any) => i.orderNumber === order_number);
    expect(hit).toMatchObject({ status: 'DELIVERED', settlementState: 'PENDING', vendors: 'Round Two Grill' });
    expect(hit.earnedMinor).toEqual(expect.any(Number));
    expect(expectData<any>(await call('get', d.accessToken, `/driver/orders/overview?tab=today&q=${encodeURIComponent('round two')}`)).total).toBe(1);
    expect(expectData<any>(await call('get', d.accessToken, '/driver/orders/overview?tab=today&q=nothing-like-this')).total).toBe(0);
    expect(expectData<any>(await call('get', d.accessToken, '/driver/orders/overview?tab=today&status=cancelled')).total).toBe(0);
    expect(expectData<any>(await call('get', d.accessToken, '/driver/orders/overview?tab=previous')).total).toBe(0);

    expectData(await call('post', sa.accessToken, `/admin/drivers/${d.driverId}/allowances`, { amountMinor: 20000 }), 201);
    const current = expectData<any>(await call('get', d.accessToken, '/driver/earnings/overview?tab=current'));
    expect(current.kpis.unsettledOrders).toBe(1);
    expect(current.kpis.allowanceMinor).toBe(20000);
    expect(current.kpis.balanceMinor).toBe(current.items[0].netMinor - 20000);
    expect(current.items).toHaveLength(1);
    expect(current.items[0].earnedMinor).toBe(current.kpis.revenueMinor);
    expect(current.shiftStartedAt).toEqual(expect.any(String));

    // the closing moves everything to Previous
    const preview = expectData<any>(await call('get', sa.accessToken, `/admin/settlement/drivers/${d.driverId}/close-preview`));
    const closed = expectData<any>(await call('post', sa.accessToken, `/admin/settlement/drivers/${d.driverId}/close`, { previewToken: preview.previewToken }), 201);
    today = expectData<any>(await call('get', d.accessToken, '/driver/orders/overview?tab=today'));
    expect(today.total).toBe(1);
    expectData(await call('post', d.accessToken, '/driver/shift/end'), 201);
    today = expectData<any>(await call('get', d.accessToken, '/driver/orders/overview?tab=today'));
    expect(today.total).toBe(0);
    const prev = expectData<any>(await call('get', d.accessToken, '/driver/orders/overview?tab=previous'));
    expect(prev.items[0]).toMatchObject({ orderNumber: order_number, settlementState: 'SETTLED', settlementReference: closed.reference });
    expect(prev.kpis.completed).toBe(1);
    expect(prev.range.from <= prev.range.to).toBe(true);
    expect((await call('get', d.accessToken, '/driver/orders/overview?tab=previous&from=2026-12-01&to=2026-11-01')).status).toBe(400);

    const after = expectData<any>(await call('get', d.accessToken, '/driver/earnings/overview?tab=current'));
    expect(after.kpis).toMatchObject({ unsettledOrders: 0, allowanceMinor: 0, revenueMinor: 0 });
    const prevEarn = expectData<any>(await call('get', d.accessToken, '/driver/earnings/overview?tab=previous'));
    expect(prevEarn.items[0]).toMatchObject({ reference: closed.reference, orders: 1, allowanceReturnedMinor: 20000 });
    expect(prevEarn.kpis.orders).toBe(1);
    expect(prevEarn.kpis.revenueMinor).toBe(prevEarn.items[0].revenueMinor);
    expect(prevEarn.kpis.minutesWorked).toEqual(expect.any(Number));
  });
});
