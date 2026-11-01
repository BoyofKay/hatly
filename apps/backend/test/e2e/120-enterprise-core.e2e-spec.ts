/**
 * Enterprise Admin Panel core, over real HTTP against real PostgreSQL:
 *  - permission templates are copied presets (system ones immutable, SUPER_ADMIN only, approvers in none);
 *  - executive KPIs (money only with VIEW_FINANCIALS; "no data" is null, never 0), alerts, search masking;
 *  - administrative cancel reuses the ordinary cancellation (refund/stock/discount effects), once, with notes + a merged timeline;
 *  - settlements follow B1/B5: a vendor period is Hatly's commission RECEIVABLE collected from the vendor, partial payments,
 *    authorised overpayment only with the dedicated permission, idempotent, void-by-reversal, closed ≠ paid;
 *  - the ledger needs a range, reconciliation reports balanced/mismatch honestly.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, expectData } from './support/actors';
import { boundary } from './support/external-boundary';
import { Permission } from '../../src/modules/permissions/permission.enum';
import { SYSTEM_TEMPLATES } from '../../src/modules/admin-platform/permission-templates/permission-templates.service';

describe('E2E — Enterprise Admin core (templates, KPIs, cancel, settlements, ledger)', () => {
  let world: World;
  let s: Scenario;
  let superAdmin: Actor;
  let area: { id: string };
  const home = { lat: 30.425, lng: 31.565 };
  const num = (v: unknown) => Number(v);
  /** The Africa/Cairo calendar date — report ranges are Cairo dates (UTC "today" is wrong for ~2 hours a day). */
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  const get = (a: Actor, path: string, query?: Record<string, string | number>) => world.api('get', path, { token: a.accessToken, query });
  let vendorCounter = 0;
  const newVendor = async () => {
    vendorCounter += 1;
    const v = await s.vendor({ name: `Ent ${vendorCounter}`, serviceAreaId: area.id, lat: 30.42 + vendorCounter * 0.001, lng: 31.56 + vendorCounter * 0.001 });
    return { v, product: await s.product(v, { priceMinor: 20000, inventoryMode: 'OPEN' }) };
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

  describe('permission templates', () => {
    it('lists the six system templates; none contains an approver or dangerous permission', async () => {
      const res = expectData<any[]>(await get(superAdmin, '/admin/permission-templates'));
      expect(res.map((t) => t.key).sort()).toEqual(['CATALOG', 'FINANCE', 'MARKETING', 'OPERATIONS', 'READ_ONLY', 'SUPPORT']);
      const forbidden = [Permission.CAMPAIGN_APPROVE, Permission.BROADCAST_APPROVE, Permission.WALLET_ADJUST_APPROVE, Permission.APPROVE_SETTLEMENT_OVERPAYMENT, Permission.MEDIA_DELETE, Permission.AUDIT_EXPORT, Permission.VIEW_AUDIT_LOG, Permission.MANAGE_BUSINESS_CONFIG, Permission.MANAGE_VENDORS];
      for (const t of SYSTEM_TEMPLATES) for (const p of forbidden) expect(t.permissions).not.toContain(p);
    });

    it('applying a template COPIES its permissions (ADD keeps existing grants, REPLACE makes them exact) and is SUPER_ADMIN only', async () => {
      const finance = expectData<any[]>(await get(superAdmin, '/admin/permission-templates')).find((t) => t.key === 'FINANCE');
      const readOnly = expectData<any[]>(await get(superAdmin, '/admin/permission-templates')).find((t) => t.key === 'READ_ONLY');
      const admin = await s.admin([Permission.MANAGE_OFFERS]);
      const add = expectData<any>(await world.api('post', `/admin/users/${admin.id}/apply-template`, { token: superAdmin.accessToken, body: { templateId: finance.id, mode: 'ADD' } }), 201);
      expect(add.added.length).toBeGreaterThan(5);
      const after = expectData<string[]>(await get(superAdmin, `/admin/users/${admin.id}/permissions`));
      expect(after).toContain(Permission.MANAGE_OFFERS);
      expect(after).toContain(Permission.VIEW_FINANCIALS);

      const replaced = expectData<any>(await world.api('post', `/admin/users/${admin.id}/apply-template`, { token: superAdmin.accessToken, body: { templateId: readOnly.id, mode: 'REPLACE' } }), 201);
      expect(replaced.removed).toContain(Permission.MANAGE_OFFERS);
      const exact = expectData<string[]>(await get(superAdmin, `/admin/users/${admin.id}/permissions`));
      expect([...exact].sort()).toEqual([...readOnly.permissions].sort());

      expect((await world.api('post', `/admin/users/${admin.id}/apply-template`, { token: admin.accessToken, body: { templateId: finance.id, mode: 'ADD' } })).status).toBe(403);
    });

    it('system templates cannot be edited or deleted; a custom template is validated against the catalogue', async () => {
      const list = expectData<any[]>(await get(superAdmin, '/admin/permission-templates'));
      const sys = list.find((t) => t.isSystem);
      expect((await world.api('patch', `/admin/permission-templates/${sys.id}`, { token: superAdmin.accessToken, body: { nameEn: 'x' } })).status).toBe(409);
      expect((await world.api('delete', `/admin/permission-templates/${sys.id}`, { token: superAdmin.accessToken })).status).toBe(409);
      expect((await world.api('post', '/admin/permission-templates', { token: superAdmin.accessToken, body: { key: 'BAD_ONE', nameEn: 'Bad', nameAr: 'سيئ', permissions: ['NOT_A_PERMISSION'] } })).status).toBe(400);
      const ok = expectData<any>(await world.api('post', '/admin/permission-templates', { token: superAdmin.accessToken, body: { key: 'CUSTOM_ONE', nameEn: 'Custom', nameAr: 'مخصص', permissions: [Permission.VIEW_ORDERS] } }), 201);
      expect(ok.isSystem).toBe(false);
      const edited = expectData<any>(await world.api('patch', `/admin/permission-templates/${ok.id}`, { token: superAdmin.accessToken, body: { nameEn: 'Custom 2', permissions: [Permission.VIEW_ORDERS, Permission.VIEW_CUSTOMERS] } }));
      expect(edited.nameEn).toBe('Custom 2');
      expect(edited.permissions).toEqual([Permission.VIEW_ORDERS, Permission.VIEW_CUSTOMERS]);
      expect((await world.api('delete', `/admin/permission-templates/${ok.id}`, { token: superAdmin.accessToken })).status).toBe(200);
    });
  });

  describe('executive KPIs, alerts and search', () => {
    it('KPIs are null (no data) for an empty period and money KPIs need VIEW_FINANCIALS', async () => {
      const analyst = await s.admin([Permission.VIEW_REPORTS]);
      const empty = expectData<any>(await get(analyst, '/admin/executive/kpis', { from: '2001-01-01', to: '2001-01-02' }));
      const placed = empty.kpis.find((k: any) => k.key === 'ordersPlaced');
      expect(placed.value).toBeNull();
      expect(empty.kpis.some((k: any) => k.key === 'gmvMinor')).toBe(false); // money hidden without VIEW_FINANCIALS
      const full = expectData<any>(await get(superAdmin, '/admin/executive/kpis', { from: '2001-01-01', to: '2001-01-02' }));
      expect(full.kpis.some((k: any) => k.key === 'gmvMinor')).toBe(true);
      expect(full.kpis.find((k: any) => k.key === 'gmvMinor').value).toBeNull();
      expect((await get(analyst, '/admin/executive/kpis', { from: '2001-01-05', to: '2001-01-01' })).status).toBe(400);
      expect((await get(analyst, '/admin/executive/kpis', { from: '2001-01-01', to: '2003-01-01' })).status).toBe(400);
      const noReports = await s.admin([Permission.VIEW_ORDERS]);
      expect((await get(noReports, '/admin/executive/kpis')).status).toBe(403);
    });

    it('KPIs count a real order, GMV equals the segment subtotal, and search masks customer PII without VIEW_CUSTOMER_PII', async () => {
      const { v, product } = await newVendor();
      const c = await s.customer('Mona Hassan');
      const order = await s.simpleOrder(c, v, product.id, home);
      const k = expectData<any>(await get(superAdmin, '/admin/executive/kpis', { from: today(), to: today() }));
      expect(k.kpis.find((x: any) => x.key === 'ordersPlaced').value).toBeGreaterThanOrEqual(1);
      expect(k.kpis.find((x: any) => x.key === 'gmvMinor').value).toBeGreaterThanOrEqual(20000);
      // The customer registered today and the order placed today are both counted; statuses are the orders' real ones.
      expect(k.kpis.find((x: any) => x.key === 'newCustomers').value).toBeGreaterThanOrEqual(1);
      const byStatus = k.ordersByStatus as Record<string, number>;
      expect(Object.values(byStatus).reduce((a, b) => a + b, 0)).toBe(k.kpis.find((x: any) => x.key === 'ordersPlaced').value);
      expect(byStatus[order.status]).toBeGreaterThanOrEqual(1);
      const old = expectData<any>(await get(superAdmin, '/admin/executive/kpis', { from: '2001-01-01', to: '2001-01-02' }));
      expect(old.ordersByStatus).toEqual({});
      expect(old.kpis.find((x: any) => x.key === 'newCustomers').value).toBe(0);

      const viewer = await s.admin([Permission.VIEW_CUSTOMERS]);
      const masked = expectData<any>(await get(viewer, '/admin/search', { q: c.phone.slice(-6) }));
      const cust = masked.groups.find((g: any) => g.type === 'customers');
      expect(cust.items[0].subtitle).toContain('•');
      expect(cust.items[0].subtitle).not.toBe(c.phone);
      const pii = await s.admin([Permission.VIEW_CUSTOMERS, Permission.VIEW_CUSTOMER_PII]);
      const clear = expectData<any>(await get(pii, '/admin/search', { q: c.phone.slice(-6) }));
      expect(clear.groups.find((g: any) => g.type === 'customers').items[0].subtitle).toBe(c.phone);
      expect((await get(viewer, '/admin/search', { q: 'a' })).status).toBe(400);
      expect(order.id).toBeDefined();
    });

    it('a stalled pending acceptance surfaces as a (real) alert, and can be acknowledged', async () => {
      const { v, product } = await newVendor();
      const c = await s.customer();
      const order = await s.simpleOrder(c, v, product.id, home);
      await world.ds.query(`UPDATE order_vendor_segments SET created_at = now() - interval '20 minutes' WHERE order_id = $1`, [order.id]);
      const ops = await s.admin([Permission.VIEW_ORDERS]);
      const alerts = expectData<any[]>(await get(ops, '/admin/alerts'));
      const a = alerts.find((x) => x.reason === 'PENDING_ACCEPTANCE_OVERDUE' && x.entityId === order.id);
      expect(a).toBeDefined();
      expect(a.acknowledged).toBe(false);
      expectData(await world.api('post', '/admin/alerts/acknowledge', { token: ops.accessToken, body: { key: a.key, note: 'calling the vendor' } }), 201);
      const again = expectData<any[]>(await get(ops, '/admin/alerts'));
      expect(again.find((x) => x.key === a.key).acknowledged).toBe(true);
    });
  });

  describe('administrative order cancellation, notes and timeline', () => {
    it('cancels through the ordinary state machine once, records a note, and the timeline shows it all; permissions are enforced', async () => {
      const { v, product } = await newVendor();
      const c = await s.customer();
      const order = await s.simpleOrder(c, v, product.id, home);
      const issuer = await s.admin([Permission.MANAGE_ORDER_ISSUES, Permission.VIEW_ORDERS]);
      const viewerOnly = await s.admin([Permission.VIEW_ORDERS]);

      expect((await world.api('post', `/admin/orders/${order.id}/cancel`, { token: viewerOnly.accessToken, body: { reasonCode: 'OTHER' } })).status).toBe(403);
      expect((await world.api('post', `/admin/orders/${order.id}/cancel`, { token: issuer.accessToken, body: { reasonCode: 'NOT_A_REASON' } })).status).toBe(400);
      expect(expectData<any>(await get(issuer, `/admin/orders/${order.id}/capabilities`)).adminCanCancel).toBe(true);

      const done = expectData<any>(await world.api('post', `/admin/orders/${order.id}/cancel`, { token: issuer.accessToken, body: { reasonCode: 'VENDOR_UNAVAILABLE', reasonText: 'Closed early' } }), 201);
      expect(done.status).toBe('CANCELLED');
      expect(done.cancelledByRole).toBe('ADMIN');
      expect((await world.ds.query('SELECT status FROM order_vendor_segments WHERE order_id = $1', [order.id])).every((r: any) => r.status === 'CANCELLED')).toBe(true);
      expect(expectData<any>(await get(issuer, `/admin/orders/${order.id}/capabilities`)).adminCanCancel).toBe(false);

      expect((await world.api('post', `/admin/orders/${order.id}/cancel`, { token: issuer.accessToken, body: { reasonCode: 'OTHER' } })).status).toBe(409);
      const audit = await world.ds.query(`SELECT * FROM admin_audit_logs WHERE action = 'order.admin_cancelled' AND target_id = $1`, [order.id]);
      expect(audit).toHaveLength(1);

      expectData(await world.api('post', `/admin/orders/${order.id}/notes`, { token: issuer.accessToken, body: { body: 'Customer called, apologised.' } }), 201);
      expect((await world.api('post', `/admin/orders/${order.id}/notes`, { token: viewerOnly.accessToken, body: { body: 'nope' } })).status).toBe(403);
      expect((await world.api('post', `/admin/orders/${order.id}/notes`, { token: issuer.accessToken, body: { body: '   ' } })).status).toBe(400);
      expect(expectData<any[]>(await get(viewerOnly, `/admin/orders/${order.id}/notes`))).toHaveLength(1);

      const timeline = expectData<any[]>(await get(viewerOnly, `/admin/orders/${order.id}/timeline`));
      const kinds = timeline.map((t) => t.kind);
      expect(kinds).toContain('STATUS');
      expect(kinds).toContain('NOTE');
      expect(timeline.find((t) => t.kind === 'STATUS' && t.title === 'CANCELLED')).toBeDefined();
      expect(timeline.every((t, i) => i === 0 || t.at >= timeline[i - 1].at)).toBe(true);
    });

    it('refuses to cancel after a driver was assigned (the failed-delivery flow applies)', async () => {
      const { v, product } = await newVendor();
      const c = await s.customer();
      const order = await s.simpleOrder(c, v, product.id, home);
      await world.ds.query(`UPDATE orders SET status = 'PICKED_UP' WHERE id = $1`, [order.id]);
      const issuer = await s.admin([Permission.MANAGE_ORDER_ISSUES]);
      const res = await world.api('post', `/admin/orders/${order.id}/cancel`, { token: issuer.accessToken, body: { reasonCode: 'OTHER' } });
      expect(res.status).toBe(409);
      expect(res.body.error.details.code).toBe('STATE_CONFLICT');
    });

    it('the order search filters by vendor branch and Cairo dates', async () => {
      const { v, product } = await newVendor();
      const other = await newVendor();
      const c = await s.customer();
      const order = await s.simpleOrder(c, v, product.id, home);
      const viewer = await s.admin([Permission.VIEW_ORDERS]);
      const ids = (r: any) => (r.body.data as any[]).map((o) => o.id);
      expect(ids(await get(viewer, '/admin/orders', { vendorBranchId: v.branchId }))).toContain(order.id);
      expect(ids(await get(viewer, '/admin/orders', { vendorBranchId: other.v.branchId }))).not.toContain(order.id);
      expect(ids(await get(viewer, '/admin/orders', { from: today(), to: today() }))).toContain(order.id);
      expect(ids(await get(viewer, '/admin/orders', { from: '2001-01-01', to: '2001-01-02' }))).not.toContain(order.id);
    });
  });

  describe('settlements (B1/B5): vendor = commission receivable, partial payments, authorised overpayment, idempotency, void', () => {
    let periodId: string;
    let branchId: string;
    let treasurer: Actor;
    let approver: Actor;

    beforeAll(async () => {
      const { v } = await newVendor();
      branchId = v.branchId;
      const [p] = await world.ds.query(
        `INSERT INTO vendor_settlement_periods (vendor_branch_id, frequency, period_start, period_end, status, gross_sales_minor, total_commission_owed_minor, closed_at)
         VALUES ($1, 'WEEKLY', now() - interval '8 days', now() - interval '1 day', 'CLOSED', 500000, 10000, now() - interval '1 day') RETURNING id`,
        [branchId],
      );
      periodId = p.id;
      treasurer = await s.admin([Permission.MANAGE_SETTLEMENT_PAYMENTS, Permission.VIEW_VENDOR_FINANCIAL_REPORTS]);
      approver = await s.admin([Permission.MANAGE_SETTLEMENT_PAYMENTS, Permission.VIEW_VENDOR_FINANCIAL_REPORTS, Permission.APPROVE_SETTLEMENT_OVERPAYMENT]);
    });

    const pay = (a: Actor, body: Record<string, unknown>, key: string | null = `key-${Math.random().toString(36).slice(2, 12)}-xx`) =>
      world.api('post', `/admin/settlements/vendor/periods/${periodId}/payments`, { token: a.accessToken, body: { method: 'BANK_TRANSFER', paidOn: today(), reference: 'ref', ...body }, headers: key ? { 'idempotency-key': key } : {} });
    const status = async () => expectData<any>(await get(treasurer, `/admin/settlements/vendor-periods/${periodId}`)).period;

    it('the due amount is the COMMISSION (not gross sales), direction COLLECTION, and a closed period starts UNPAID', async () => {
      const p = await status();
      expect(p.direction).toBe('COLLECTION');
      expect(p.dueMinor).toBe(10000);
      expect(p.grossSalesMinor).toBe(500000);
      expect(p.paymentStatus).toBe('UNPAID');
      const list = await get(treasurer, '/admin/settlements/vendor-periods', { paymentStatus: 'UNPAID' });
      expect((list.body.data as any[]).some((x) => x.id === periodId)).toBe(true);
    });

    it('requires an Idempotency-Key, the permission, and validates the amount/date', async () => {
      expect((await pay(treasurer, { amountMinor: 1000 }, null)).status).toBe(400);
      const viewer = await s.admin([Permission.VIEW_VENDOR_FINANCIAL_REPORTS]);
      expect((await pay(viewer, { amountMinor: 1000 })).status).toBe(403);
      expect((await pay(treasurer, { amountMinor: 0 })).status).toBe(400);
      expect((await pay(treasurer, { amountMinor: 100, paidOn: '2999-01-01' })).status).toBe(400);
    });

    it('partial payments → PARTIAL then PAID; the same key replays identically; a reused key with a different body conflicts', async () => {
      const first = expectData<any>(await pay(treasurer, { amountMinor: 4000 }, 'idem-key-first-0001'), 201);
      expect(first.replayed).toBe(false);
      expect(first.payment.direction).toBe('COLLECTION');
      expect((await status()).paymentStatus).toBe('PARTIAL');
      const replay = expectData<any>(await pay(treasurer, { amountMinor: 4000 }, 'idem-key-first-0001'), 201);
      expect(replay.replayed).toBe(true);
      expect(replay.payment.id).toBe(first.payment.id);
      expect((await pay(treasurer, { amountMinor: 4001 }, 'idem-key-first-0001')).status).toBe(409);
      expect((await status()).settledMinor).toBe(4000);

      expectData(await pay(treasurer, { amountMinor: 6000 }), 201);
      const done = await status();
      expect(done.paymentStatus).toBe('PAID');
      expect(done.remainingMinor).toBe(0);
    });

    it('an overpayment needs the explicit flag, a reason AND the dedicated permission; it then shows as OVERPAID', async () => {
      const exceeds = await pay(treasurer, { amountMinor: 1 });
      expect(exceeds.status).toBe(400);
      expect(exceeds.body.error.details.code).toBe('EXCEEDS_REMAINING');
      expect((await pay(treasurer, { amountMinor: 1, allowOverpayment: true })).status).toBe(400); // reason missing
      expect((await pay(treasurer, { amountMinor: 1, allowOverpayment: true, overpaymentReason: 'Vendor paid early' })).status).toBe(403); // not authorised
      const ok = expectData<any>(await pay(approver, { amountMinor: 500, allowOverpayment: true, overpaymentReason: 'Vendor paid next week in advance' }), 201);
      expect(ok.overpaid).toBe(true);
      expect((await status()).paymentStatus).toBe('OVERPAID');
      const recon = expectData<any>(await get(superAdmin, '/admin/finance/reconciliation'));
      expect(recon.checks.find((c: any) => c.id === 'R6').status).toBe('BALANCED'); // authorised, so not a discrepancy
    });

    it('a payment is voided by reversal exactly once (never deleted) and the status follows; the statement lists it', async () => {
      const list = expectData<any>(await get(treasurer, `/admin/settlements/vendor-periods/${periodId}`));
      const overpay = list.payments.find((x: any) => x.overpaymentAuthorised);
      expect((await world.api('post', `/admin/settlement-payments/${overpay.id}/void`, { token: treasurer.accessToken, body: { reason: 'x' } })).status).toBe(400);
      const voided = expectData<any>(await world.api('post', `/admin/settlement-payments/${overpay.id}/void`, { token: treasurer.accessToken, body: { reason: 'Entered by mistake' } }), 201);
      expect(voided.amountMinor).toBe(500);
      expect(voided.status).toBe('VOIDED');
      expect((await world.api('post', `/admin/settlement-payments/${overpay.id}/void`, { token: treasurer.accessToken, body: { reason: 'Entered by mistake' } })).status).toBe(409);
      expect((await status()).paymentStatus).toBe('PAID');
      const after = expectData<any>(await get(treasurer, `/admin/settlements/vendor-periods/${periodId}`));
      expect(after.payments.map((p: any) => p.status).sort()).toEqual(['RECORDED', 'RECORDED', 'VOIDED']);
      expect(after.accountingNote).toContain('receivable');
    });

    it('payments against an OPEN period are refused; concurrent identical payments never exceed what is due', async () => {
      const { v } = await newVendor();
      const [open] = await world.ds.query(
        `INSERT INTO vendor_settlement_periods (vendor_branch_id, frequency, period_start, period_end, status, gross_sales_minor, total_commission_owed_minor)
         VALUES ($1, 'WEEKLY', now() - interval '9 days', now() - interval '2 days', 'OPEN', 1000, 1000) RETURNING id`, [v.branchId]);
      expect((await world.api('post', `/admin/settlements/vendor/periods/${open.id}/payments`, { token: treasurer.accessToken, body: { amountMinor: 100, method: 'CASH', paidOn: today() }, headers: { 'idempotency-key': 'open-period-key-1' } })).status).toBe(409);

      const [closed] = await world.ds.query(
        `INSERT INTO vendor_settlement_periods (vendor_branch_id, frequency, period_start, period_end, status, gross_sales_minor, total_commission_owed_minor, closed_at)
         VALUES ($1, 'WEEKLY', now() - interval '20 days', now() - interval '10 days', 'CLOSED', 1000, 1000, now()) RETURNING id`, [v.branchId]);
      const attempts = await Promise.all([1, 2, 3, 4].map((i) =>
        world.api('post', `/admin/settlements/vendor/periods/${closed.id}/payments`, { token: treasurer.accessToken, body: { amountMinor: 700, method: 'CASH', paidOn: today() }, headers: { 'idempotency-key': `race-key-${i}-xxxx` } })));
      expect(attempts.filter((a) => a.status === 201)).toHaveLength(1); // 700 fits once; a second 700 would exceed 1000
      const [{ settled }] = await world.ds.query(`SELECT coalesce(sum(amount_minor),0)::int AS settled FROM settlement_payments WHERE vendor_period_id = $1 AND status = 'RECORDED'`, [closed.id]);
      expect(num(settled)).toBe(700);
    });

    it('driver periods follow the sign of net payable: positive → PAYOUT, negative → COLLECTION', async () => {
      const d = await s.driver({ lat: 30.42, lng: 31.56 });
      const mk = async (net: number) => (await world.ds.query(
        `INSERT INTO driver_settlement_periods (driver_id, frequency, period_start, period_end, status, total_earnings_minor, total_commission_owed_minor, total_reimbursements_owed_minor, net_payable_minor, closed_at)
         VALUES ($1, 'WEEKLY', now() - interval '30 days' - ($2 || ' seconds')::interval, now() - interval '20 days' - ($2 || ' seconds')::interval, 'CLOSED', 0, 0, 0, $3, now()) RETURNING id`, [d.driverId, Math.abs(net), net]))[0].id;
      const pos = await mk(8000);
      const neg = await mk(-3000);
      const payer = await s.admin([Permission.MANAGE_SETTLEMENT_PAYMENTS, Permission.VIEW_DRIVER_SETTLEMENTS]);
      const r1 = expectData<any>(await world.api('post', `/admin/settlements/driver/periods/${pos}/payments`, { token: payer.accessToken, body: { amountMinor: 8000, method: 'CASH', paidOn: today() }, headers: { 'idempotency-key': 'driver-pos-key-001' } }), 201);
      expect(r1.payment.direction).toBe('PAYOUT');
      const r2 = expectData<any>(await world.api('post', `/admin/settlements/driver/periods/${neg}/payments`, { token: payer.accessToken, body: { amountMinor: 1000, method: 'CASH', paidOn: today() }, headers: { 'idempotency-key': 'driver-neg-key-001' } }), 201);
      expect(r2.payment.direction).toBe('COLLECTION');
      const det = expectData<any>(await get(payer, `/admin/settlements/driver-periods/${neg}`));
      expect(det.period.paymentStatus).toBe('PARTIAL');
      expect(det.period.dueMinor).toBe(3000);
    });
  });

  describe('ledger and finance reads', () => {
    it('the ledger needs a range or an order, is permission-gated, keyset-paginated, and summaries reconcile', async () => {
      const analyst = await s.admin([Permission.VIEW_FINANCIALS]);
      expect((await get(analyst, '/admin/finance/ledger')).status).toBe(400);
      expect((await get(await s.admin([Permission.VIEW_ORDERS]), '/admin/finance/ledger', { from: today(), to: today() })).status).toBe(403);
      const page = expectData<any>(await get(analyst, '/admin/finance/ledger', { from: daysAgo(200), to: today(), limit: 2 }));
      expect(page.items.length).toBeLessThanOrEqual(2);
      if (page.nextCursor) {
        const next = expectData<any>(await get(analyst, '/admin/finance/ledger', { from: daysAgo(200), to: today(), limit: 2, cursor: page.nextCursor }));
        const firstIds = new Set(page.items.map((i: any) => i.id));
        expect(next.items.every((i: any) => !firstIds.has(i.id))).toBe(true);
      }
      expect((await get(analyst, '/admin/finance/ledger', { from: daysAgo(200), to: today(), cursor: 'garbage' })).status).toBe(400);
      const sum = expectData<any>(await get(analyst, '/admin/finance/ledger/summary', { from: daysAgo(200), to: today() }));
      expect(Array.isArray(sum.byType)).toBe(true);
    });

    it('revenue, receivables, discounts, liabilities and reconciliation answer with the documented shape', async () => {
      const analyst = await s.admin([Permission.VIEW_FINANCIALS]);
      const rev = expectData<any>(await get(analyst, '/admin/finance/revenue', { from: daysAgo(200), to: today(), granularity: 'month' }));
      expect(rev.definition).toContain('not revenue');
      const rec = expectData<any>(await get(analyst, '/admin/finance/vendor-receivables'));
      expect(rec.definition).toContain('commission the vendor owes Hatly');
      expectData(await get(analyst, '/admin/finance/hatly-funded-discounts'));
      const li = expectData<any>(await get(analyst, '/admin/finance/liabilities'));
      expect(typeof li.vendorCommissionReceivableMinor).toBe('number');
      const recon = expectData<any>(await get(analyst, '/admin/finance/reconciliation'));
      expect(recon.checks.map((c: any) => c.id)).toEqual(['R2', 'R3', 'R3D', 'R4', 'R5', 'R6']);
    });

    it('reconciliation detects an injected mismatch (a closed period whose stored commission differs from its events)', async () => {
      const { v } = await newVendor();
      await world.ds.query(
        `INSERT INTO vendor_settlement_periods (vendor_branch_id, frequency, period_start, period_end, status, gross_sales_minor, total_commission_owed_minor, closed_at)
         VALUES ($1, 'WEEKLY', now() - interval '40 days', now() - interval '33 days', 'CLOSED', 0, 999, now())`, [v.branchId]);
      const recon = expectData<any>(await get(superAdmin, '/admin/finance/reconciliation'));
      const r3 = recon.checks.find((c: any) => c.id === 'R3');
      expect(r3.status).toBe('MISMATCH');
      expect(r3.discrepancies.length).toBeGreaterThan(0);
      expect(recon.balanced).toBe(false);
    });
  });
});
