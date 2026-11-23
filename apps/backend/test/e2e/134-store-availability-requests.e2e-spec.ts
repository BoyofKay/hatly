/**
 * Release 2B (2026-11-07):
 *  - R8/R44: a vendor REQUESTS pausing/reopening, weekly hours, or a temporary closure (and its early end); Hatly Admin approves or
 *    rejects; Admin can still change everything directly. Changes affect new orders only.
 *  - R9: a closed/paused store, or one outside its weekly opening hours, accepts no new order; confirmed orders continue.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';
import { boundary } from './support/external-boundary';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — store availability requests (R8/R44) and enforcement (R9)', () => {
  let world: World;
  let s: Scenario;
  let ops: Actor;
  let vendor: VendorFixture;
  let product: { id: string };
  const home = { lat: 30.425, lng: 31.565 };
  const q = (sql: string, params: unknown[] = []) => world.ds.query(sql, params);
  const branchRow = async () => (await q('SELECT is_open, opening_hours FROM vendor_branches WHERE id = $1', [vendor.branchId]))[0];
  const vendorApi = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: unknown) =>
    world.api(method, path, { token: vendor.manager.accessToken, ...(body !== undefined ? { body } : {}) });
  const opsApi = (method: 'get' | 'post', path: string, body?: unknown) => world.api(method, path, { token: ops.accessToken, ...(body !== undefined ? { body } : {}) });
  const pendingOf = async (kind: string) =>
    (await q(`SELECT * FROM vendor_branch_change_requests WHERE vendor_branch_id = $1 AND kind = $2 AND status = 'PENDING'`, [vendor.branchId, kind]))[0];
  const order = async () => {
    const c = await s.customer();
    await s.addToCart(c, product.id, 1);
    return world.api('post', '/orders', { token: c.accessToken, body: await (await import('./support/actors')).withQuoteToken(world, c.accessToken, { deliveryAddress: { line1: 'Avail St', latitude: home.lat, longitude: home.lng }, paymentMethod: 'COD' }) });
  };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    ops = await s.admin([Permission.MANAGE_VENDORS, Permission.VIEW_ORDERS]); // the staff inbox needs order viewing too
    vendor = await s.vendor({ name: 'Availability Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    product = await s.product(vendor, { priceMinor: 10000, inventoryMode: 'OPEN' });
  });
  beforeEach(() => boundary.reset());
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('R44: switching the store closed is only a PAUSE request — the store stays open until Hatly approves; Operations are told', async () => {
    const res = expectData<any>(await vendorApi('patch', `/vendor/branches/${vendor.branchId}`, { isOpen: false, reason: 'staff shortage' }));
    expect(res.requests[0]).toMatchObject({ kind: 'PAUSE', status: 'PENDING' });
    expect((await branchRow()).is_open).toBe(true);
    const again = await vendorApi('patch', `/vendor/branches/${vendor.branchId}`, { isOpen: false });
    expect(again.status).toBe(409); // one pending request of a kind
    expect((await q(`SELECT 1 FROM staff_notifications WHERE category = 'OPS_BRANCH_CHANGE_REQUEST' AND user_id = $1`, [ops.id])).length).toBeGreaterThanOrEqual(1);
    expect((await order()).status).toBe(201); // still taking orders while the request waits
  });

  it('Admin approves the pause → no new orders (BRANCH_CLOSED), the vendor is told; a REOPEN request then needs approval too', async () => {
    const pending = await pendingOf('PAUSE');
    const list = expectData<any[]>(await opsApi('get', '/admin/branch-change-requests'));
    expect(list.map((r) => r.id)).toContain(pending.id);
    expectData(await opsApi('post', `/admin/branch-change-requests/${pending.id}/approve`, { note: 'ok' }), 201);
    expect((await branchRow()).is_open).toBe(false);
    const refused = await order();
    expect(refused.status).toBe(400);
    expect(refused.body.error.details.code).toBe('BRANCH_CLOSED');
    expect((await q(`SELECT 1 FROM staff_notifications WHERE category = 'VENDOR_BRANCH_CHANGE_DECIDED' AND user_id = $1`, [vendor.manager.id])).length).toBe(1);

    expectData(await vendorApi('patch', `/vendor/branches/${vendor.branchId}`, { isOpen: true }));
    expect((await branchRow()).is_open).toBe(false);
    expectData(await opsApi('post', `/admin/branch-change-requests/${(await pendingOf('REOPEN')).id}/approve`, {}), 201);
    expect((await branchRow()).is_open).toBe(true);
    expect((await order()).status).toBe(201);
  });

  it('weekly hours are a request; a rejection changes nothing; an approval applies and outside the hours no order is taken', async () => {
    const closedNow = { mon: { open: '03:00', close: '03:01' }, tue: { open: '03:00', close: '03:01' }, wed: { open: '03:00', close: '03:01' }, thu: { open: '03:00', close: '03:01' }, fri: { open: '03:00', close: '03:01' }, sat: { open: '03:00', close: '03:01' }, sun: { open: '03:00', close: '03:01' } };
    const bad = await vendorApi('patch', `/vendor/branches/${vendor.branchId}`, { openingHours: { monday: { open: '9', close: '22' } } });
    expect(bad.status).toBe(400);
    expectData(await vendorApi('patch', `/vendor/branches/${vendor.branchId}`, { openingHours: closedNow }));
    expectData(await opsApi('post', `/admin/branch-change-requests/${(await pendingOf('HOURS')).id}/reject`, { note: 'no' }), 201);
    expect((await branchRow()).opening_hours).toEqual({});

    expectData(await vendorApi('patch', `/vendor/branches/${vendor.branchId}`, { openingHours: closedNow }));
    expectData(await opsApi('post', `/admin/branch-change-requests/${(await pendingOf('HOURS')).id}/approve`, {}), 201);
    expect((await branchRow()).opening_hours).toEqual(closedNow);
    const [{ t }] = await q(`SELECT to_char(now() AT TIME ZONE 'Africa/Cairo', 'HH24:MI') AS t`);
    if (t !== '03:00') {
      const refused = await order();
      expect(refused.body.error.details.code).toBe('BRANCH_OUTSIDE_OPENING_HOURS');
      // Bug 2026-11-23: the customer screens said "Open now" while checkout refused — they now apply the same hours rule.
      const page = expectData(await world.api('get', `/vendor-branches/${vendor.branchId}`));
      expect(page.isOpen).toBe(false);
      expect(page.openingHours).toEqual(closedNow);
      const found = expectData(await world.api('get', `/search?q=${encodeURIComponent('Availability Vendor')}`));
      const hit = (found.vendors.data as any[]).find((v) => v.id === vendor.branchId);
      if (hit) {
        expect(hit.isOpen).toBe(false);
        expect(hit.openingHours).toEqual(closedNow);
      }
    }
    await q(`UPDATE vendor_branches SET opening_hours = '{}'::jsonb WHERE id = $1`, [vendor.branchId]);
  });

  it('a temporary closure is a request (nothing created before approval); approved → created; its early end is a request too', async () => {
    const starts = new Date(Date.now() - 60_000).toISOString();
    const ends = new Date(Date.now() + 3_600_000).toISOString();
    const req = expectData<any>(await vendorApi('post', `/vendor/branches/${vendor.branchId}/closures`, { kind: 'TEMPORARY', startsAt: starts, endsAt: ends, reason: 'Inventory count' }), 201);
    expect(req.request).toMatchObject({ kind: 'CLOSURE', status: 'PENDING' });
    expect(await q('SELECT 1 FROM vendor_branch_closures WHERE vendor_branch_id = $1 AND cancelled_at IS NULL', [vendor.branchId])).toHaveLength(0);
    expectData(await opsApi('post', `/admin/branch-change-requests/${req.request.id}/approve`, {}), 201);
    const [closure] = await q('SELECT id FROM vendor_branch_closures WHERE vendor_branch_id = $1 AND cancelled_at IS NULL', [vendor.branchId]);
    expect(closure).toBeDefined();
    expect((await order()).body.error.details.code).toBe('BRANCH_TEMPORARILY_CLOSED');

    const endReq = expectData<any>(await vendorApi('delete', `/vendor/branches/${vendor.branchId}/closures/${closure.id}`));
    expect(endReq.request).toMatchObject({ kind: 'CLOSURE_CANCEL', status: 'PENDING' });
    expect(await q('SELECT 1 FROM vendor_branch_closures WHERE id = $1 AND cancelled_at IS NULL', [closure.id])).toHaveLength(1);
    expectData(await opsApi('post', `/admin/branch-change-requests/${endReq.request.id}/approve`, {}), 201);
    expect((await order()).status).toBe(201);
  });

  it('a vendor can withdraw its own pending request; a decided request cannot be decided again; another vendor cannot see or act', async () => {
    expectData(await vendorApi('patch', `/vendor/branches/${vendor.branchId}`, { isOpen: false }));
    const p = await pendingOf('PAUSE');
    expectData(await vendorApi('post', `/vendor/branches/${vendor.branchId}/change-requests/${p.id}/withdraw`), 201);
    expect((await opsApi('post', `/admin/branch-change-requests/${p.id}/approve`, {})).status).toBe(409);
    expect((await branchRow()).is_open).toBe(true);

    const other = await s.vendor({ name: 'Other Vendor', serviceAreaId: (await q('SELECT service_area_id FROM vendor_branches WHERE id = $1', [vendor.branchId]))[0].service_area_id, lat: 30.43, lng: 31.57 });
    const peek = await world.api('get', `/vendor/branches/${vendor.branchId}/change-requests`, { token: other.manager.accessToken });
    expect(peek.status).toBe(404);
    const noPerm = await s.admin([]);
    expect((await world.api('get', '/admin/branch-change-requests', { token: noPerm.accessToken })).status).toBe(403);
  });

  it('preparation time is still changed directly (not a request)', async () => {
    const res = expectData<any>(await vendorApi('patch', `/vendor/branches/${vendor.branchId}`, { preparationTimeMinutes: 25 }));
    expect(res.requests).toBeUndefined();
    expect((await q('SELECT preparation_time_minutes FROM vendor_branches WHERE id = $1', [vendor.branchId]))[0].preparation_time_minutes).toBe(25);
  });
});
