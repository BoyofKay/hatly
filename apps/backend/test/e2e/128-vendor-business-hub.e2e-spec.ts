/**
 * The Vendor Business Hub — overview, order history, insights, earnings statement, team, branch profile — over real HTTP against real PostgreSQL.
 * Every answer is scoped to the caller's own branches; another vendor's branch is indistinguishable from a branch that does not exist; customers,
 * drivers, admins and anonymous callers are refused; no customer personal data is in any of these payloads.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData, DEFAULT_PASSWORD, nextPhone } from './support/actors';
import { Role } from '../../src/common/enums/role.enum';

describe('E2E — Vendor Business Hub', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string };
  let v1: VendorFixture;
  let v2: VendorFixture;
  let operator: Actor; // a plain VENDOR (not a manager) linked to v1's branch
  let driver: Awaited<ReturnType<Scenario['driver']>>;
  let p1: { id: string };
  let p2: { id: string };
  let pC: { id: string };
  const home = { lat: 30.425, lng: 31.565 };
  const get = (a: Actor | undefined, path: string, query?: Record<string, string>) => world.api('get', path, { token: a?.accessToken, query });

  const place = async (lines: Array<[{ id: string }, number]>) => {
    const c = await s.customer('Private Customer Name');
    for (const [p, q] of lines) await s.addToCart(c, p.id, q, {});
    return { c, order: await s.checkout(c, home, 'COD') };
  };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    v1 = await s.vendor({ name: 'Hub One', serviceAreaId: area.id, lat: 30.421, lng: 31.561, commissionBasisPoints: 1000 });
    v2 = await s.vendor({ name: 'Hub Two', serviceAreaId: area.id, lat: 30.431, lng: 31.571, commissionBasisPoints: 1000 });
    p1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'OPEN' });
    p2 = await s.product(v1, { priceMinor: 5000, inventoryMode: 'OPEN' });
    pC = await s.product(v2, { priceMinor: 3000, inventoryMode: 'OPEN' });
    driver = await s.driver({ lat: 30.42, lng: 31.56 });
    const superAdmin = await s.superAdmin();
    const phone = nextPhone();
    const staff = expectData<any>(await world.api('post', '/admin/vendor-staff', { token: superAdmin.accessToken, body: { phone, fullName: 'Hub Operator', vendorBranchId: v1.branchId, password: DEFAULT_PASSWORD, role: Role.VENDOR } }), 201);
    operator = await s.login('/auth/password/login', { id: staff.userId ?? staff.id, phone, fullName: 'Hub Operator', role: Role.VENDOR });
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('only vendor staff may read the hub; customers, drivers, admins and anonymous callers are refused', async () => {
    const customer = await s.customer();
    const admin = await s.superAdmin();
    const paths = ['/vendor/overview', '/vendor/insights', '/vendor/earnings', '/vendor/team', '/vendor/orders/history', `/vendor/branches/${v1.branchId}`];
    for (const path of paths) {
      expect((await get(undefined, path)).status).toBe(401);
      for (const who of [customer, driver, admin]) expect((await get(who, path)).status).toBe(403);
      expect((await get(v1.manager, path)).status).toBe(200);
    }
  });

  it('each vendor sees only its own branches: overview, history, insights and team', async () => {
    const a = await place([[p1, 2], [p2, 1]]);
    const b = await place([[p1, 1]]);
    const c = await place([[pC, 1]]);

    const o1 = expectData<any>(await get(v1.manager, '/vendor/overview'));
    const o2 = expectData<any>(await get(v2.manager, '/vendor/overview'));
    expect(o1.today.received).toBeGreaterThanOrEqual(2);
    expect(o1.awaitingAcceptance).toBeGreaterThanOrEqual(2);
    expect(o1.branches.map((x: any) => x.id)).toEqual([v1.branchId]);
    expect(o2.branches.map((x: any) => x.id)).toEqual([v2.branchId]);
    expect(o2.today.received).toBe(1);
    expect(o1.today.goodsMinor).toBeGreaterThanOrEqual(25000 + 10000);
    // Yesterday's figures (nothing was placed yesterday in this run), the vendor's own product count, and no rating until a customer rates.
    expect(o1.yesterday).toEqual({ received: 0, cancelled: 0, goodsMinor: 0 });
    expect(o1.productCount).toBeGreaterThanOrEqual(2);
    expect(o2.productCount).toBeGreaterThanOrEqual(1);
    expect(o1.rating).toBeNull();
    expect(typeof o1.vendorName).toBe('string');
    expect(o1.vendorName).not.toBe(o2.vendorName);

    const h1 = await get(v1.manager, '/vendor/orders/history');
    const numbers1 = h1.body.data.map((r: any) => r.orderNumber);
    expect(numbers1).toEqual(expect.arrayContaining([a.order.orderNumber, b.order.orderNumber]));
    expect(numbers1).not.toContain(c.order.orderNumber);
    expect(h1.body.meta.total).toBe(numbers1.length);
    const h2 = await get(v2.manager, '/vendor/orders/history');
    expect(h2.body.data.map((r: any) => r.orderNumber)).toEqual([c.order.orderNumber]);
    // No customer personal data anywhere in these payloads.
    expect(JSON.stringify([h1.body, o1])).not.toMatch(/Private Customer Name|phone|\+20\d{9}|address/i);
    expect(Object.keys(h1.body.data[0]).sort()).toEqual(['branch', 'createdAt', 'fulfillmentType', 'itemCount', 'orderId', 'orderNumber', 'orderStatus', 'paymentMethod', 'segmentId', 'status', 'subtotalMinor']);

    const ins1 = expectData<any>(await get(v1.manager, '/vendor/insights'));
    expect(ins1.totals.received).toBeGreaterThanOrEqual(2);
    expect(ins1.totals.averageMinor).toBeGreaterThan(0);
    expect(ins1.topProducts[0]).toMatchObject({ quantity: expect.any(Number) });
    expect(ins1.daily.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(ins1)).not.toContain('Hub Two');

    const team1 = expectData<any>(await get(v1.manager, '/vendor/team'));
    expect(team1.members.map((m: any) => m.fullName).sort()).toEqual(['Hub One Manager', 'Hub Operator'].sort());
    expect(team1.members.find((m: any) => m.fullName === 'Hub Operator')).toMatchObject({ role: 'OPERATOR', isYou: false });
    expect(team1.members.every((m: any) => /^\+\d{2}••••\d{3}$/.test(m.phoneMasked))).toBe(true);
    expect(expectData<any>(await get(v2.manager, '/vendor/team')).members.map((m: any) => m.fullName)).toEqual(['Hub Two Manager']);
    // A branch manager may manage operators of their own branches (see 129); an operator may not. Never a manager's own account.
    expect(team1.canManage).toBe(true);
    expect(team1.members.find((m: any) => m.fullName === 'Hub One Manager').manageable).toBe(false);
    expect(expectData<any>(await get(operator, '/vendor/team')).canManage).toBe(false);
  });

  it('history: filters, search, pagination and input validation', async () => {
    const x = await place([[p2, 1]]);
    expect((await get(v1.manager, '/vendor/orders/history', { limit: '1' })).body.data).toHaveLength(1);
    const p2page = await get(v1.manager, '/vendor/orders/history', { limit: '1', page: '2' });
    expect(p2page.body.meta).toMatchObject({ page: 2, limit: 1 });
    const found = await get(v1.manager, '/vendor/orders/history', { q: x.order.orderNumber });
    expect(found.body.data.map((r: any) => r.orderNumber)).toEqual([x.order.orderNumber]);
    expect((await get(v1.manager, '/vendor/orders/history', { q: x.order.orderNumber, status: 'CANCELLED' })).body.data).toEqual([]);
    expect((await get(v1.manager, '/vendor/orders/history', { status: 'NOPE' })).status).toBe(400);
    expect((await get(v1.manager, '/vendor/orders/history', { from: '2026-13-99x' })).status).toBe(400);
    expect((await get(v1.manager, '/vendor/orders/history', { from: '2020-01-01', to: '2026-01-01' })).status).toBe(400); // wider than 366 days
    expect((await get(v1.manager, '/vendor/orders/history', { from: '2020-01-01', to: '2020-01-02' })).body.data).toEqual([]);
    // another vendor's branch, or a malformed id, is just "not found"
    expect((await get(v1.manager, '/vendor/orders/history', { branchId: v2.branchId })).status).toBe(404);
    expect((await get(v1.manager, '/vendor/insights', { branchId: 'not-a-uuid' })).status).toBe(404);
    expect((await get(v1.manager, '/vendor/orders/history', { branchId: v1.branchId })).status).toBe(200);
  });

  it('insights: acceptance and preparation times come from the recorded events, and a cancelled part is counted as cancelled', async () => {
    const a = await place([[p1, 1]]);
    await s.vendorPrepares(v1, a.order.id);
    const b = await place([[p2, 1]]);
    const seg = (await world.ds.query('SELECT id FROM order_vendor_segments WHERE order_id = $1', [b.order.id]))[0].id;
    expectData(await world.api('patch', `/vendor/orders/segments/${seg}/status`, { token: v1.manager.accessToken, body: { status: 'CANCELLED', reason: 'out of stock today' } }));
    const ins = expectData<any>(await get(v1.manager, '/vendor/insights'));
    expect(ins.totals.cancelled).toBeGreaterThanOrEqual(1);
    expect(ins.byStatus.CANCELLED).toBeGreaterThanOrEqual(1);
    expect(ins.medianAcceptMinutes).not.toBeNull();
    expect(ins.medianPrepMinutes).not.toBeNull();
    const empty = expectData<any>(await get(v2.manager, '/vendor/insights', { from: '2020-01-01', to: '2020-01-31' }));
    expect(empty).toMatchObject({ totals: { received: 0, averageMinor: null }, medianAcceptMinutes: null, topProducts: [] });
  });

  it('earnings: a completed order shows the goods value and the commission the platform recognized — never a payout or balance — and only for this vendor', async () => {
    await s.driver({ lat: 30.42, lng: 31.56 }); // the first driver is busy with an order an earlier test prepared
    const e = await place([[p1, 3]]); // 300.00 goods, 10% commission
    await s.vendorPrepares(v1, e.order.id);
    const d = await s.driverAssignedTo(e.order.id);
    const delivery = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: d.accessToken })).find((x) => x.orderId === e.order.id);
    const step = (status: string, extra: Record<string, unknown> = {}) => world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: d.accessToken, body: { status, ...extra } });
    expectData(await step('PICKED_UP'));
    expectData(await step('ON_THE_WAY'));
    expectData(await step('DELIVERED', { proofPhotoUrl: await s.uploadFakePhoto(d.accessToken) }));

    const earn = await get(v1.manager, '/vendor/earnings');
    const row = earn.body.data.items.find((r: any) => r.orderNumber === e.order.orderNumber);
    expect(row).toMatchObject({ goodsMinor: 30000, commissionMinor: 3000 });
    expect(earn.body.data.totals.orders).toBeGreaterThanOrEqual(1);
    expect(earn.body.data.totals.commissionMinor).toBeGreaterThanOrEqual(3000);
    expect(JSON.stringify(earn.body)).not.toMatch(/payout|balance|net|Private Customer Name/i);
    expect((await get(v2.manager, '/vendor/earnings')).body.data.items).toEqual([]);
    expect((await get(v1.manager, '/vendor/earnings', { branchId: v2.branchId })).status).toBe(404);
  });

  it('branch profile: anyone linked may open/close, only a manager edits hours and preparation time, validation is strict, a deactivated branch cannot be opened, every change is audited', async () => {
    const path = `/vendor/branches/${v1.branchId}`;
    const patch = (a: Actor, body: unknown) => world.api('patch', path, { token: a.accessToken, body: body as object });
    expect(expectData<any>(await get(operator, path))).toMatchObject({ id: v1.branchId, canEditProfile: false });
    expect(expectData<any>(await get(v1.manager, path)).canEditProfile).toBe(true);

    expect(expectData<any>(await patch(operator, { isOpen: true })).isOpen).toBe(true);
    expect(expectData<any>(await patch(operator, { isOpen: false })).isOpen).toBe(false);
    const hours = { mon: { open: '09:00', close: '22:30' }, fri: { open: '14:00', close: '23:00' } };
    const denied = await patch(operator, { openingHours: hours });
    expect(denied.status).toBe(403);
    expect(denied.body.error.details.code).toBe('MANAGER_ONLY');
    expect((await patch(operator, { preparationTimeMinutes: 20 })).status).toBe(403);

    const saved = expectData<any>(await patch(v1.manager, { openingHours: hours, preparationTimeMinutes: 25 }));
    expect(saved).toMatchObject({ openingHours: hours, preparationTimeMinutes: 25 });
    expect((await patch(v1.manager, { openingHours: { mon: { open: '9am', close: '22:00' } } })).status).toBe(400);
    expect((await patch(v1.manager, { openingHours: { funday: { open: '09:00', close: '10:00' } } })).status).toBe(400);
    expect((await patch(v1.manager, { preparationTimeMinutes: 0 })).status).toBe(400);
    expect((await patch(v1.manager, { preparationTimeMinutes: 601 })).status).toBe(400);
    expect((await patch(v1.manager, { isOpen: 'yes' })).status).toBe(400);
    expect((await patch(v1.manager, { commissionRateBasisPoints: 0 })).status).toBe(400); // commission and activation stay Admin-only
    expect((await patch(v1.manager, { name: 'Hijack' })).status).toBe(400);
    expect((await patch(v1.manager, {})).status).toBe(400);
    expect(expectData<any>(await patch(v1.manager, { preparationTimeMinutes: null })).preparationTimeMinutes).toBeNull();

    // another vendor's branch: not found, for read and write
    expect((await world.api('patch', path, { token: v2.manager.accessToken, body: { isOpen: true } })).status).toBe(404);
    expect((await get(v2.manager, path)).status).toBe(404);
    expect((await world.api('patch', path, { token: (await s.customer()).accessToken, body: { isOpen: true } })).status).toBe(403);

    await world.ds.query('UPDATE vendor_branches SET is_active = false WHERE id = $1', [v1.branchId]);
    const blocked = await patch(v1.manager, { isOpen: true });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details.code).toBe('BRANCH_DEACTIVATED');
    expect(expectData<any>(await patch(v1.manager, { isOpen: false })).isOpen).toBe(false); // closing is always allowed
    await world.ds.query('UPDATE vendor_branches SET is_active = true WHERE id = $1', [v1.branchId]);

    const audited = await world.ds.query("SELECT actor_role, metadata FROM admin_audit_logs WHERE action = 'vendor_branch.updated' AND target_id = $1 ORDER BY created_at", [v1.branchId]);
    expect(audited.length).toBeGreaterThanOrEqual(5);
    expect(audited.some((r: any) => r.actor_role === 'VENDOR' && r.metadata.fields.includes('isOpen'))).toBe(true);
    expect(audited.some((r: any) => r.actor_role === 'VENDOR_MANAGER' && r.metadata.fields.includes('openingHours'))).toBe(true);
  });
});
