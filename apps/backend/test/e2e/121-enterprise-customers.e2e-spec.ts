/**
 * Enterprise customer management over real HTTP / PostgreSQL: PII masking by permission (list, detail, orders), audited reveal,
 * block/unblock (login refused, reversible, audited), append-only notes, wallet adjustments with two-person control and an
 * overdraw guard (one ledger row only), review moderation that recomputes the denormalised counters transactionally.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, expectData, DEFAULT_PASSWORD } from './support/actors';
import { boundary } from './support/external-boundary';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — Enterprise customers (masking, reveal, block, notes, wallet adjustments, moderation)', () => {
  let world: World;
  let s: Scenario;
  let superAdmin: Actor;
  let area: { id: string };
  const home = { lat: 30.425, lng: 31.565 };
  const num = (v: unknown) => Number(v);
  const get = (a: Actor, path: string, query?: Record<string, string | number>) => world.api('get', path, { token: a.accessToken, query });
  const post = (a: Actor, path: string, body: unknown = {}, headers?: Record<string, string>) => world.api('post', path, { token: a.accessToken, body, headers });
  let n = 0;
  const vendorWithProduct = async () => {
    n += 1;
    const v = await s.vendor({ name: `Cust ${n}`, serviceAreaId: area.id, lat: 30.42 + n * 0.001, lng: 31.56 + n * 0.001 });
    return { v, product: await s.product(v, { priceMinor: 10000, inventoryMode: 'OPEN' }) };
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

  it('masks name and phone in the list, detail and orders unless VIEW_CUSTOMER_PII; reveal is audited and returns the value', async () => {
    const { v, product } = await vendorWithProduct();
    const c = await s.customer('Layla Mostafa');
    const order = await s.simpleOrder(c, v, product.id, home);
    const viewer = await s.admin([Permission.VIEW_CUSTOMERS, Permission.VIEW_ORDERS]);
    const pii = await s.admin([Permission.VIEW_CUSTOMERS, Permission.VIEW_ORDERS, Permission.VIEW_CUSTOMER_PII]);

    const list = (await get(viewer, '/admin/customers', { search: c.phone.slice(-6) })).body.data as any[];
    const row = list.find((x) => x.id === c.id);
    expect(row.phone).toContain('•');
    expect(row.phone).not.toBe(c.phone);
    expect(row.fullName).toBe('Layla M.');
    const clear = ((await get(pii, '/admin/customers', { search: c.phone.slice(-6) })).body.data as any[]).find((x) => x.id === c.id);
    expect(clear.phone).toBe(c.phone);

    const detail = expectData<any>(await get(viewer, `/admin/customers/${c.id}`));
    expect(detail.phone).toContain('•');
    expect(detail.recentOrders[0].customer.phone).toContain('•');
    const orderView = expectData<any>(await get(viewer, `/admin/orders/${order.id}`));
    expect(orderView.customer.phone).toContain('•');
    expect(expectData<any>(await get(pii, `/admin/orders/${order.id}`)).customer.phone).toBe(c.phone);
    const searchRows = (await get(viewer, '/admin/orders', { search: order.orderNumber })).body.data as any[];
    expect(searchRows[0].customer.phone).toContain('•');

    expect((await post(viewer, `/admin/customers/${c.id}/reveal`, { field: 'PHONE' })).status).toBe(403);
    const reveal = expectData<any>(await post(pii, `/admin/customers/${c.id}/reveal`, { field: 'PHONE' }), 201);
    expect(reveal.value).toBe(c.phone);
    expect((await post(pii, `/admin/customers/${c.id}/reveal`, { field: 'PASSWORD' })).status).toBe(400);
    const audit = await world.ds.query(`SELECT metadata FROM admin_audit_logs WHERE action = 'customer.pii_revealed' AND target_id = $1`, [c.id]);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0].metadata)).not.toContain(c.phone); // the value itself is never recorded
  });

  it('block refuses login and is reversible; both need a reason, MANAGE_CUSTOMERS, and are audited; staff cannot be blocked this way', async () => {
    const c = await s.customer('To Block');
    const manager = await s.admin([Permission.MANAGE_CUSTOMERS, Permission.VIEW_CUSTOMERS]);
    const viewer = await s.admin([Permission.VIEW_CUSTOMERS]);
    expect((await post(viewer, `/admin/customers/${c.id}/block`, { reason: 'abusive behaviour' })).status).toBe(403);
    expect((await post(manager, `/admin/customers/${c.id}/block`, { reason: 'x' })).status).toBe(400);
    expectData(await post(manager, `/admin/customers/${c.id}/block`, { reason: 'Repeated abusive calls to support' }), 201);
    const denied = await world.api('post', '/auth/customer/password/login', { body: { phone: c.phone, password: DEFAULT_PASSWORD } });
    expect(denied.status).toBeGreaterThanOrEqual(400);
    expect(expectData<any>(await get(manager, `/admin/customers/${c.id}/summary`)).isActive).toBe(false);
    expectData(await post(manager, `/admin/customers/${c.id}/unblock`, { reason: 'Resolved with the customer' }), 201);
    const ok = await world.api('post', '/auth/customer/password/login', { body: { phone: c.phone, password: DEFAULT_PASSWORD } });
    expect(ok.status).toBe(200);
    expect((await world.ds.query(`SELECT action FROM admin_audit_logs WHERE target_id = $1 AND action IN ('customer.blocked','customer.unblocked') ORDER BY created_at`, [c.id])).map((r: any) => r.action)).toEqual(['customer.blocked', 'customer.unblocked']);
    expect((await post(manager, `/admin/customers/${superAdmin.id}/block`, { reason: 'trying to block staff' })).status).toBe(404);
  });

  it('notes are append-only and permission-gated; the 360 sub-resources answer (orders, wallet needs financial access, addresses masked)', async () => {
    const { v, product } = await vendorWithProduct();
    const c = await s.customer('Notes Customer');
    await s.simpleOrder(c, v, product.id, home);
    const support = await s.admin([Permission.VIEW_CUSTOMERS, Permission.VIEW_ORDERS, Permission.MANAGE_CUSTOMERS]);
    expectData(await post(support, `/admin/customers/${c.id}/notes`, { body: 'Prefers calls after 6pm.' }), 201);
    expect((await post(support, `/admin/customers/${c.id}/notes`, { body: '   ' })).status).toBe(400);
    expect(expectData<any[]>(await get(support, `/admin/customers/${c.id}/notes`))).toHaveLength(1);
    expect(expectData<any[]>(await get(support, `/admin/customers/${c.id}/orders`)).length).toBeGreaterThanOrEqual(1);
    expect((await get(support, `/admin/customers/${c.id}/wallet`)).status).toBe(403);
    const fin = await s.admin([Permission.VIEW_CUSTOMERS, Permission.VIEW_FINANCIALS]);
    expect(expectData<any>(await get(fin, `/admin/customers/${c.id}/wallet`)).balanceMinor).toBe(0);
    const summary = expectData<any>(await get(fin, `/admin/customers/${c.id}/summary`));
    expect(summary.walletBalanceMinor).toBe(0);
    expect(expectData<any>(await get(support, `/admin/customers/${c.id}/summary`)).walletBalanceMinor).toBeUndefined();
    expect(Array.isArray(expectData(await get(support, `/admin/customers/${c.id}/addresses`)))).toBe(true);
    expect(Array.isArray(expectData(await get(support, `/admin/customers/${c.id}/ratings`)))).toBe(true);
    expect(Array.isArray(expectData(await get(support, `/admin/customers/${c.id}/coupons`)))).toBe(true);
  });

  describe('wallet adjustments (two-person control)', () => {
    let c: Actor;
    let requester: Actor;
    let approver: Actor;
    const adjust = (a: Actor, body: Record<string, unknown>, key = `adj-key-${Math.random().toString(36).slice(2, 12)}`) =>
      post(a, `/admin/customers/${c.id}/wallet/adjustments`, { reasonCode: 'GOODWILL', ...body }, { 'idempotency-key': key });
    const ledgerRows = () => world.ds.query(`SELECT amount_delta_minor, type FROM wallet_transactions WHERE customer_id = $1 AND type = 'ADJUSTMENT' ORDER BY created_at`, [c.id]);

    beforeAll(async () => {
      c = await s.customer('Wallet Customer');
      requester = await s.admin([Permission.MANAGE_CUSTOMER_WALLET, Permission.VIEW_CUSTOMERS, Permission.VIEW_FINANCIALS]);
      approver = await s.admin([Permission.WALLET_ADJUST_APPROVE, Permission.VIEW_FINANCIALS]);
    });

    it('requires a key, permission and valid amount; a small credit applies at once through the ledger', async () => {
      expect((await adjust(requester, { amountMinor: 1000 }, '')).status).toBe(400);
      expect((await adjust(await s.admin([Permission.VIEW_CUSTOMERS]), { amountMinor: 1000 })).status).toBe(403);
      expect((await adjust(requester, { amountMinor: 0 })).status).toBe(400);
      expect((await adjust(requester, { amountMinor: 1000, reasonCode: 'NOPE' })).status).toBe(400);
      expect((await adjust(requester, { amountMinor: 999_999_999 })).status).toBe(400);
      const ok = expectData<any>(await adjust(requester, { amountMinor: 2000, note: 'Late delivery apology' }, 'small-credit-key-1'), 201);
      expect(ok.adjustment.status).toBe('APPLIED');
      expect(ok.requiresApproval).toBe(false);
      expect(await ledgerRows()).toHaveLength(1);
      const replay = expectData<any>(await adjust(requester, { amountMinor: 2000, note: 'Late delivery apology' }, 'small-credit-key-1'), 201);
      expect(replay.replayed).toBe(true);
      expect(await ledgerRows()).toHaveLength(1); // never twice
      expect((await adjust(requester, { amountMinor: 2500 }, 'small-credit-key-1')).status).toBe(409);
    });

    it('a large adjustment waits for a DIFFERENT approver; the requester cannot approve; approval applies exactly once', async () => {
      const big = expectData<any>(await adjust(requester, { amountMinor: 20000 }), 201);
      expect(big.requiresApproval).toBe(true);
      expect(big.adjustment.status).toBe('PENDING');
      expect(await ledgerRows()).toHaveLength(1);

      const requesterApprover = await s.admin([Permission.MANAGE_CUSTOMER_WALLET, Permission.WALLET_ADJUST_APPROVE]);
      const own = expectData<any>(await adjust(requesterApprover, { amountMinor: 30000 }), 201);
      expect((await post(requesterApprover, `/admin/wallet-adjustments/${own.adjustment.id}/approve`, {})).status).toBe(403); // four-eyes

      expect((await post(requester, `/admin/wallet-adjustments/${big.adjustment.id}/approve`, {})).status).toBe(403); // no approver permission
      const [a1, a2] = await Promise.all([post(approver, `/admin/wallet-adjustments/${big.adjustment.id}/approve`, {}), post(approver, `/admin/wallet-adjustments/${big.adjustment.id}/approve`, {})]);
      expect([a1.status, a2.status].sort()).toEqual([201, 409]); // double-approve race: one wins
      const rows = await ledgerRows();
      expect(rows).toHaveLength(2);
      expect(num(rows[1].amount_delta_minor)).toBe(20000);
      const pending = (await get(approver, '/admin/wallet-adjustments', { status: 'PENDING' })).body.data as any[];
      expect(pending.some((x) => x.id === own.adjustment.id)).toBe(true);
      expectData(await post(approver, `/admin/wallet-adjustments/${own.adjustment.id}/reject`, { note: 'Not justified by the ticket' }), 201);
      expect((await post(approver, `/admin/wallet-adjustments/${own.adjustment.id}/reject`, { note: 'Not justified by the ticket' })).status).toBe(409);
    });

    it('a debit can never take the wallet below zero (checked under the wallet lock when it is applied)', async () => {
      const balance = (await ledgerRows()).reduce((t: number, r: any) => t + num(r.amount_delta_minor), 0);
      const overdraw = expectData<any>(await adjust(requester, { amountMinor: -(balance + 100) }), 201);
      expect(overdraw.adjustment.status).toBe('PENDING'); // large: waits for approval
      const refused = await post(approver, `/admin/wallet-adjustments/${overdraw.adjustment.id}/approve`, {});
      expect(refused.status).toBe(409);
      expect(refused.body.error.details.code).toBe('INSUFFICIENT_WALLET_BALANCE');
      expect((await ledgerRows()).reduce((t: number, r: any) => t + num(r.amount_delta_minor), 0)).toBe(balance); // nothing moved
      const small = expectData<any>(await adjust(requester, { amountMinor: -500 }), 201);
      expect(small.adjustment.status).toBe('APPLIED');
      expect((await ledgerRows()).reduce((t: number, r: any) => t + num(r.amount_delta_minor), 0)).toBe(balance - 500);
    });
  });

  it('hiding a rating recomputes the branch counters in the same transaction; unhide restores; never deleted', async () => {
    const { v, product } = await vendorWithProduct();
    const c = await s.customer();
    const order = await s.simpleOrder(c, v, product.id, home);
    const [seg] = await world.ds.query(`SELECT id FROM order_vendor_segments WHERE order_id = $1`, [order.id]);
    const c2 = await s.customer();
    const order2 = await s.simpleOrder(c2, v, product.id, home);
    const [seg2] = await world.ds.query(`SELECT id FROM order_vendor_segments WHERE order_id = $1`, [order2.id]);
    const r1 = (await world.ds.query(`INSERT INTO vendor_ratings (customer_id, order_vendor_segment_id, vendor_branch_id, stars, comment) VALUES ($1,$2,$3,5,'great') RETURNING id`, [c.id, seg.id, v.branchId]))[0].id;
    await world.ds.query(`INSERT INTO vendor_ratings (customer_id, order_vendor_segment_id, vendor_branch_id, stars, comment) VALUES ($1,$2,$3,1,'rude and abusive text')`, [c2.id, seg2.id, v.branchId]);
    await world.ds.query(`UPDATE vendor_branches SET rating_count = 2, rating_sum_stars = 6 WHERE id = $1`, [v.branchId]);
    const mod = await s.admin([Permission.MODERATE_REVIEWS]);
    const bad = (await world.ds.query(`SELECT id FROM vendor_ratings WHERE stars = 1 AND vendor_branch_id = $1`, [v.branchId]))[0].id;

    expect((await post(await s.admin([Permission.VIEW_CUSTOMERS]), `/admin/ratings/vendor/${bad}/hide`, { reason: 'abusive language' })).status).toBe(403);
    expect((await post(mod, `/admin/ratings/vendor/${bad}/hide`, { reason: 'x' })).status).toBe(400);
    expect((await post(mod, `/admin/ratings/nonsense/${bad}/hide`, { reason: 'abusive language' })).status).toBe(400);
    expectData(await post(mod, `/admin/ratings/vendor/${bad}/hide`, { reason: 'Abusive language in the comment' }), 201);
    let [b] = await world.ds.query(`SELECT rating_count, rating_sum_stars FROM vendor_branches WHERE id = $1`, [v.branchId]);
    expect([num(b.rating_count), num(b.rating_sum_stars)]).toEqual([1, 5]);
    const list = (await get(mod, '/admin/ratings', { target: 'vendor', hidden: 'true' })).body.data as any[];
    expect(list.map((x) => x.id)).toContain(bad);
    expect(await world.ds.query(`SELECT 1 FROM vendor_ratings WHERE id = $1`, [bad])).toHaveLength(1); // hidden, not deleted
    expectData(await post(mod, `/admin/ratings/vendor/${bad}/unhide`, {}), 201);
    [b] = await world.ds.query(`SELECT rating_count, rating_sum_stars FROM vendor_branches WHERE id = $1`, [v.branchId]);
    expect([num(b.rating_count), num(b.rating_sum_stars)]).toEqual([2, 6]);
    expect(r1).toBeDefined();
  });
});
