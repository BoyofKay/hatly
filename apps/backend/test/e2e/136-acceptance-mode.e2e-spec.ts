/**
 * Release 2D-2 (2026-11-07) — R12: acceptance mode per vendor branch.
 *  - AUTO: accepted on placement, never bypassing checkout checks (hours, stock, product validity);
 *  - VENDOR (default): the vendor accepts or rejects;
 *  - HATLY: Hatly Operations accept or reject on the vendor's behalf; the vendor cannot, but still prepares.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';
import { boundary } from './support/external-boundary';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — acceptance mode per branch (R12)', () => {
  let world: World;
  let s: Scenario;
  let configurer: Actor;
  let ops: Actor;
  let outsider: Actor;
  let vendor: VendorFixture;
  let product: { id: string };
  const home = { lat: 30.425, lng: 31.565 };
  const q = (sql: string, params: unknown[] = []) => world.ds.query(sql, params);
  const setMode = (mode: string, who: Actor = configurer) =>
    world.api('patch', `/admin/vendor-branches/${vendor.branchId}/acceptance-mode`, { token: who.accessToken, body: { mode } });
  const branch = async () => (await q('SELECT acceptance_mode, auto_accept_enabled FROM vendor_branches WHERE id = $1', [vendor.branchId]))[0];
  const placeOrder = async () => {
    const c = await s.customer();
    const order = await s.simpleOrder(c, vendor, product.id, home);
    const [seg] = await q('SELECT id, status FROM order_vendor_segments WHERE order_id = $1', [order.id]);
    return { order, seg };
  };
  const vendorMoves = (segmentId: string, status: string, extra: Record<string, unknown> = {}) =>
    world.api('patch', `/vendor/orders/segments/${segmentId}/status`, { token: vendor.manager.accessToken, body: { status, ...extra } });

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    configurer = await s.admin([Permission.MANAGE_VENDOR_COMMISSION], 'Acceptance Configurer');
    ops = await s.admin([Permission.MANAGE_ORDER_FULFILMENT, Permission.VIEW_ORDERS], 'Fulfilment Ops');
    outsider = await s.admin([Permission.VIEW_ORDERS], 'Outsider');
    vendor = await s.vendor({ name: 'Acceptance Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    product = await s.product(vendor, { priceMinor: 8000, inventoryMode: 'OPEN' });
  });
  beforeEach(() => boundary.reset());
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('a new branch is VENDOR; only MANAGE_VENDOR_COMMISSION may change the mode; bad values are refused; changes are audited', async () => {
    expect(await branch()).toEqual({ acceptance_mode: 'VENDOR', auto_accept_enabled: false });
    expect((await setMode('AUTO', outsider)).status).toBe(403);
    expect((await setMode('SOMETIMES')).status).toBe(400);
    expect(expectData<any>(await setMode('HATLY')).acceptanceMode).toBe('HATLY');
    const [a] = await q(`SELECT metadata FROM admin_audit_logs WHERE target_id = $1 AND action = 'vendor_branch.updated' ORDER BY created_at DESC LIMIT 1`, [vendor.branchId]);
    expect(a.metadata).toMatchObject({ field: 'acceptanceMode', before: 'VENDOR', after: 'HATLY' });
    expectData(await setMode('VENDOR'));
  });

  it('VENDOR: the order waits for the vendor, who is asked to accept it', async () => {
    const { order, seg } = await placeOrder();
    expect(seg.status).toBe('PENDING');
    const [n] = await q(`SELECT required_action FROM staff_notifications WHERE order_id = $1 AND user_id = $2 AND category = 'VENDOR_NEW_ORDER'`, [order.id, vendor.manager.id]);
    expect(n.required_action).toBe('ACCEPT_ORDER');
    expectData(await vendorMoves(seg.id, 'CONFIRMED'));
  });

  it('AUTO: accepted on placement (and AUTO keeps the old boolean in step); a paused AUTO branch still refuses the order', async () => {
    expectData(await setMode('AUTO'));
    expect(await branch()).toEqual({ acceptance_mode: 'AUTO', auto_accept_enabled: true });
    const { seg } = await placeOrder();
    expect(seg.status).toBe('CONFIRMED');
    const superAdmin = await s.superAdmin();
    expectData(await world.api('patch', `/admin/vendor-branches/${vendor.branchId}/close`, { token: superAdmin.accessToken }));
    try {
      const c = await s.customer();
      await s.addToCart(c, product.id, 1);
      const refused = await world.api('post', '/orders', { token: c.accessToken, body: { deliveryAddress: { line1: 'x', latitude: home.lat, longitude: home.lng }, paymentMethod: 'COD' } });
      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.body)).toContain('BRANCH_CLOSED'); // automatic acceptance never bypasses availability
    } finally {
      expectData(await world.api('patch', `/admin/vendor-branches/${vendor.branchId}/open`, { token: superAdmin.accessToken }));
    }
  });

  it('HATLY: the vendor cannot accept or reject; Operations are asked and accept on its behalf; the vendor then prepares', async () => {
    expectData(await setMode('HATLY'));
    expect(await branch()).toEqual({ acceptance_mode: 'HATLY', auto_accept_enabled: false });
    const { order, seg } = await placeOrder();
    expect(seg.status).toBe('PENDING');

    const accept = await vendorMoves(seg.id, 'CONFIRMED');
    expect(accept.status).toBe(403);
    expect(accept.body.error.details.code).toBe('ACCEPTANCE_BY_HATLY');
    expect((await vendorMoves(seg.id, 'CANCELLED', { reason: 'Too busy' })).status).toBe(403);

    const [vn] = await q(`SELECT required_action FROM staff_notifications WHERE order_id = $1 AND user_id = $2 AND category = 'VENDOR_NEW_ORDER'`, [order.id, vendor.manager.id]);
    expect(vn.required_action).toBeNull(); // the vendor is told, not asked
    const [on] = await q(`SELECT required_action FROM staff_notifications WHERE order_id = $1 AND user_id = $2 AND category = 'OPS_ACCEPT_FOR_VENDOR'`, [order.id, ops.id]);
    expect(on.required_action).toBe('ACCEPT_ORDER');

    expectData(await world.api('patch', `/admin/orders/segments/${seg.id}/status`, { token: ops.accessToken, body: { status: 'CONFIRMED' } }));
    const [ev] = await q(`SELECT on_behalf_of_vendor FROM order_vendor_segment_events WHERE segment_id = $1 AND to_status = 'CONFIRMED'`, [seg.id]);
    expect(ev.on_behalf_of_vendor).toBe(true);
    expectData(await vendorMoves(seg.id, 'PREPARING'));
  });

  it('the old auto-accept switch maps onto the mode: on = AUTO; off returns to VENDOR, but never turns HATLY into VENDOR', async () => {
    const legacy = (on: boolean) => world.api('patch', `/admin/vendor-branches/${vendor.branchId}/auto-accept`, { token: configurer.accessToken, body: { autoAcceptEnabled: on } });
    expectData(await setMode('HATLY'));
    expectData(await legacy(false));
    expect((await branch()).acceptance_mode).toBe('HATLY');
    expectData(await legacy(true));
    expect(await branch()).toEqual({ acceptance_mode: 'AUTO', auto_accept_enabled: true });
    expectData(await legacy(false));
    expect(await branch()).toEqual({ acceptance_mode: 'VENDOR', auto_accept_enabled: false });
  });
});
