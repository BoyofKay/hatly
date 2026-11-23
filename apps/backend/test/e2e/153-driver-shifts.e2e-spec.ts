/**
 * Driver shifts (owner decision 2026-11-22), over real HTTP and a real database:
 *  - Start shift opens one shift and puts the driver on duty; a second start returns the same shift.
 *  - End shift is refused while an order is with the driver, and while a delivered order is not settled (cash in hand / owed);
 *    "stop new orders" keeps the shift but the driver receives nothing new.
 *  - The courier closing ends the open shift, links the shifts it covers, and lists them in its preview; after it the driver may end/
 *    start freely. A supervisor can force-end; the operations team cannot.
 */
import { bootWorld, World } from './support/world';
import { Actor, Scenario, VendorFixture, expectData } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';
import { AutomaticDispatchService } from '../../src/modules/delivery/automatic-dispatch.service';

describe('E2E — driver shifts', () => {
  let world: World;
  let s: Scenario;
  let sa: Actor;
  let vendor: VendorFixture;
  let product: { id: string };
  const near = { lat: 30.4212, lng: 31.5612 };
  const home = { lat: 30.425, lng: 31.565 };
  const call = (method: 'get' | 'post' | 'patch', token: string, path: string, body?: unknown) => world.api(method, path, { token, body });
  const code = (res: any) => res.body?.error?.details?.code;

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    vendor = await s.vendor({ name: 'Shift Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    product = await s.product(vendor, { priceMinor: 10000, inventoryMode: 'OPEN' });
    sa = await s.superAdmin();
  });
  beforeEach(async () => {
    await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', true);
    await world.ds.query('UPDATE drivers SET is_online = false, is_available = false');
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('start → on duty with one shift; end with nothing pending → off duty', async () => {
    const d = await s.driver({ ...near });
    const started = expectData<any>(await call('post', d.accessToken, '/driver/shift/start'), 201);
    expect(started.onDuty).toBe(true);
    expect(started.shift?.startedAt).toBeTruthy();
    const again = expectData<any>(await call('post', d.accessToken, '/driver/shift/start'), 201);
    expect(again.shift.id).toBe(started.shift.id);
    const ended = expectData<any>(await call('post', d.accessToken, '/driver/shift/end'), 201);
    expect(ended.onDuty).toBe(false);
    expect(ended.shift).toBeNull();
    const [row] = await world.ds.query(`SELECT ended_by FROM driver_shifts WHERE id = $1`, [started.shift.id]);
    expect(row.ended_by).toBe('DRIVER');
  });

  it('end is refused while carrying an order and while a delivery is unsettled; the closing ends and links the shift; "stop new orders" receives nothing', async () => {
    const d = await s.driver({ ...near });
    await world.ds.query(`UPDATE drivers SET commission_rate_basis_points = 1000 WHERE id = $1`, [d.driverId]); // a real driver has a commission rate
    expectData(await call('post', d.accessToken, '/driver/shift/start'), 201);
    const order = await s.simpleOrder(await s.customer(), vendor, product.id, home);
    await s.vendorPrepares(vendor, order.id);
    const carrier = await s.driverAssignedTo(order.id);
    expect(carrier.driverId).toBe(d.driverId);

    const busy = await call('post', d.accessToken, '/driver/shift/end');
    expect(busy.status).toBe(409);
    expect(code(busy)).toBe('SHIFT_HAS_ACTIVE_ORDERS');

    // "stop new orders": the next order does not come to this driver
    expectData(await call('patch', d.accessToken, '/driver/shift/accepting-new-orders', { accepting: false }));
    const second = await s.simpleOrder(await s.customer(), vendor, product.id, home);
    await s.vendorPrepares(vendor, second.id);
    const [secondRow] = await world.ds.query('SELECT driver_id FROM deliveries WHERE order_id = $1', [second.id]);
    expect(secondRow?.driver_id ?? null).not.toBe(d.driverId);

    const delivery = expectData<any[]>(await call('get', d.accessToken, '/driver/deliveries')).find((x) => x.orderId === order.id);
    for (const status of ['PICKED_UP', 'ON_THE_WAY']) expectData(await call('patch', d.accessToken, `/driver/deliveries/${delivery.id}/status`, { status }));
    expectData(await call('patch', d.accessToken, `/driver/deliveries/${delivery.id}/status`, { status: 'DELIVERED', proofPhotoUrl: await s.uploadFakePhoto(d.accessToken), recipientName: 'Customer' }));

    const unsettled = await call('post', d.accessToken, '/driver/shift/end');
    expect(unsettled.status).toBe(409);
    expect(code(unsettled)).toBe('SHIFT_NOT_SETTLED');

    const preview = expectData<any>(await call('get', sa.accessToken, `/admin/settlement/drivers/${d.driverId}/close-preview`));
    expect(preview.shifts).toHaveLength(1);
    expect(preview.shifts[0].endedAt).toBeNull();
    const closed = expectData<any>(await call('post', sa.accessToken, `/admin/settlement/drivers/${d.driverId}/close`, { previewToken: preview.previewToken }), 201);
    const [shift] = await world.ds.query(`SELECT ended_by, closing_period_id FROM driver_shifts WHERE driver_id = $1`, [d.driverId]);
    expect(shift.ended_by).toBe('CLOSING');
    expect(shift.closing_period_id).toBe(closed.id);
    const state = expectData<any>(await call('get', d.accessToken, '/driver/shift'));
    expect(state.onDuty).toBe(false);
  });

  it('a supervisor can force-end a shift; the operations team cannot', async () => {
    const d = await s.driver({ ...near });
    expectData(await call('post', d.accessToken, '/driver/shift/start'), 201);
    const presets = (await call('get', sa.accessToken, '/admin/staff')).body.meta.presets as Array<{ key: string; permissions: Permission[] }>;
    const supervisor = await s.admin(presets.find((p) => p.key === 'OPS_SUPERVISOR')!.permissions, 'Shift Supervisor');
    const team = await s.admin(presets.find((p) => p.key === 'OPS_TEAM')!.permissions, 'Shift Team');
    expect((await call('post', team.accessToken, `/admin/drivers/${d.driverId}/shift/end`)).status).toBe(403);
    const forced = expectData<any>(await call('post', supervisor.accessToken, `/admin/drivers/${d.driverId}/shift/end`), 201);
    expect(forced.onDuty).toBe(false);
    const [row] = await world.ds.query(`SELECT ended_by FROM driver_shifts WHERE driver_id = $1`, [d.driverId]);
    expect(row.ended_by).toBe('SUPERVISOR');
  });

  it('the older apps\' online switch still records a shift', async () => {
    const d = await s.driver({ ...near });
    const [row] = await world.ds.query(`SELECT count(*)::int AS n FROM driver_shifts WHERE driver_id = $1 AND ended_at IS NULL`, [d.driverId]);
    expect(row.n).toBe(1); // s.driver goes online through PATCH /driver/online-status
    void AutomaticDispatchService;
  });
});
