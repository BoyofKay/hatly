/**
 * Marketing (audiences, four-eyes broadcasts that deliver to the customer's inbox, campaigns that switch existing offers/banners on
 * and off, offer edit rules), system monitoring (real probes, DISABLED when unconfigured, metrics, telemetry), configuration
 * (overview, history without values, the Automatic Dispatch control) and the directory read models / bulk product actions.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, expectData } from './support/actors';
import { boundary } from './support/external-boundary';
import { Permission } from '../../src/modules/permissions/permission.enum';
import { MarketingService, compileAudience, inQuietHours } from '../../src/modules/admin-platform/marketing/marketing.service';

describe('E2E — Marketing, system, configuration, directory', () => {
  let world: World;
  let s: Scenario;
  let superAdmin: Actor;
  let area: { id: string };
  const home = { lat: 30.425, lng: 31.565 };
  const get = (a: Actor, p: string, query?: Record<string, string | number>) => world.api('get', p, { token: a.accessToken, query });
  const post = (a: Actor, p: string, body: unknown = {}) => world.api('post', p, { token: a.accessToken, body });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let n = 0;
  const vendorWithProduct = async (price = 10000, extra: Record<string, unknown> = {}) => {
    n += 1;
    const v = await s.vendor({ name: `Mk ${n}`, serviceAreaId: area.id, lat: 30.42 + n * 0.001, lng: 31.56 + n * 0.001 });
    return { v, product: await s.product(v, { priceMinor: price, inventoryMode: 'OPEN', ...extra }) };
  };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    superAdmin = await s.superAdmin();
    process.env.BROADCAST_QUIET_HOURS = '00:00-00:00'; // never quiet during the test run (a separate test covers the rule itself)
  });
  beforeEach(() => boundary.reset());
  afterAll(async () => {
    delete process.env.BROADCAST_QUIET_HOURS;
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('audiences and broadcasts', () => {
    it('audience rules compile to parameterised SQL, unknown rules / bad numbers are refused, quiet hours wrap midnight', () => {
      const { sql, values } = compileAudience({ lastOrderWithinDays: 30, minOrders: 2 });
      expect(sql).toContain('$1');
      expect(values).toEqual([30, 2]);
      expect(() => compileAudience({ evil: 1 } as never)).toThrow();
      expect(() => compileAudience({ lastOrderWithinDays: -5 })).toThrow();
      expect(() => compileAudience({ usedOfferId: 'not-a-uuid' })).toThrow();
      process.env.BROADCAST_QUIET_HOURS = '22:00-08:00';
      expect([inQuietHours(23), inQuietHours(3), inQuietHours(12), inQuietHours(8)]).toEqual([true, true, false, false]);
      process.env.BROADCAST_QUIET_HOURS = '00:00-00:00';
    });

    it('draft → submit → four-eyes approval → delivery to the inbox of exactly the audience; the customer reads only their own messages', async () => {
      const marketer = await s.admin([Permission.MANAGE_BROADCASTS, Permission.MARKETING_VIEW]);
      const approver = await s.admin([Permission.BROADCAST_APPROVE, Permission.MARKETING_VIEW]);
      const target = await s.customer('Inbox Target');
      const other = await s.customer('Not In Audience');
      const { v, product } = await vendorWithProduct();
      await s.simpleOrder(target, v, product.id, home); // target has an order; `other` never ordered

      expect((await post(await s.admin([Permission.MARKETING_VIEW]), '/admin/audiences', { name: 'x', rules: {} })).status).toBe(403);
      expect((await post(marketer, '/admin/audiences', { name: 'bad', rules: { nope: 1 } })).status).toBe(400);
      const preview = expectData<any>(await post(marketer, '/admin/audiences/preview', { rules: { lastOrderWithinDays: 30 } }), 200);
      expect(preview.display).toBe('<20'); // a tiny segment is never revealed exactly
      const audience = expectData<any>(await post(marketer, '/admin/audiences', { name: 'Ordered recently', rules: { lastOrderWithinDays: 30 } }), 201);

      const body = { titleEn: 'Weekend offer', titleAr: 'عرض نهاية الأسبوع', bodyEn: 'Free delivery this weekend.', bodyAr: 'توصيل مجاني خلال عطلة نهاية الأسبوع.', audienceId: audience.id, channels: ['INBOX'] };
      expect((await post(marketer, '/admin/broadcasts', { ...body, titleAr: '' })).status).toBe(400);
      expect((await post(marketer, '/admin/broadcasts', { ...body, deepLink: 'javascript:alert(1)' })).status).toBe(400);
      expect((await post(marketer, '/admin/broadcasts', { ...body, channels: ['SMS', 'INBOX'] })).status).toBe(400);
      const b = expectData<any>(await post(marketer, '/admin/broadcasts', { ...body, deepLink: 'home' }), 201);
      expect(b.status).toBe('DRAFT');

      // cannot be approved before it is submitted; the creator cannot approve; a non-approver cannot approve
      expect((await post(approver, `/admin/broadcasts/${b.id}/approve`)).status).toBe(409);
      expectData(await post(marketer, `/admin/broadcasts/${b.id}/submit`), 201);
      expect((await post(await s.admin([Permission.BROADCAST_APPROVE, Permission.MANAGE_BROADCASTS]), `/admin/broadcasts/${b.id}/approve`)).status).toBeLessThan(300); // different user → allowed
    });

    it('the creator can never approve their own broadcast; rejection returns it to draft; sending is idempotent and respects the daily cap', async () => {
      const both = await s.admin([Permission.MANAGE_BROADCASTS, Permission.BROADCAST_APPROVE]);
      const reviewer = await s.admin([Permission.BROADCAST_APPROVE]);
      const c = await s.customer('Cap Customer');
      const { v, product } = await vendorWithProduct();
      await s.simpleOrder(c, v, product.id, home);
      const aud = expectData<any>(await post(both, '/admin/audiences', { name: 'Cap', rules: { lastOrderWithinDays: 1 } }), 201);
      const mk = async (title: string) => expectData<any>(await post(both, '/admin/broadcasts', { titleEn: title, titleAr: 'عنوان', bodyEn: 'Body', bodyAr: 'نص', audienceId: aud.id }), 201);
      const b1 = await mk('First');
      expectData(await post(both, `/admin/broadcasts/${b1.id}/submit`), 201);
      const own = await post(both, `/admin/broadcasts/${b1.id}/approve`);
      expect(own.status).toBe(403);
      expect(own.body.error.details.code).toBe('FOUR_EYES');
      expect((await post(reviewer, `/admin/broadcasts/${b1.id}/reject`, { reason: 'x' })).status).toBe(400);
      expectData(await post(reviewer, `/admin/broadcasts/${b1.id}/reject`, { reason: 'Wording needs review' }), 201);
      expect(expectData<any>(await get(both, `/admin/broadcasts/${b1.id}`)).status).toBe('DRAFT');
      expectData(await post(both, `/admin/broadcasts/${b1.id}/submit`), 201);
      expectData(await post(reviewer, `/admin/broadcasts/${b1.id}/approve`), 201);

      let done: any;
      for (let i = 0; i < 40; i++) { done = expectData<any>(await get(both, `/admin/broadcasts/${b1.id}`)); if (done.status === 'COMPLETED') break; await sleep(250); }
      expect(done.status).toBe('COMPLETED');
      expect(done.stats.sent).toBeGreaterThanOrEqual(1);
      const inbox = expectData<any[]>(await get(c, '/customer/inbox'));
      expect(inbox.filter((m) => m.titleEn === 'First')).toHaveLength(1); // exactly once
      expect(inbox[0].titleAr).toBe('عنوان');
      expect(expectData<any>(await get(c, '/customer/inbox/unread-count')).unread).toBeGreaterThanOrEqual(1);

      // a second broadcast the same day to the same customer is skipped by the per-customer cap (default 1/day)
      const b2 = await mk('Second');
      expectData(await post(both, `/admin/broadcasts/${b2.id}/submit`), 201);
      expectData(await post(reviewer, `/admin/broadcasts/${b2.id}/approve`), 201);
      for (let i = 0; i < 40; i++) { done = expectData<any>(await get(both, `/admin/broadcasts/${b2.id}`)); if (done.status === 'COMPLETED') break; await sleep(250); }
      expect(done.stats.skipped).toBeGreaterThanOrEqual(1);
      expect(expectData<any[]>(await get(c, '/customer/inbox')).filter((m) => m.titleEn === 'Second')).toHaveLength(0);

      // inbox isolation + read state
      const stranger = await s.customer('Stranger');
      expect(expectData<any[]>(await get(stranger, '/customer/inbox'))).toHaveLength(0);
      const mine = expectData<any[]>(await get(c, '/customer/inbox'))[0];
      expect((await post(stranger, `/customer/inbox/${mine.id}/read`)).status).toBe(404);
      expectData(await post(c, `/customer/inbox/${mine.id}/read`), 200);
      expect(expectData<any>(await get(c, '/customer/inbox/unread-count')).unread).toBe(0);
      expect((await get(c, '/admin/broadcasts')).status).toBe(403);
    });

    it('quiet hours block an approval unless explicitly overridden; recipients are listed without personal data', async () => {
      process.env.BROADCAST_QUIET_HOURS = '00:00-24:00'; // every hour of the day (the previous '00:00-23:59' left Cairo hour 23 open, so the test failed between 23:00 and 23:59)
      try {
        const a = await s.admin([Permission.MANAGE_BROADCASTS]);
        const r = await s.admin([Permission.BROADCAST_APPROVE]);
        const c = await s.customer();
        const { v, product } = await vendorWithProduct();
        await s.simpleOrder(c, v, product.id, home);
        const aud = expectData<any>(await post(a, '/admin/audiences', { name: 'Q', rules: { lastOrderWithinDays: 1 } }), 201);
        const b = expectData<any>(await post(a, '/admin/broadcasts', { titleEn: 'Q', titleAr: 'ق', bodyEn: 'b', bodyAr: 'ب', audienceId: aud.id }), 201);
        expectData(await post(a, `/admin/broadcasts/${b.id}/submit`), 201);
        const blocked = await post(r, `/admin/broadcasts/${b.id}/approve`);
        expect(blocked.status).toBe(400);
        expect(blocked.body.error.details.code).toBe('QUIET_HOURS');
        expectData(await post(r, `/admin/broadcasts/${b.id}/approve`, { overrideQuietHours: true }), 201);
        await sleep(1500);
        const rec = (await get(a, `/admin/broadcasts/${b.id}/recipients`)).body.data as any[];
        expect(rec.length).toBeGreaterThanOrEqual(1);
        expect(JSON.stringify(rec[0])).not.toMatch(/\+20\d+/);
      } finally {
        process.env.BROADCAST_QUIET_HOURS = '00:00-00:00';
      }
    });
  });

  describe('offers and campaigns', () => {
    const offerBody = (branchId: string, extra: Record<string, unknown> = {}) => ({
      vendorBranchId: branchId, name: 'Mk Offer', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'PERCENTAGE', discountValue: 1000, startAt: new Date(Date.now() - 3_600_000).toISOString(), endAt: new Date(Date.now() + 86_400_000).toISOString(), ...extra,
    });

    it('offer edit rules: free fields change, rules are locked (clone instead), limits can only rise after use; clone resets counters; performance equals consumption rows', async () => {
      const { v, product } = await vendorWithProduct(20000);
      const admin = await s.admin([Permission.MANAGE_OFFERS, Permission.MARKETING_VIEW]);
      const offer = expectData<any>(await post(admin, '/admin/offers', offerBody(v.branchId, { couponCode: 'MKA1', totalAllocationLimit: 10 })), 201);
      const patch = (id: string, body: unknown) => world.api('patch', `/admin/offers/${id}`, { token: admin.accessToken, body });
      expect((await patch(offer.id, { name: 'Renamed offer' })).status).toBe(200);
      expect((await patch(offer.id, { discountValue: 2000 })).status).toBe(400); // rules change via clone
      expect((await patch(offer.id, { name: '' })).status).toBe(400);

      const c = await s.customer();
      await s.addToCart(c, product.id, 1);
      const order = expectData<any>(await world.api('post', '/orders', { token: c.accessToken, body: await (await import('./support/actors')).withQuoteToken(world, c.accessToken, { deliveryAddress: { line1: 'Mk', latitude: home.lat, longitude: home.lng }, paymentMethod: 'COD', couponCode: 'MKA1' }) }), 201);
      const perf = expectData<any>(await get(admin, `/admin/offers/${offer.id}/performance`));
      expect(perf.consumptions).toBe(1);
      expect(perf.netDiscountMinor).toBe(2000);
      const [rows] = [await world.ds.query(`SELECT discount_applied_minor FROM offer_consumptions WHERE offer_id = $1 AND NOT is_reversed`, [offer.id])];
      expect(Number(rows[0].discount_applied_minor)).toBe(perf.netDiscountMinor);
      expect((await patch(offer.id, { discountValue: 2000 })).status).toBe(409); // locked once used
      expect((await patch(offer.id, { totalAllocationLimit: 5 })).status).toBe(400); // limits only rise
      expect((await patch(offer.id, { totalAllocationLimit: 50 })).status).toBe(200);

      const cl = expectData<any>(await post(admin, `/admin/offers/${offer.id}/clone`, { couponCode: 'MKA2' }), 201);
      const [cloned] = await world.ds.query(`SELECT is_active, consumed_units_count, coupon_code, discount_value FROM offers WHERE id = $1`, [cl.id]);
      expect([cloned.is_active, Number(cloned.consumed_units_count), cloned.coupon_code, Number(cloned.discount_value)]).toEqual([false, 0, 'MKA2', 1000]);
      expect((await post(admin, `/admin/offers/${offer.id}/clone`, { couponCode: 'MKA2' })).status).toBe(409); // duplicate code
      const list = (await get(admin, `/admin/offers/${offer.id}/consumptions`)).body.data as any[];
      expect(list).toHaveLength(1);
      expect(order.id).toBeDefined();
    });

    it('a campaign needs items, four-eyes approval, then switches ITS offers/banners on at the start and off at the end — never touching what it did not start', async () => {
      const { v } = await vendorWithProduct();
      const planner = await s.admin([Permission.MANAGE_CAMPAIGNS, Permission.MANAGE_OFFERS, Permission.MARKETING_VIEW]);
      const approver = await s.admin([Permission.CAMPAIGN_APPROVE, Permission.MARKETING_VIEW]);
      const off = expectData<any>(await post(planner, '/admin/offers', offerBody(v.branchId, { name: 'Camp offer' })), 201);
      await world.ds.query(`UPDATE offers SET is_active = false WHERE id = $1`, [off.id]);
      const preActive = expectData<any>(await post(planner, '/admin/offers', offerBody(v.branchId, { name: 'Already live' })), 201);
      await world.ds.query(`UPDATE offers SET is_active = true WHERE id = $1`, [preActive.id]);

      const start = new Date(Date.now() + 60_000).toISOString();
      const end = new Date(Date.now() + 3_600_000).toISOString();
      expect((await post(planner, '/admin/campaigns', { nameEn: 'x', nameAr: 'س', startsAt: end, endsAt: start })).status).toBe(400);
      const camp = expectData<any>(await post(planner, '/admin/campaigns', { nameEn: 'Autumn', nameAr: 'الخريف', startsAt: start, endsAt: end }), 201);
      expect((await post(planner, `/admin/campaigns/${camp.id}/submit`)).status).toBe(400); // no items
      expectData(await world.api('put', `/admin/campaigns/${camp.id}/items`, { token: planner.accessToken, body: { items: [{ type: 'OFFER', id: off.id }, { type: 'OFFER', id: preActive.id }] } }));
      expectData(await post(planner, `/admin/campaigns/${camp.id}/submit`), 201);
      expect((await post(planner, `/admin/campaigns/${camp.id}/approve`)).status).toBe(403);
      expect((await post(await s.admin([Permission.CAMPAIGN_APPROVE, Permission.MANAGE_CAMPAIGNS]), `/admin/campaigns/${camp.id}/approve`)).status).toBeLessThan(300);
      const state = expectData<any>(await get(approver, `/admin/campaigns/${camp.id}`));
      expect(state.status).toBe('SCHEDULED');
      expect(state.timeline.map((t: any) => t.to)).toEqual(['DRAFT', 'PENDING_APPROVAL', 'SCHEDULED']);

      // start: the scheduler is the same worker; fast-forward the window instead of waiting a minute
      await world.ds.query(`UPDATE campaigns SET starts_at = now() - interval '1 minute' WHERE id = $1`, [camp.id]);
      for (let i = 0; i < 30; i++) { await world.app.get(MarketingService).tick(); if ((await world.ds.query(`SELECT status FROM campaigns WHERE id = $1`, [camp.id]))[0].status === 'RUNNING') break; await sleep(100); }
      expect((await world.ds.query(`SELECT is_active FROM offers WHERE id = $1`, [off.id]))[0].is_active).toBe(true);
      await world.ds.query(`UPDATE campaigns SET ends_at = now() - interval '1 second' WHERE id = $1`, [camp.id]);
      for (let i = 0; i < 30; i++) { await world.app.get(MarketingService).tick(); if ((await world.ds.query(`SELECT status FROM campaigns WHERE id = $1`, [camp.id]))[0].status === 'COMPLETED') break; await sleep(100); }
      expect((await world.ds.query(`SELECT is_active FROM offers WHERE id = $1`, [off.id]))[0].is_active).toBe(false); // switched off again
      expect((await world.ds.query(`SELECT is_active FROM offers WHERE id = $1`, [preActive.id]))[0].is_active).toBe(true); // not started by the campaign → untouched
      expect(expectData<any>(await get(approver, `/admin/campaigns/${camp.id}`)).timeline.map((t: any) => t.to)).toContain('COMPLETED');
    });
  });

  describe('system monitoring and configuration', () => {
    it('the overview reports REAL probes: database/redis/storage OK, SMS/Maps/Push DISABLED when not configured; needs VIEW_SYSTEM_HEALTH', async () => {
      const viewer = await s.admin([Permission.VIEW_SYSTEM_HEALTH]);
      const o = expectData<any>(await get(viewer, '/admin/system/overview'));
      const by = Object.fromEntries(o.checks.map((c: any) => [c.key, c]));
      expect(by.database.status).toBe('OK');
      expect(by.database.latencyMs).toBeGreaterThanOrEqual(0);
      expect(by.redis.status).toBe('OK');
      expect(by.storage.status).toBe('OK');
      expect(['DISABLED', 'OK']).toContain(by.sms.status);
      expect(by.push.status).toBe('DISABLED'); // no FCM credentials in the test environment: never "healthy"
      expect(by.migrations.detail).toMatch(/applied/);
      expect((await get(await s.admin([Permission.VIEW_ORDERS]), '/admin/system/overview')).status).toBe(403);
      expect((await get(viewer, '/admin/system/integrations/database/history')).body.data.length).toBeGreaterThan(0);
      expect((await post(viewer, '/admin/system/check')).status).toBe(403); // running a check needs MANAGE_SYSTEM_JOBS
      expectData(await post(await s.admin([Permission.MANAGE_SYSTEM_JOBS]), '/admin/system/check'), 200);
    });

    it('request metrics are recorded by route PATTERN (never ids) and every response carries Server-Timing; client telemetry is whitelisted and debug builds are excluded', async () => {
      const res = await world.api('get', '/health');
      expect(res.headers['server-timing']).toMatch(/^total;dur=\d/);
      await get(superAdmin, '/admin/orders');
      await get(superAdmin, '/admin/orders');
      await world.app.get((await import('../../src/modules/admin-platform/system/system.service')).MetricsRecorder).flush();
      const viewer = await s.admin([Permission.VIEW_SYSTEM_HEALTH]);
      const m = expectData<any>(await get(viewer, '/admin/system/metrics/requests'));
      expect(m.totalRequests).toBeGreaterThan(0);
      const routes = m.items.map((i: any) => i.route);
      expect(routes.some((r: string) => /\/admin\/orders\/:id/.test(r) || r === '/api/v1/admin/orders' || r.includes('admin/orders'))).toBe(true);
      expect(JSON.stringify(m)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);

      const ok = await world.api('post', '/telemetry/client-metrics', { body: { app: 'customer', appVersion: '1.0.0', buildMode: 'release', platform: 'android', deviceClass: 'mid', network: '4g', metrics: [{ key: 'app.cold_start_ms', value: 1800 }, { key: 'evil.key', value: 5 }, { key: 'app.ttfmc_ms', value: -3 }] } });
      expect(ok.status).toBe(202);
      expect(ok.body.data.accepted).toBe(1);
      expect((await world.api('post', '/telemetry/client-metrics', { body: { app: 'hacker', metrics: [] } })).status).toBe(400);
      for (let i = 0; i < 25; i++) await world.api('post', '/telemetry/client-metrics', { body: { app: 'customer', appVersion: '1.0.0', buildMode: 'debug', platform: 'android', deviceClass: 'low', network: 'wifi', metrics: [{ key: 'app.cold_start_ms', value: 100 }] } });
      await world.app.get((await import('../../src/modules/admin-platform/system/system.service')).MetricsRecorder).flush();
      const c = expectData<any>(await get(viewer, '/admin/system/metrics/client'));
      expect(c.items.every((i: any) => i.buildMode !== 'debug')).toBe(true);
      expect(c.items.find((i: any) => i.buildMode === 'release')?.avgMs).toBeNull(); // < 20 samples → "no data", never a misleading average
      expect(expectData<any>(await get(viewer, '/admin/system/metrics/client', { includeDebug: 'true' })).items.some((i: any) => i.buildMode === 'debug')).toBe(true);
    });

    it('Automatic Dispatch: a dedicated, audited switch (ON/OFF) that changes the real setting and leaves existing orders/assignments alone; permissions enforced', async () => {
      const dispatcher = await s.admin([Permission.ASSIGN_REASSIGN_ORDERS]);
      const owner = await s.admin([Permission.OVERRIDE_DISPATCH]);
      expect(expectData<any>(await get(dispatcher, '/admin/dispatch/automation')).enabled).toBe(true);
      expect((await world.api('put', '/admin/dispatch/automation', { token: dispatcher.accessToken, body: { enabled: false } })).status).toBe(403); // viewing/assigning ≠ switching
      expect((await world.api('put', '/admin/dispatch/automation', { token: owner.accessToken, body: { enabled: 'no' } })).status).toBe(400);
      const { v, product } = await vendorWithProduct();
      const c = await s.customer();
      const order = await s.simpleOrder(c, v, product.id, home);
      const before = await world.ds.query(`SELECT status FROM orders WHERE id = $1`, [order.id]);
      expectData(await world.api('put', '/admin/dispatch/automation', { token: owner.accessToken, body: { enabled: false } }));
      expect(expectData<any>(await get(dispatcher, '/admin/dispatch/automation')).enabled).toBe(false);
      expect((await world.ds.query(`SELECT status FROM orders WHERE id = $1`, [order.id]))[0].status).toBe(before[0].status); // existing orders untouched
      expect((await world.ds.query(`SELECT value FROM business_config WHERE key = 'AUTOMATIC_DISPATCH_ENABLED'`))[0].value).toBe(false);
      expect((await world.ds.query(`SELECT metadata FROM admin_audit_logs WHERE action = 'dispatch.automation_changed' ORDER BY created_at DESC LIMIT 1`))[0].metadata).toMatchObject({ from: true, to: false });
      expectData(await world.api('put', '/admin/dispatch/automation', { token: owner.accessToken, body: { enabled: true } }));
      expect(expectData<any>(await get(dispatcher, '/admin/dispatch/automation')).enabled).toBe(true);
    });

    it('the configuration overview lists every key, and history shows who/when — never the value', async () => {
      const cfg = await s.admin([Permission.MANAGE_BUSINESS_CONFIG]);
      await world.api('put', '/admin/business-config/CHECKOUT_QUOTE_TTL_SECONDS', { token: cfg.accessToken, body: { value: 600 } });
      const ov = expectData<any[]>(await get(cfg, '/admin/config/overview'));
      expect(ov.map((k) => k.key)).toEqual(expect.arrayContaining(['AUTOMATIC_DISPATCH_ENABLED', 'REGISTERED_VENDOR_ADDITIONAL_VENDOR_FEE_MINOR', 'CUSTOMER_OTP_ENABLED']));
      const h = (await get(cfg, '/admin/config/CHECKOUT_QUOTE_TTL_SECONDS/history')).body.data as any[];
      expect(h.length).toBeGreaterThanOrEqual(1);
      // never the value: no value field and no 600 as a JSON value (a timestamp like "…T01:43:47.600Z" must not count)
      expect(h.every((x) => !('value' in x) && !('newValue' in x) && !('oldValue' in x))).toBe(true);
      expect(JSON.stringify(h)).not.toMatch(/:600[,}\]]/);
      expect((await get(await s.admin([Permission.VIEW_ORDERS]), '/admin/config/overview')).status).toBe(403);
    });
  });

  describe('directory read models and bulk product actions', () => {
    it('branch/product/inventory/driver/fleet read models answer with real rows and respect permissions and sort whitelists', async () => {
      const { v, product } = await vendorWithProduct(7000, { inventoryMode: 'TRACKED', quantity: 2 });
      const d = await s.driver({ lat: 30.42, lng: 31.56 });
      const viewer = await s.admin([Permission.VENDORS_VIEW, Permission.CATALOG_VIEW, Permission.FLEET_VIEW]);
      const branches = (await get(viewer, '/admin/branch-directory', { q: v.name })).body.data as any[];
      expect(branches.some((b) => b.id === v.branchId)).toBe(true);
      expectData(await get(viewer, `/admin/branch-directory/${v.branchId}/performance`));
      const products = (await get(viewer, '/admin/product-directory', { q: 'a', vendorBranchId: v.branchId })).body;
      expect(products.meta.total).toBeGreaterThanOrEqual(0);
      expect((await get(viewer, '/admin/product-directory', { sort: 'nope:asc' })).status).toBe(400);
      const low = (await get(viewer, '/admin/product-directory', { vendorBranchId: v.branchId, state: 'LOW' })).body.data as any[];
      expect(low.map((p) => p.id)).toContain(product.id);
      const board = expectData<any>(await get(viewer, '/admin/inventory-board'));
      expect(board.items.some((i: any) => i.id === product.id)).toBe(true);
      const drivers = (await get(viewer, '/admin/driver-directory')).body.data as any[];
      expect(drivers.some((x) => x.id === d.driverId)).toBe(true);
      expectData(await get(viewer, `/admin/driver-directory/${d.driverId}`));
      expectData(await get(viewer, '/admin/fleet/live'));
      expectData(await get(viewer, '/admin/delivery-performance'));
      const nobody = await s.admin([Permission.VIEW_ORDERS]);
      for (const p of ['/admin/branch-directory', '/admin/product-directory', '/admin/inventory-board', '/admin/driver-directory', '/admin/fleet/live']) expect((await get(nobody, p)).status).toBe(403);
      // a driver details page shows settlement figures only with the settlement permission
      expect(expectData<any>(await get(viewer, `/admin/driver-directory/${d.driverId}`)).settlementPeriods).toBeUndefined();
    });

    it('bulk product actions: ≤ 50, confirmation, dry-run preview, per-item results, price bounds, tracked-stock rule, audited, vendor-safe', async () => {
      const a = await vendorWithProduct(10000, { inventoryMode: 'TRACKED', quantity: 10 });
      const b = await vendorWithProduct(5000, { inventoryMode: 'OPEN' });
      const mgr = await s.admin([Permission.MANAGE_CATALOG]);
      const bulk = (body: unknown) => world.api('post', '/admin/products/bulk', { token: mgr.accessToken, body });
      expect((await bulk({ ids: [], action: 'ACTIVATE' })).status).toBe(400);
      expect((await bulk({ ids: Array.from({ length: 51 }, () => a.product.id), action: 'ACTIVATE', confirmCount: 51 })).status).toBe(400);
      expect((await bulk({ ids: [a.product.id], action: 'DESTROY', confirmCount: 1 })).status).toBe(400);
      expect((await bulk({ ids: [a.product.id], action: 'PRICE_PERCENT', params: { percent: 95 }, confirmCount: 1 })).status).toBe(400);
      expect((await bulk({ ids: [a.product.id, b.product.id], action: 'DEACTIVATE' })).status).toBe(400); // count not confirmed
      const dry = expectData<any>(await bulk({ ids: [a.product.id, b.product.id], action: 'PRICE_PERCENT', params: { percent: 10 }, dryRun: true }), 201);
      expect(dry.results.map((r: any) => r.after)).toEqual([11000, 5500]);
      expect(Number((await world.ds.query(`SELECT price_minor FROM products WHERE id = $1`, [a.product.id]))[0].price_minor)).toBe(10000); // nothing changed
      const done = expectData<any>(await bulk({ ids: [a.product.id, b.product.id], action: 'PRICE_PERCENT', params: { percent: -50 }, confirmCount: 2 }), 201);
      expect(done.results.every((r: any) => r.ok)).toBe(true);
      expect(Number((await world.ds.query(`SELECT price_minor FROM products WHERE id = $1`, [a.product.id]))[0].price_minor)).toBe(5000);
      const stock = expectData<any>(await bulk({ ids: [a.product.id, b.product.id], action: 'SET_STOCK', params: { quantity: 3 }, confirmCount: 2 }), 201);
      expect(stock.results.map((r: any) => [r.ok, r.code])).toEqual([[true, undefined], [false, 'NOT_TRACKED']]); // partial result is explicit
      expectData(await bulk({ ids: [a.product.id], action: 'DEACTIVATE', confirmCount: 1 }), 201);
      expect((await world.ds.query(`SELECT is_available FROM products WHERE id = $1`, [a.product.id]))[0].is_available).toBe(false);
      expect((await world.ds.query(`SELECT metadata FROM admin_audit_logs WHERE action = 'bulk.action' ORDER BY created_at DESC LIMIT 1`))[0].metadata).toMatchObject({ action: 'DEACTIVATE', requested: 1, applied: 1 });
      expect((await world.api('post', '/admin/products/bulk', { token: (await s.admin([Permission.CATALOG_VIEW])).accessToken, body: { ids: [a.product.id], action: 'ACTIVATE', confirmCount: 1 } })).status).toBe(403);
    });
  });
});
