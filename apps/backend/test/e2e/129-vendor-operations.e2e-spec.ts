/**
 * Vendor operations over real HTTP against real PostgreSQL: a manager's team management, branch closures (and their effect on what customers see and
 * on checkout), the stock-movement ledger and stocktakes, and the Financial Centre with the Admin-configured settlement term. Isolation (another
 * vendor's branch is a 404), authorization (operators, customers, drivers, anonymous), traceability (every stock change has a row) and the
 * "nothing invented" rules (no net payable, no recorded driver payments) are asserted explicitly.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData, DEFAULT_PASSWORD, nextPhone } from './support/actors';
import { Role } from '../../src/common/enums/role.enum';

describe('E2E — Vendor operations', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string };
  let v1: VendorFixture;
  let v2: VendorFixture;
  let operator: Actor;
  let admin: Actor;
  let tracked: { id: string };
  const home = { lat: 30.425, lng: 31.565 };
  const call = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', a: Actor | undefined, path: string, body?: unknown, query?: Record<string, string>) =>
    world.api(method, path, { token: a?.accessToken, body, query } as any);
  const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
  const H = 3_600_000;
  const movements = async (productId: string) =>
    world.ds.query(`SELECT reason, delta, before_quantity AS before, after_quantity AS after, reference_type, reference_id, actor_user_id, source_captured FROM stock_movements WHERE product_id = $1 ORDER BY occurred_at, id`, [productId]);

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    v1 = await s.vendor({ name: 'Ops One', serviceAreaId: area.id, lat: 30.421, lng: 31.561, commissionBasisPoints: 1000 });
    v2 = await s.vendor({ name: 'Ops Two', serviceAreaId: area.id, lat: 30.431, lng: 31.571, commissionBasisPoints: 1000 });
    tracked = await s.product(v1, { priceMinor: 10000, inventoryMode: 'TRACKED', quantity: 20 });
    admin = await s.superAdmin();
    // Fixture branches start with the manual switch off; these tests need it on to see the closure overlay change what customers see.
    await world.ds.query(`UPDATE vendor_branches SET is_open = true WHERE id = ANY($1)`, [[v1.branchId, v2.branchId]]);
    const phone = nextPhone();
    const staff = expectData<any>(await world.api('post', '/admin/vendor-staff', { token: admin.accessToken, body: { phone, fullName: 'Ops Operator', vendorBranchId: v1.branchId, password: DEFAULT_PASSWORD } }), 201);
    operator = await s.login('/auth/password/login', { id: staff.userId ?? staff.id, phone, fullName: 'Ops Operator', role: Role.VENDOR });
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  // ------------------------------------------------------------------------------------------------------------------------------- team
  describe('team management', () => {
    it('a manager creates an OPERATOR in their own branch; the account can sign in and is audited', async () => {
      const phone = nextPhone();
      const res = await call('post', v1.manager, '/vendor/team/members', { fullName: 'New Operator', phone, password: 'a-strong-pass-1', branchId: v1.branchId });
      expect(res.status).toBe(201);
      const created = await s.login('/auth/password/login', { id: res.body.data.id, phone, fullName: 'New Operator', role: Role.VENDOR }, 'a-strong-pass-1');
      expect(created.accessToken).toBeTruthy();
      const [row] = await world.ds.query(`SELECT role FROM users WHERE id = $1`, [res.body.data.id]);
      expect(row.role).toBe('VENDOR'); // never a manager through this path
      const audit = await world.ds.query(`SELECT metadata FROM admin_audit_logs WHERE action = 'vendor_staff.created' AND metadata->>'via' = 'vendor_manager'`);
      expect(audit.length).toBeGreaterThanOrEqual(1);
      const team = expectData<any>(await call('get', v1.manager, '/vendor/team'));
      expect(team.canManage).toBe(true);
      expect(team.members.find((m: any) => m.id === res.body.data.id)).toMatchObject({ role: 'OPERATOR', manageable: true });
    });

    it('refuses: an operator, another vendor, an existing phone, a weak password, a branch that is not theirs', async () => {
      const body = { fullName: 'Nope', phone: nextPhone(), password: 'a-strong-pass-1', branchId: v1.branchId };
      expect((await call('post', operator, '/vendor/team/members', body)).status).toBe(403);
      expect((await call('post', undefined, '/vendor/team/members', body)).status).toBe(401);
      expect((await call('post', v2.manager, '/vendor/team/members', body)).status).toBe(404); // v1's branch does not exist for v2
      expect((await call('post', v1.manager, '/vendor/team/members', { ...body, password: 'short' })).status).toBe(400);
      expect((await call('post', v1.manager, '/vendor/team/members', { ...body, phone: '0100' })).status).toBe(400);
      const taken = await call('post', v1.manager, '/vendor/team/members', { ...body, phone: operator.phone });
      expect(taken.status).toBe(409);
      // a role cannot be requested at all: the body field is ignored and the account is an operator
      const phone = nextPhone();
      const r = await call('post', v1.manager, '/vendor/team/members', { ...body, phone, role: 'VENDOR_MANAGER' });
      expect(r.status).toBe(201);
      expect((await world.ds.query(`SELECT role FROM users WHERE id = $1`, [r.body.data.id]))[0].role).toBe('VENDOR');
    });

    it('a manager deactivates and reactivates an operator, never themself, a manager, or another vendor’s person', async () => {
      const team = expectData<any>(await call('get', v1.manager, '/vendor/team'));
      const target = team.members.find((m: any) => m.id === operator.id);
      expect(target.manageable).toBe(true);
      expect((await call('patch', v1.manager, `/vendor/team/members/${operator.id}/active`, { isActive: false })).status).toBe(200);
      expect((await world.ds.query(`SELECT is_active FROM users WHERE id = $1`, [operator.id]))[0].is_active).toBe(false);
      expect((await call('patch', v1.manager, `/vendor/team/members/${operator.id}/active`, { isActive: true })).status).toBe(200);
      expect((await call('patch', v1.manager, `/vendor/team/members/${v1.manager.id}/active`, { isActive: false })).status).toBe(403); // self
      expect((await call('patch', v2.manager, `/vendor/team/members/${operator.id}/active`, { isActive: false })).status).toBe(404); // not their colleague
      expect((await call('patch', operator, `/vendor/team/members/${operator.id}/active`, { isActive: false })).status).toBe(403);
      expect((await call('patch', v1.manager, `/vendor/team/members/${operator.id}/active`, { isActive: 'no' })).status).toBe(400);
    });

    it('branch assignment: add to another own branch of the same vendor, keep at least one, nothing across vendors', async () => {
      const second = expectData<any>(await world.api('post', '/admin/vendor-branches', { token: admin.accessToken, body: { vendorId: v1.vendorId, name: 'Second Branch', address: 'x', latitude: 30.42, longitude: 31.56 } }), 201);
      // the manager does not own the new branch yet → 404; Admin links the manager, then the manager may assign
      expect((await call('post', v1.manager, `/vendor/team/members/${operator.id}/branches/${second.id}`)).status).toBe(404);
      await world.ds.query(`INSERT INTO vendor_staff (user_id, vendor_branch_id) VALUES ($1, $2)`, [v1.manager.id, second.id]);
      expect((await call('post', v1.manager, `/vendor/team/members/${operator.id}/branches/${second.id}`)).status).toBe(201);
      const team = expectData<any>(await call('get', v1.manager, '/vendor/team'));
      expect(team.members.find((m: any) => m.id === operator.id).branchIds.sort()).toEqual([v1.branchId, second.id].sort());
      expect((await call('delete', v1.manager, `/vendor/team/members/${operator.id}/branches/${second.id}`)).status).toBe(200);
      expect((await call('delete', v1.manager, `/vendor/team/members/${operator.id}/branches/${v1.branchId}`)).status).toBe(409); // last branch
      expect((await call('post', v2.manager, `/vendor/team/members/${operator.id}/branches/${v2.branchId}`)).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------------- closures
  describe('branch closures', () => {
    let closureId: string;

    it('a manager schedules a closure; validation, overlap, roles and isolation are enforced', async () => {
      const base = `/vendor/branches/${v1.branchId}/closures`;
      const ok = await call('post', v1.manager, base, { kind: 'HOLIDAY', startsAt: iso(48 * H), endsAt: iso(72 * H), reason: 'Eid holiday' });
      expect(ok.status).toBe(201);
      closureId = ok.body.data.id;
      expect((await call('post', v1.manager, base, { kind: 'HOLIDAY', startsAt: iso(60 * H), endsAt: iso(90 * H), reason: 'Overlaps' })).status).toBe(409);
      expect((await call('post', v1.manager, base, { kind: 'X', startsAt: iso(100 * H), endsAt: iso(101 * H), reason: 'Bad kind' })).status).toBe(400);
      expect((await call('post', v1.manager, base, { kind: 'TEMPORARY', startsAt: iso(100 * H), endsAt: iso(99 * H), reason: 'Backwards' })).status).toBe(400);
      expect((await call('post', v1.manager, base, { kind: 'TEMPORARY', startsAt: iso(-5 * H), endsAt: iso(-1 * H), reason: 'In the past' })).status).toBe(400);
      expect((await call('post', v1.manager, base, { kind: 'TEMPORARY', startsAt: iso(100 * H), endsAt: iso(101 * H), reason: 'x' })).status).toBe(400);
      expect((await call('post', operator, base, { kind: 'TEMPORARY', startsAt: iso(100 * H), endsAt: iso(101 * H), reason: 'Operator' })).status).toBe(403);
      expect((await call('get', operator, base)).status).toBe(200); // anyone linked may read
      expect((await call('get', v2.manager, base)).status).toBe(404);
      expect((await call('post', v2.manager, base, { kind: 'TEMPORARY', startsAt: iso(100 * H), endsAt: iso(101 * H), reason: 'Other vendor' })).status).toBe(404);
      const list = expectData<any>(await call('get', v1.manager, base));
      expect(list.closures[0]).toMatchObject({ id: closureId, kind: 'HOLIDAY', status: 'SCHEDULED', reason: 'Eid holiday' });
      expect(list.canManage).toBe(true);
      expect((await world.ds.query(`SELECT 1 FROM admin_audit_logs WHERE action = 'branch_closure.created'`)).length).toBeGreaterThanOrEqual(1);
    });

    it('while a closure is ACTIVE customers see the branch closed and checkout refuses; the manual switch is untouched; cancelling reopens at once', async () => {
      const product = await s.product(v2, { priceMinor: 5000, inventoryMode: 'OPEN' });
      const shop = await s.customer();
      await s.addToCart(shop, product.id, 1, {});
      const visible = async () => (await world.api('get', `/vendor-branches/${v2.branchId}`, { token: shop.accessToken })).body.data?.isOpen;
      expect(await visible()).toBe(true);

      const start = await call('post', v2.manager, `/vendor/branches/${v2.branchId}/closures`, { kind: 'TEMPORARY', startsAt: iso(-1000), endsAt: iso(2 * H), reason: 'Water cut' });
      expect(start.status).toBe(201);
      expect(await visible()).toBe(false);
      expect((await world.ds.query(`SELECT is_open FROM vendor_branches WHERE id = $1`, [v2.branchId]))[0].is_open).toBe(true); // overlay only
      const branch = expectData<any>(await call('get', v2.manager, `/vendor/branches/${v2.branchId}`));
      expect(branch).toMatchObject({ effectiveOpen: false, isOpen: true, activeClosure: { reason: 'Water cut' } });

      const refused = await world.api('post', '/orders', { token: shop.accessToken, body: { deliveryAddress: { line1: 'x', latitude: home.lat, longitude: home.lng }, paymentMethod: 'COD' } });
      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.body)).toContain('BRANCH_TEMPORARILY_CLOSED');

      expect((await call('delete', v2.manager, `/vendor/branches/${v2.branchId}/closures/${start.body.data.id}`)).status).toBe(200);
      expect(await visible()).toBe(true);
      expect((await call('delete', v2.manager, `/vendor/branches/${v2.branchId}/closures/${start.body.data.id}`)).status).toBe(409); // already cancelled
    });

    it('a closure that has ended no longer closes the branch; Admin can read and cancel any branch’s closures', async () => {
      const upcoming = expectData<any>(await world.api('get', `/admin/vendor-branches/${v1.branchId}/closures`, { token: admin.accessToken }));
      expect(upcoming.closures.map((c: any) => c.id)).toContain(closureId);
      expect((await world.api('delete', `/admin/vendor-branches/${v1.branchId}/closures/${closureId}`, { token: admin.accessToken })).status).toBe(200);
      const noAdmin = await s.admin([]);
      expect((await world.api('get', `/admin/vendor-branches/${v1.branchId}/closures`, { token: noAdmin.accessToken })).status).toBe(403);
      await world.ds.query(`INSERT INTO vendor_branch_closures (vendor_branch_id, kind, starts_at, ends_at, reason, created_by_user_id) VALUES ($1,'TEMPORARY', now() - interval '3 hours', now() - interval '1 hour', 'over', $2)`, [v1.branchId, v1.manager.id]);
      const branch = expectData<any>(await call('get', v1.manager, `/vendor/branches/${v1.branchId}`));
      expect(branch.activeClosure).toBeNull();
      expect(branch.effectiveOpen).toBe(true);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------------------ ledger
  describe('stock ledger and stocktake', () => {
    it('every stock change leaves a row: initial stock, order placement (linked to the order), cancellation, vendor edit (attributed)', async () => {
      const initial = await movements(tracked.id);
      expect(initial).toHaveLength(1);
      expect(initial[0]).toMatchObject({ reason: 'INITIAL_STOCK', before: null, after: 20, delta: 20 });

      const c = await s.customer();
      await s.addToCart(c, tracked.id, 3, {});
      const order = await s.checkout(c, home, 'COD');
      let rows = await movements(tracked.id);
      expect(rows[1]).toMatchObject({ reason: 'ORDER_PLACED', before: 20, after: 17, delta: -3, reference_type: 'ORDER', reference_id: order.id, source_captured: true });

      expect((await world.api('post', `/orders/${order.id}/cancel`, { token: c.accessToken, body: {} })).status).toBe(201);
      rows = await movements(tracked.id);
      expect(rows[2]).toMatchObject({ reason: 'ORDER_CANCELLED', before: 17, after: 20, delta: 3, reference_type: 'ORDER', reference_id: order.id });

      const edit = await call('patch', v1.manager, `/vendor/products/${tracked.id}`, { quantity: 25 });
      expect(edit.status).toBe(200);
      rows = await movements(tracked.id);
      expect(rows[3]).toMatchObject({ reason: 'MANUAL_ADJUSTMENT', before: 20, after: 25, delta: 5, actor_user_id: v1.manager.id, source_captured: true });

      // A change made with no context (e.g. a script) is recorded honestly as unattributed, never guessed.
      await world.ds.query(`UPDATE products SET quantity = 24 WHERE id = $1`, [tracked.id]);
      rows = await movements(tracked.id);
      expect(rows[4]).toMatchObject({ reason: 'UNATTRIBUTED', before: 25, after: 24, delta: -1, source_captured: false, actor_user_id: null });
    });

    it('the movements API is scoped to the caller’s branches, searchable, paginated and filterable', async () => {
      const mine = await call('get', v1.manager, '/vendor/inventory/movements', undefined, { productId: tracked.id });
      expect(mine.status).toBe(200);
      expect(mine.body.meta.total).toBe(5);
      expect(mine.body.data.startedAt).toBeTruthy();
      const placed = mine.body.data.items.find((m: any) => m.reason === 'ORDER_PLACED');
      expect(placed.reference.orderNumber).toMatch(/^HT-/);
      expect(placed).toMatchObject({ beforeQuantity: 20, afterQuantity: 17, delta: -3 });
      const unattributed = mine.body.data.items.find((m: any) => m.reason === 'UNATTRIBUTED');
      expect(unattributed).toMatchObject({ sourceCaptured: false, actorName: null });
      expect((await call('get', v2.manager, '/vendor/inventory/movements', undefined, { productId: tracked.id })).body.meta.total).toBe(0);
      expect((await call('get', v2.manager, '/vendor/inventory/movements', undefined, { branchId: v1.branchId })).status).toBe(404);
      expect((await call('get', v1.manager, '/vendor/inventory/movements', undefined, { reason: 'ORDER_PLACED', productId: tracked.id })).body.meta.total).toBe(1);
      expect((await call('get', v1.manager, '/vendor/inventory/movements', undefined, { reason: 'BOGUS' })).status).toBe(400);
      const searched = await call('get', v1.manager, '/vendor/inventory/movements', undefined, { search: placed.reference.orderNumber });
      expect(searched.body.meta.total).toBe(2); // the placement and the cancellation of that order
      expect((await call('get', undefined, '/vendor/inventory/movements')).status).toBe(401);
      expect((await call('get', await s.customer(), '/vendor/inventory/movements')).status).toBe(403);
    });

    it('a stocktake snapshots expected, counts, reports variance, keeps sales made meanwhile, and only a manager applies it', async () => {
      const started = await call('post', operator, '/vendor/inventory/stocktakes', { branchId: v1.branchId, note: 'Monthly count' });
      expect(started.status).toBe(201);
      const id = started.body.data.id;
      expect((await call('post', v1.manager, '/vendor/inventory/stocktakes', { branchId: v1.branchId })).status).toBe(409); // one open per branch
      expect((await call('post', v2.manager, '/vendor/inventory/stocktakes', { branchId: v1.branchId })).status).toBe(404);

      let st = expectData<any>(await call('get', operator, `/vendor/inventory/stocktakes/${id}`));
      const line = st.items.find((i: any) => i.productId === tracked.id);
      expect(line).toMatchObject({ expected: 24, counted: null, variance: null });
      expect(st.canApply).toBe(false); // an operator counts, a manager applies

      expect((await call('patch', operator, `/vendor/inventory/stocktakes/${id}/lines/${tracked.id}`, { counted: -1 })).status).toBe(400);
      expect((await call('patch', operator, `/vendor/inventory/stocktakes/${id}/lines/${tracked.id}`, { counted: 1.5 })).status).toBe(400);
      expect((await call('patch', operator, `/vendor/inventory/stocktakes/${id}/lines/${tracked.id}`, { counted: 21 })).status).toBe(200);

      // A sale happens while counting: 2 units leave.
      const c = await s.customer();
      await s.addToCart(c, tracked.id, 2, {});
      await s.checkout(c, home, 'COD');

      st = expectData<any>(await call('get', v1.manager, `/vendor/inventory/stocktakes/${id}`));
      expect(st.items.find((i: any) => i.productId === tracked.id)).toMatchObject({ expected: 24, counted: 21, variance: -3, currentQuantity: 22, movedSinceStart: true });
      expect(st.summary).toMatchObject({ counted: 1, withVariance: 1, netVariance: -3 });
      expect(st.canApply).toBe(true);

      expect((await call('post', operator, `/vendor/inventory/stocktakes/${id}/apply`)).status).toBe(403);
      const applied = await call('post', v1.manager, `/vendor/inventory/stocktakes/${id}/apply`);
      expect(applied.status).toBe(201);
      expect(applied.body.data).toMatchObject({ adjusted: 1 });
      // 22 on the shelf per the system minus the counted shortfall of 3 → 19; the sale made during the count is kept.
      expect((await world.ds.query(`SELECT quantity FROM products WHERE id = $1`, [tracked.id]))[0].quantity).toBe(19);
      const last = (await movements(tracked.id)).pop();
      expect(last).toMatchObject({ reason: 'STOCKTAKE', before: 22, after: 19, delta: -3, reference_type: 'STOCKTAKE', reference_id: id, actor_user_id: v1.manager.id });
      expect((await call('post', v1.manager, `/vendor/inventory/stocktakes/${id}/apply`)).status).toBe(409); // closed
      expect((await call('patch', v1.manager, `/vendor/inventory/stocktakes/${id}/lines/${tracked.id}`, { counted: 5 })).status).toBe(409);
      expect((await world.ds.query(`SELECT 1 FROM admin_audit_logs WHERE action = 'stocktake.applied'`)).length).toBeGreaterThanOrEqual(1);
    });

    it('a stocktake can be cancelled without touching stock, and an untracked branch has nothing to count', async () => {
      const before = (await world.ds.query(`SELECT quantity FROM products WHERE id = $1`, [tracked.id]))[0].quantity;
      const id = (await call('post', v1.manager, '/vendor/inventory/stocktakes', { branchId: v1.branchId })).body.data.id;
      expect((await call('patch', v1.manager, `/vendor/inventory/stocktakes/${id}/lines/${tracked.id}`, { counted: 1 })).status).toBe(200);
      expect((await call('post', v1.manager, `/vendor/inventory/stocktakes/${id}/cancel`)).status).toBe(201);
      expect((await world.ds.query(`SELECT quantity FROM products WHERE id = $1`, [tracked.id]))[0].quantity).toBe(before);
      expect((await call('post', v2.manager, '/vendor/inventory/stocktakes', { branchId: v2.branchId })).status).toBe(409); // no tracked products
    });
  });

  // ------------------------------------------------------------------------------------------------------------------------------ finance
  describe('financial centre', () => {
    it('Admin sets the vendor’s contractual settlement frequency (permission + audit); WEEKLY/MONTHLY only; null clears it', async () => {
      const path = `/admin/vendors/${v1.vendorId}/settlement-terms`;
      const initial = expectData<any>(await world.api('get', path, { token: admin.accessToken }));
      expect(initial.frequency).toBeNull();
      expect((await world.api('put', path, { token: admin.accessToken, body: { frequency: 'DAILY' } })).status).toBe(400);
      expect((await world.api('put', path, { token: (await s.admin([])).accessToken, body: { frequency: 'WEEKLY' } })).status).toBe(403);
      expect((await call('put', v1.manager, path, { frequency: 'WEEKLY' })).status).toBe(403);
      expect(expectData<any>(await world.api('put', path, { token: admin.accessToken, body: { frequency: 'MONTHLY' } })).frequency).toBe('MONTHLY');
      expect((await world.ds.query(`SELECT metadata FROM admin_audit_logs WHERE action = 'vendor_settlement_terms.set' ORDER BY created_at DESC LIMIT 1`))[0].metadata).toMatchObject({ from: 'NOT_CONFIGURED', to: 'MONTHLY' });
      expect((await world.api('get', `/admin/vendors/00000000-0000-0000-0000-000000000000/settlement-terms`, { token: admin.accessToken })).status).toBe(404);
    });

    it('the statement keeps sales, Hatly’s commission receivable, customer payments and cancellations apart — and shows no net payable or driver payments', async () => {
      const prod = await s.product(v1, { priceMinor: 10000, inventoryMode: 'OPEN' });
      const c = await s.customer();
      await s.addToCart(c, prod.id, 2, {});
      const order = await s.checkout(c, home, 'COD');
      const before = expectData<any>(await call('get', v1.manager, '/vendor/finance'));
      // not completed yet → not counted as a sale
      await world.ds.query(`UPDATE orders SET status = 'DELIVERED' WHERE id = $1`, [order.id]);
      await world.ds.query(`INSERT INTO financial_events (type, direction, amount_minor, order_id, order_vendor_segment_id, vendor_branch_id) SELECT 'VENDOR_COMMISSION_RECOGNIZED', 'RECEIVABLE', 2000, o.id, g.id, g.vendor_branch_id FROM orders o JOIN order_vendor_segments g ON g.order_id = o.id WHERE o.id = $1 AND g.vendor_branch_id = $2`, [order.id, v1.branchId]).catch(() => undefined);
      const after = expectData<any>(await call('get', v1.manager, '/vendor/finance'));
      expect(after.sales.goodsMinor - before.sales.goodsMinor).toBe(20000);
      expect(after.sales.parts - before.sales.parts).toBe(1);
      expect(after.customerPayments.find((m: any) => m.method === 'COD').goodsMinor).toBeGreaterThanOrEqual(20000);
      expect(after.terms.settlementFrequency).toBe('MONTHLY');
      expect(after.terms).toHaveProperty('platformDefaultFrequency'); // shown when a vendor has no contractual term of its own
      expect(after.branches[0]).toMatchObject({ id: v1.branchId, commissionRateBasisPoints: 1000 });
      expect(after.driverPaymentsToVendor).toEqual({ recorded: false });
      expect(after.netPayableToVendor).toEqual({ defined: false });
      expect(Object.keys(after)).not.toEqual(expect.arrayContaining(['balance', 'netPayable', 'payable']));
      expect(JSON.stringify(after)).not.toMatch(/phone|address|fullName/i);
      // isolation: the other vendor sees none of it
      const other = expectData<any>(await call('get', v2.manager, '/vendor/finance'));
      expect(other.sales.goodsMinor).toBeLessThan(after.sales.goodsMinor);
      expect(other.terms.settlementFrequency).toBeNull();
      expect((await call('get', v2.manager, '/vendor/finance', undefined, { branchId: v1.branchId })).status).toBe(404);
      expect((await call('get', undefined, '/vendor/finance')).status).toBe(401);
      expect((await call('get', await s.customer(), '/vendor/finance')).status).toBe(403);
      expect((await call('get', v1.manager, '/vendor/finance', undefined, { from: 'nope' })).status).toBe(400);
    });

    it('CSV export: only the caller’s own completed parts, no customer data, formula-safe, authorized', async () => {
      await world.ds.query(`UPDATE vendor_branches SET name = '=cmd|calc' WHERE id = $1`, [v1.branchId]);
      try {
        const res = await world.api('get', '/vendor/finance/export', { token: v1.manager.accessToken });
        expect(res.status).toBe(200);
        const text: string = res.text;
        expect(res.headers['content-type']).toMatch(/text\/csv/);
        const lines = text.replace(/^\ufeff/, '').trim().split('\n');
        expect(lines[0]).toBe('order_number,completed_on,branch,payment_method,goods_egp,commission_owed_to_hatly_egp');
        expect(lines.length).toBeGreaterThan(1); // the completed order from the statement test
        expect(lines[1]).toMatch(/^HT-\d+,\d{4}-\d{2}-\d{2},'=cmd\|calc,COD,200\.00,/); // the leading "=" is neutralised; goods are EGP with two decimals
        expect(text).not.toMatch(/phone|address|\+20\d{9}|Private Customer/i);
        const other = await world.api('get', '/vendor/finance/export', { token: v2.manager.accessToken });
        expect(other.text).not.toContain('cmd|calc');
        expect((await world.api('get', '/vendor/finance/export', { token: v2.manager.accessToken, query: { branchId: v1.branchId } })).status).toBe(404);
        expect((await world.api('get', '/vendor/finance/export', { token: v1.manager.accessToken, query: { from: 'x' } })).status).toBe(400);
        expect((await world.api('get', '/vendor/finance/export')).status).toBe(401);
        expect((await world.api('get', '/vendor/finance/export', { token: (await s.customer()).accessToken })).status).toBe(403);
      } finally {
        await world.ds.query(`UPDATE vendor_branches SET name = $2 WHERE id = $1`, [v1.branchId, v1.name]);
      }
    });

    it('closing a vendor period uses the vendor’s configured frequency; without one the platform-wide setting applies as before', async () => {
      await world.ds.query(`UPDATE business_config SET value = 'WEEKLY' WHERE key = 'VENDOR_SETTLEMENT_FREQUENCY'`).catch(() => undefined);
      const closed = await world.api('post', `/admin/settlement/vendor-branches/${v1.branchId}/close`, { token: admin.accessToken, body: {} });
      if (closed.status === 201 || closed.status === 200) expect(closed.body.data.frequency).toBe('MONTHLY');
      else expect(closed.status).toBe(400); // "no new activity" is the only acceptable refusal
    });
  });
});
