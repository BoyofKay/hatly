/**
 * `GET /home/product-sections` — the single aggregation behind the Customer Home product rows — over real HTTP against real PostgreSQL
 * and real Redis. The reference for "the sections mean what they always meant" is the composition the Customer app used to do itself
 * (sectors → 3 vendor lists → 18 per-vendor product requests → client-side qualification), ported here and driven through the EXISTING
 * public endpoints; the aggregation must produce the same products in the same order.
 */
import { PostgresQueryRunner } from 'typeorm/driver/postgres/PostgresQueryRunner';
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';
import { boundary } from './support/external-boundary';
import { REDIS_CLIENT } from '../../src/common/redis/redis.constants';
import { HomeSectionsCache } from '../../src/modules/home-products/home-sections.cache';
import { HomeProductSectionsService } from '../../src/modules/home-products/home-product-sections.service';

const HOUR = 3600_000;
const window = () => ({ startAt: new Date(Date.now() - HOUR).toISOString(), endAt: new Date(Date.now() + 24 * HOUR).toISOString() });
const SECTIONS = ['OFFERS', 'MOST_ORDERED', 'NEW'] as const;

describe('E2E — Home product sections aggregation', () => {
  let world: World;
  let s: Scenario;
  let superAdmin: Actor;
  let areaA: { id: string };
  let areaB: { id: string };
  let zoneA: { id: string };
  let zoneB: { id: string };
  const v: Record<string, VendorFixture> = {};
  const p: Record<string, { id: string; priceMinor: number }> = {};
  let queryLog: string[] = [];
  const realQuery = PostgresQueryRunner.prototype.query;

  const get = (path: string) => world.api('get', path);
  const sections = async (qs = '') => {
    const res = await get(`/home/product-sections${qs}`);
    return { res, body: res.body.data, cache: res.headers['x-home-cache'] as string };
  };
  const ids = (body: any, id: string) => body.sections.find((x: any) => x.id === id).products.map((x: any) => x.id);
  const clearHomeCache = async () => {
    const keys = await world.redis.keys('home:sections:*');
    if (keys.length) await world.redis.del(...keys);
  };
  const admin = (method: 'patch' | 'post', path: string, body: Record<string, unknown> = {}) =>
    world.api(method, path, { token: superAdmin.accessToken, body });

  /** The composition the Customer app used to do on its own (home_providers.dart), over the existing public endpoints. */
  async function legacyComposition() {
    const sectors: any[] = expectData<any[]>(await get('/sectors'));
    const ordered = [...sectors].sort((a, b) => a.sortOrder - b.sortOrder || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).slice(0, 3);
    const lists = await Promise.all(ordered.map(async (sec) => expectData<any[]>(await get(`/vendors?sectorId=${sec.id}`))));
    const seen = new Set<string>();
    const unique = lists.flat().filter((x) => seen.add(x.id));
    unique.sort((a, b) => b.ratingCount - a.ratingCount || b.ratingAverage - a.ratingAverage || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const ranked = unique.slice(0, 6);
    const now = Date.now();
    const compose = (perVendor: any[][], qualifies: (x: any) => boolean, max: number) => {
      const out: any[] = [];
      const dedupe = new Set<string>();
      const longest = Math.max(0, ...perVendor.map((l) => l.length));
      for (let i = 0; i < longest && out.length < max; i++) {
        for (const list of perVendor) {
          const x = list[i];
          if (!x || !qualifies(x) || !dedupe.add(x.id)) continue;
          out.push(x);
          if (out.length >= max) break;
        }
      }
      return out;
    };
    const fetch = async (qs: string) => Promise.all(ranked.map(async (r) => expectData<any[]>(await get(`/vendor-branches/${r.id}/products?${qs}&availableOnly=true&limit=3`))));
    const [best, newest, offers] = await Promise.all([fetch('sort=bestSelling'), fetch('sort=newest'), fetch('hasOffers=true')]);
    return {
      vendors: ranked.map((r) => r.id),
      OFFERS: compose(offers, (x) => x.activeOffer != null, Infinity).map((x) => x.id),
      MOST_ORDERED: compose(best, (x) => Number(x.deliveredQuantityCount) > 0 || Number(x.deliveredWeightGramsCount) > 0, 10).map((x) => x.id),
      NEW: compose(newest, (x) => now - new Date(x.createdAt).getTime() < 30 * 24 * HOUR, 10).map((x) => x.id),
    };
  }

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    superAdmin = await s.superAdmin();
    areaA = await s.serviceArea({ name: 'Area A', radiusMeters: 5000 });
    areaB = await s.serviceArea({ name: 'Area B', lat: 27.0, lng: 29.0, radiusMeters: 5000 });
    zoneA = await s.deliveryZone({ serviceAreaId: areaA.id, name: 'Zone A', feeMinor: 1000 });
    zoneB = await s.deliveryZone({ serviceAreaId: areaB.id, name: 'Zone B', feeMinor: 1200 });

    // 4 sectors; only the first three (by name) feed Home
    const secA = await s.sector('Sec A');
    const secB = await s.sector('Sec B');
    const secC = await s.sector('Sec C');
    const secD = await s.sector('Sec D (not in the first three)');
    const mk = async (key: string, sector: { id: string }, area: { id: string }, lat: number, lng: number) => {
      v[key] = await s.vendor({ name: `HP ${key}`, serviceAreaId: area.id, lat, lng });
      await s.assignSector(v[key], sector.id);
    };
    await mk('a1', secA, areaA, 30.421, 31.561);
    await mk('a2', secA, areaA, 30.422, 31.562);
    await mk('b1', secB, areaA, 30.423, 31.563);
    await mk('c1', secC, areaB, 27.001, 29.001); // the only vendor in the other service area
    await mk('d1', secD, areaA, 30.424, 31.564);

    for (const key of Object.keys(v)) {
      for (let i = 1; i <= 4; i++) p[`${key}-${i}`] = await s.product(v[key], { name: `${key} product ${i}`, priceMinor: 1000 * i, inventoryMode: 'OPEN' });
    }
    // ratings decide the vendor ranking: b1 > a1 > a2 > c1 > d1
    const rate = (key: string, count: number, sum: number) => world.ds.query('UPDATE vendor_branches SET rating_count = $2, rating_sum_stars = $3 WHERE id = $1', [v[key].branchId, count, sum]);
    await rate('b1', 20, 90);
    await rate('a1', 10, 40);
    await rate('a2', 5, 20);
    await rate('c1', 1, 5);
    // delivered counts → "most ordered"; created_at → "new" (some products are old)
    await world.ds.query('UPDATE products SET delivered_quantity_count = 9 WHERE id = $1', [p['a1-1'].id]);
    await world.ds.query('UPDATE products SET delivered_quantity_count = 5 WHERE id = $1', [p['a1-2'].id]);
    await world.ds.query('UPDATE products SET delivered_quantity_count = 7 WHERE id = $1', [p['b1-1'].id]);
    await world.ds.query('UPDATE products SET delivered_quantity_count = 3 WHERE id = $1', [p['c1-1'].id]);
    await world.ds.query('UPDATE products SET delivered_quantity_count = 50 WHERE id = $1', [p['d1-1'].id]); // d1 is outside the three sectors
    await world.ds.query("UPDATE products SET created_at = now() - interval '45 days' WHERE id = ANY($1::uuid[])", [[p['a1-1'].id, p['a2-1'].id, p['b1-2'].id]]);
    // one unavailable product that would otherwise rank first for new
    await admin('patch', `/admin/products/${p['a1-4'].id}/deactivate`);
    // offers: a flash sale on one product of a2, a branch-wide subtotal discount on b1
    await admin('post', '/admin/offers', { vendorBranchId: v.a2.branchId, name: 'Flash', mechanism: 'FLASH_SALE', specialPriceMinor: 500, productIds: [p['a2-2'].id], ...window() });
    await admin('post', '/admin/offers', { vendorBranchId: v.b1.branchId, name: 'Ten', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'PERCENTAGE', discountValue: 1000, ...window() });
    await clearHomeCache();
  });
  beforeEach(async () => {
    boundary.reset();
    queryLog = [];
    PostgresQueryRunner.prototype.query = function (this: unknown, query: string, ...rest: unknown[]) {
      queryLog.push(query);
      return (realQuery as any).call(this, query, ...rest);
    } as typeof realQuery;
    await clearHomeCache();
  });
  afterEach(() => {
    PostgresQueryRunner.prototype.query = realQuery;
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('contract', () => {
    it('is public, versioned, and returns the three sections in Home order with the fields a product card reads', async () => {
      const { res, body } = await sections();
      expect(res.status).toBe(200);
      expect(body).toMatchObject({ contractVersion: 1, scope: { deliveryZoneId: null } });
      expect(new Date(body.generatedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
      expect(body.sections.map((x: any) => x.id)).toEqual(['OFFERS', 'MOST_ORDERED', 'NEW']);
      expect(body.sections.every((x: any) => x.status === 'OK')).toBe(true);
      for (const x of body.sections) expect(Object.keys(x).sort()).toEqual(['id', 'products', 'status']);
      const product = body.sections.find((x: any) => x.id === 'MOST_ORDERED').products[0];
      expect(Object.keys(product).sort()).toEqual(
        ['activeOffer', 'categoryId', 'createdAt', 'deliveredQuantityCount', 'deliveredWeightGramsCount', 'description', 'descriptionAr', 'id', 'imageUrl', 'inventoryMode', 'isAvailable', 'name', 'nameAr', 'priceMinor', 'pricingUnit', 'quantity', 'vendorBranchId'].sort(),
      );
      expect(typeof product.priceMinor).toBe('number');
      expect(typeof product.deliveredQuantityCount).toBe('number');
      expect(body.vendors[0]).toEqual(expect.objectContaining({ id: v.b1.branchId, name: 'HP b1', hasOffer: true, ratingCount: 20 }));
      expect(Object.keys(body.vendors[0]).sort()).toEqual(['coverImageUrl', 'hasOffer', 'id', 'isOpen', 'logoUrl', 'name', 'nameAr', 'ratingAverage', 'ratingCount']);
    });

    it('the three sections hold the right things: Most ordered (ordered ≥ once), New (last 30 days, available), Offers (a valid offer)', async () => {
      const { body } = await sections();
      expect(ids(body, 'MOST_ORDERED')).toEqual([p['b1-1'].id, p['a1-1'].id, p['c1-1'].id, p['a1-2'].id]);
      for (const product of body.sections.find((x: any) => x.id === 'MOST_ORDERED').products) expect(product.deliveredQuantityCount).toBeGreaterThan(0);
      for (const product of body.sections.find((x: any) => x.id === 'OFFERS').products) expect(product.activeOffer).not.toBeNull();
      const fresh = body.sections.find((x: any) => x.id === 'NEW').products;
      expect(fresh.length).toBeGreaterThan(0);
      for (const product of fresh) expect(Date.now() - new Date(product.createdAt).getTime()).toBeLessThan(30 * 24 * HOUR);
      expect(ids(body, 'NEW')).not.toContain(p['a1-1'].id); // 45 days old
      expect(ids(body, 'NEW')).not.toContain(p['a1-4'].id); // unavailable
    });

    it('SAME products in the SAME order as the composition the app used to do itself (3 vendor lists + 18 product requests)', async () => {
      const legacy = await legacyComposition();
      const { body } = await sections();
      expect(body.vendors.map((x: any) => x.id)).toEqual(legacy.vendors);
      for (const id of SECTIONS) expect(ids(body, id)).toEqual(legacy[id]);
      expect(legacy.MOST_ORDERED.length).toBeGreaterThan(0);
      expect(legacy.OFFERS.length).toBeGreaterThan(0);
    });

    it('the vendor outside the first three sectors, and unavailable / deactivated products, never appear; no product repeats across a section', async () => {
      const { body } = await sections();
      const all = body.sections.flatMap((x: any) => x.products);
      expect(all.some((x: any) => x.vendorBranchId === v.d1.branchId)).toBe(false);
      expect(body.vendors.map((x: any) => x.id)).not.toContain(v.d1.branchId);
      expect(all.every((x: any) => x.isAvailable)).toBe(true);
      for (const x of body.sections) expect(new Set(x.products.map((q: any) => q.id)).size).toBe(x.products.length);
      expect(all.every((x: any) => Number(x.priceMinor) > 0)).toBe(true);
    });

    it('the offer shown on a product is the one the product endpoint reports (same resolution, same discount)', async () => {
      const { body } = await sections();
      const offered = body.sections.find((x: any) => x.id === 'OFFERS').products;
      expect(offered.length).toBeGreaterThan(0);
      for (const product of offered) {
        const viaListing = expectData<any[]>(await get(`/vendor-branches/${product.vendorBranchId}/products?availableOnly=true&limit=50`)).find((x) => x.id === product.id);
        expect(product.activeOffer).toEqual(viaListing.activeOffer);
      }
    });

    it('`sections=` returns only the requested sections (a retry asks for the one that failed); an unknown id or a bad zone id is a 400', async () => {
      const { body } = await sections('?sections=NEW');
      expect(body.sections.map((x: any) => x.id)).toEqual(['NEW']);
      expect((await sections('?sections=OFFERS,NEW')).body.sections.map((x: any) => x.id)).toEqual(['OFFERS', 'NEW']);
      expect((await get('/home/product-sections?sections=BOGUS')).status).toBe(400);
      expect((await get('/home/product-sections?deliveryZoneId=not-a-uuid')).status).toBe(400);
    });
  });

  describe('empty and partial', () => {
    it('an empty section does not stop the others: with nothing ordered, Most ordered is an OK empty section and Offers/New still arrive', async () => {
      await world.ds.query('UPDATE products SET delivered_quantity_count = 0, delivered_weight_grams_count = 0');
      await clearHomeCache();
      const { body } = await sections();
      expect(body.sections.find((x: any) => x.id === 'MOST_ORDERED')).toEqual({ id: 'MOST_ORDERED', status: 'OK', products: [] });
      expect(ids(body, 'NEW').length).toBeGreaterThan(0);
      expect(ids(body, 'OFFERS').length).toBeGreaterThan(0);
      await world.ds.query('UPDATE products SET delivered_quantity_count = 9 WHERE id = $1', [p['a1-1'].id]);
      await world.ds.query('UPDATE products SET delivered_quantity_count = 5 WHERE id = $1', [p['a1-2'].id]);
      await world.ds.query('UPDATE products SET delivered_quantity_count = 7 WHERE id = $1', [p['b1-1'].id]);
      await world.ds.query('UPDATE products SET delivered_quantity_count = 3 WHERE id = $1', [p['c1-1'].id]);
    });

    it('a marketplace with no vendors at all answers 200 with three empty OK sections', async () => {
      const { body } = await sections(`?deliveryZoneId=${zoneB.id}`);
      expect(body.vendors.map((x: any) => x.id)).toEqual([v.c1.branchId]); // sanity: zone B has exactly one vendor
      await world.ds.query('UPDATE vendor_branches SET is_active = false WHERE id = $1', [v.c1.branchId]);
      await clearHomeCache();
      const empty = (await sections(`?deliveryZoneId=${zoneB.id}`)).body;
      expect(empty.vendors).toEqual([]);
      expect(empty.sections.map((x: any) => [x.id, x.status, x.products.length])).toEqual([['OFFERS', 'OK', 0], ['MOST_ORDERED', 'OK', 0], ['NEW', 'OK', 0]]);
      await world.ds.query('UPDATE vendor_branches SET is_active = true WHERE id = $1', [v.c1.branchId]);
    });

    it('ONE failing section is reported as ERROR (not cached) while the other two are served; the next call recovers', async () => {
      const service = world.app.get(HomeProductSectionsService) as any;
      const original = service.topPerBranch.bind(service);
      const spy = jest.spyOn(service, 'topPerBranch').mockImplementation(async (id: string, branchIds: string[]) => {
        if (id === 'NEW') throw new Error('boom');
        return original(id, branchIds);
      });
      try {
        const { body } = await sections();
        expect(body.sections.find((x: any) => x.id === 'NEW')).toEqual({ id: 'NEW', status: 'ERROR', code: 'SECTION_UNAVAILABLE', products: [] });
        expect(body.sections.find((x: any) => x.id === 'OFFERS').status).toBe('OK');
        expect(body.sections.find((x: any) => x.id === 'MOST_ORDERED').status).toBe('OK');
        expect(ids(body, 'MOST_ORDERED').length).toBeGreaterThan(0);
      } finally {
        spy.mockRestore();
      }
      const recovered = (await sections()).body;
      expect(recovered.sections.every((x: any) => x.status === 'OK')).toBe(true);
      expect(ids(recovered, 'NEW').length).toBeGreaterThan(0);
    });

    it('if the source vendors cannot be resolved every requested section is an ERROR section, with a 200 (the app shows per-section retries)', async () => {
      const service = world.app.get(HomeProductSectionsService) as any;
      const spy = jest.spyOn(service, 'computeSources').mockRejectedValue(new Error('db down'));
      try {
        const { res, body } = await sections();
        expect(res.status).toBe(200);
        expect(body.sections.map((x: any) => x.status)).toEqual(['ERROR', 'ERROR', 'ERROR']);
        expect(body.vendors).toEqual([]);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('delivery-zone isolation', () => {
    it('a zone only sees the vendors of its own service area, and two zones never share cached data', async () => {
      const a1 = await sections(`?deliveryZoneId=${zoneA.id}`);
      const b1 = await sections(`?deliveryZoneId=${zoneB.id}`);
      const a2 = await sections(`?deliveryZoneId=${zoneA.id}`);
      const b2 = await sections(`?deliveryZoneId=${zoneB.id}`);
      expect(a1.body.vendors.map((x: any) => x.id).sort()).toEqual([v.a1.branchId, v.a2.branchId, v.b1.branchId, v.d1.branchId].filter((id) => id !== v.d1.branchId).sort());
      expect(b1.body.vendors.map((x: any) => x.id)).toEqual([v.c1.branchId]);
      for (const x of b1.body.sections.flatMap((s2: any) => s2.products)) expect(x.vendorBranchId).toBe(v.c1.branchId);
      for (const x of a1.body.sections.flatMap((s2: any) => s2.products)) expect(x.vendorBranchId).not.toBe(v.c1.branchId);
      expect([a1.cache, b1.cache, a2.cache, b2.cache]).toEqual(['MISS', 'MISS', 'HIT', 'HIT']);
      expect(a2.body.scope).toEqual({ deliveryZoneId: zoneA.id });
      expect(b2.body.vendors.map((x: any) => x.id)).toEqual([v.c1.branchId]);
      const unscoped = await sections();
      expect(unscoped.cache).toBe('MISS'); // its own key, not the zones'
      expect(unscoped.body.vendors.length).toBe(4);
    });

    it('an unknown zone id is correctly empty — never the unfiltered marketplace', async () => {
      const { body } = await sections('?deliveryZoneId=00000000-0000-4000-8000-000000000000');
      expect(body.vendors).toEqual([]);
      expect(body.sections.every((x: any) => x.products.length === 0)).toBe(true);
    });
  });

  describe('Redis cache', () => {
    it('cold → MISS, warm → HIT with the same products; a HIT touches the products tables zero times', async () => {
      const cold = await sections();
      expect(cold.cache).toBe('MISS');
      queryLog = [];
      const warm = await sections();
      expect(warm.cache).toBe('HIT');
      for (const id of SECTIONS) expect(ids(warm.body, id)).toEqual(ids(cold.body, id));
      expect(warm.body.vendors).toEqual(cold.body.vendors);
      expect(queryLog.filter((q) => /products|vendor_branches|offers|marketplace_sectors/i.test(q))).toEqual([]);
    });

    it('the cached section expires by TTL: after it lapses the next request recomputes', async () => {
      await sections();
      for (const key of await world.redis.keys('home:sections:v1:*')) {
        if (!key.endsWith(':lock')) expect(await world.redis.ttl(key)).toBeGreaterThan(0);
        if (!key.endsWith(':lock')) expect(await world.redis.ttl(key)).toBeLessThanOrEqual(60);
        await world.redis.pexpire(key, 30);
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect((await sections()).cache).toBe('MISS');
    });

    it('a product price change made through the admin API is visible on the very next request (epoch invalidation, no stale price)', async () => {
      const before = (await sections()).body;
      const target = before.sections.find((x: any) => x.id === 'MOST_ORDERED').products.find((x: any) => x.id === p['b1-1'].id);
      expect(target.priceMinor).toBe(1000);
      expect((await sections()).cache).toBe('HIT');
      expectData(await admin('patch', `/admin/products/${p['b1-1'].id}`, { priceMinor: 4321 }));
      const after = await sections();
      expect(after.cache).toBe('MISS');
      expect(after.body.sections.find((x: any) => x.id === 'MOST_ORDERED').products.find((x: any) => x.id === p['b1-1'].id).priceMinor).toBe(4321);
      expectData(await admin('patch', `/admin/products/${p['b1-1'].id}`, { priceMinor: 1000 }));
    });

    it('deactivating a product, deactivating a vendor and creating an offer each show up immediately', async () => {
      const first = (await sections()).body;
      expect(ids(first, 'MOST_ORDERED')).toContain(p['a1-2'].id);
      expectData(await admin('patch', `/admin/products/${p['a1-2'].id}/deactivate`));
      const second = (await sections()).body;
      expect(ids(second, 'MOST_ORDERED')).not.toContain(p['a1-2'].id);
      expectData(await admin('patch', `/admin/products/${p['a1-2'].id}/activate`));

      expectData(await admin('patch', `/admin/vendor-branches/${v.b1.branchId}/deactivate`));
      const third = (await sections()).body;
      expect(third.vendors.map((x: any) => x.id)).not.toContain(v.b1.branchId);
      expect(ids(third, 'MOST_ORDERED')).not.toContain(p['b1-1'].id);
      expectData(await admin('patch', `/admin/vendor-branches/${v.b1.branchId}/activate`));
      expect((await sections()).body.vendors.map((x: any) => x.id)).toContain(v.b1.branchId);

      const offersBefore = ids((await sections()).body, 'OFFERS');
      await admin('post', '/admin/offers', { vendorBranchId: v.a1.branchId, name: 'New flash', mechanism: 'FLASH_SALE', specialPriceMinor: 100, productIds: [p['a1-3'].id], ...window() });
      expect(ids((await sections()).body, 'OFFERS')).toContain(p['a1-3'].id);
      expect(offersBefore).not.toContain(p['a1-3'].id);
    });

    it('a FAILED mutation does not invalidate anything (the epoch only moves after a success)', async () => {
      await sections();
      const epoch = await world.redis.get('home:sections:epoch');
      expect((await admin('patch', `/admin/products/${p['b1-1'].id}`, { priceMinor: -5 })).status).toBeGreaterThanOrEqual(400);
      expect(await world.redis.get('home:sections:epoch')).toBe(epoch);
      expect((await sections()).cache).toBe('HIT');
    });

    it('Redis unavailable: the endpoint still answers from the database (BYPASS) with the same products — Home never depends on Redis', async () => {
      const warm = (await sections()).body;
      const appRedis = world.app.get(REDIS_CLIENT) as any; // the APPLICATION's client (the test's own `world.redis` is a different connection)
      const spies = (['get', 'set', 'incr', 'eval'] as const).map((cmd) => jest.spyOn(appRedis, cmd as any).mockRejectedValue(new Error("Stream isn't writeable and enableOfflineQueue options is false")));
      try {
        const down = await sections();
        expect(down.res.status).toBe(200);
        expect(down.cache).toBe('BYPASS');
        for (const id of SECTIONS) expect(ids(down.body, id)).toEqual(ids(warm, id));
        expect(down.body.sections.every((x: any) => x.status === 'OK')).toBe(true);
      } finally {
        spies.forEach((spy) => spy.mockRestore());
        // The outage legitimately opened the 15 s circuit; the NEXT tests measure a healthy cache, so close it (test hygiene only).
        (world.app.get(HomeSectionsCache) as any).circuitOpenUntil = 0;
      }
      expect((await sections()).res.status).toBe(200);
    });
  });

  describe('concurrency and load', () => {
    it('a cold stampede of 40 simultaneous requests runs the section queries ONCE (3 statements), not 40 times', async () => {
      queryLog = [];
      const results = await Promise.all(Array.from({ length: 40 }, () => sections()));
      expect(results.every((r) => r.res.status === 200)).toBe(true);
      const first = results[0].body;
      for (const r of results) for (const id of SECTIONS) expect(ids(r.body, id)).toEqual(ids(first, id));
      expect(queryLog.filter((q) => q.includes('ROW_NUMBER()')).length).toBe(3);
      expect(queryLog.filter((q) => q.includes('FROM marketplace_sectors') || q.includes('"marketplace_sectors"')).length).toBeLessThanOrEqual(4); // 1 sector list + the 3 sector lookups of the existing vendor listing — constant, not per request
    });

    it('database statements for one cold request are a small constant (no per-vendor / per-product queries) and ZERO when warm', async () => {
      queryLog = [];
      await sections();
      const cold = queryLog.length;
      queryLog = [];
      await sections();
      expect(queryLog.length).toBe(0);
      // the legacy composition costs, per vendor-or-section request, at least 1 statement: 1 + 3 + 18 requests
      expect(cold).toBeLessThan(40);
    });
  });
});
