/**
 * The demonstration marketplace importer (`npm run demo:marketplace`), against a real PostgreSQL schema and the REAL customer API.
 *
 * The acceptance criteria of the demo environment are asserted through the same endpoints the customer app uses — not through the
 * importer's own report: every category returned, ≥ 5 published vendors in each, every vendor opens and has a usable catalogue, images
 * resolve to real files, search / product details / cart / checkout quote work. Then the safety properties: dry-run writes nothing,
 * re-running creates nothing, a real merchant is never touched, and deactivation deletes nothing.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { bootWorld, World } from './support/world';
import { Scenario, Actor, expectData } from './support/actors';
import { DEMO_CATALOG } from '../../src/scripts/demo-marketplace/demo-catalog';
import { DEFAULT_MEDIA_DIR } from '../../src/scripts/seed-media';
import { deactivateDemoRecords, listDemoRecords, runDemoImport, DemoImportOptions, validateDemoCatalog, MIN_VENDORS_PER_SECTOR } from '../../src/scripts/demo-marketplace/demo-marketplace';

describe('E2E — demonstration marketplace import', () => {
  let world: World;
  let s: Scenario;
  let uploadsDir: string;
  let areaId: string;
  const count = async (sql: string, params: unknown[] = []) => Number((await world.ds.query(sql, params))[0].n);
  const options = (over: Partial<DemoImportOptions> = {}): DemoImportOptions => ({
    mode: 'execute',
    database: 'e2e',
    mediaDir: DEFAULT_MEDIA_DIR,
    uploadsDir,
    ...over,
  });

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hatly-demo-uploads-'));
    areaId = (await s.serviceArea({ name: 'Demo Area', radiusMeters: 20000 })).id;
  });
  afterAll(async () => {
    fs.rmSync(uploadsDir, { recursive: true, force: true });
    await world.close();
  });

  describe('the catalogue itself', () => {
    it('passes its own validation: 6 categories × 5 vendors, every vendor with a usable catalogue and demonstration prices', () => {
      expect(validateDemoCatalog(DEMO_CATALOG)).toEqual([]);
      expect(DEMO_CATALOG.sectors).toHaveLength(6);
      for (const sector of DEMO_CATALOG.sectors) {
        expect(DEMO_CATALOG.vendors.filter((v) => v.sector === sector.slug).length).toBeGreaterThanOrEqual(MIN_VENDORS_PER_SECTOR);
      }
      expect(DEMO_CATALOG.vendors).toHaveLength(30);
    });

    it('rejects a catalogue that would break the minimums (so a bad edit cannot silently ship a thin demo)', () => {
      const thin = { ...DEMO_CATALOG, vendors: DEMO_CATALOG.vendors.filter((v) => v.sector !== 'bakery').concat(DEMO_CATALOG.vendors.filter((v) => v.sector === 'bakery').slice(0, 4)) };
      expect(validateDemoCatalog(thin).join('\n')).toMatch(/sector "bakery": only 4 vendors/);
      const badPrice = { ...DEMO_CATALOG, vendors: [{ ...DEMO_CATALOG.vendors[0], categories: [{ name: 'c', nameAr: 'c', products: [{ name: 'x', nameAr: 'x', priceMinor: 12.5 }] }] }, ...DEMO_CATALOG.vendors.slice(1)] };
      expect(validateDemoCatalog(badPrice).join('\n')).toMatch(/price must be a positive whole number of piastres/);
    });
  });

  describe('preconditions are reported, nothing is written', () => {
    it('no active service area → an error that says what to create; nothing written', async () => {
      await world.ds.query('UPDATE service_areas SET is_active = false WHERE id = $1', [areaId]);
      try {
        const r = await runDemoImport(world.ds, DEMO_CATALOG, options());
        expect(r.errors.join(' ')).toMatch(/no active service area/);
        expect(r.items).toEqual([]);
        expect(await count('SELECT COUNT(*) n FROM demo_seed_records')).toBe(0);
        expect(await count('SELECT COUNT(*) n FROM vendors')).toBe(0);
      } finally {
        await world.ds.query('UPDATE service_areas SET is_active = true WHERE id = $1', [areaId]);
      }
    });

    it('several service areas and none named → asks which one; naming it works', async () => {
      const other = await s.serviceArea({ name: 'Other Area', lat: 30.1, lng: 31.1 });
      try {
        const ambiguous = await runDemoImport(world.ds, DEMO_CATALOG, options({ mode: 'dry-run' }));
        expect(ambiguous.errors.join(' ')).toMatch(/--service-area/);
        const named = await runDemoImport(world.ds, DEMO_CATALOG, options({ mode: 'dry-run', serviceArea: 'Demo Area' }));
        expect(named.errors).toEqual([]);
        expect(named.serviceArea).toMatchObject({ id: areaId });
      } finally {
        await world.ds.query('UPDATE service_areas SET is_active = false WHERE id = $1', [other.id]);
      }
    });
  });

  describe('dry-run', () => {
    it('plans everything and writes NOTHING — not a row, not a file', async () => {
      const r = await runDemoImport(world.ds, DEMO_CATALOG, options({ mode: 'dry-run' }));
      expect(r.errors).toEqual([]);
      expect(r.counts.SECTOR).toEqual({ CREATE: 6 });
      expect(r.counts.VENDOR).toEqual({ CREATE: 30 });
      expect(r.counts.BRANCH).toEqual({ CREATE: 30 });
      expect(r.counts.PRODUCT.CREATE).toBe(DEMO_CATALOG.vendors.reduce((n, v) => n + v.categories.reduce((m, c) => m + c.products.length, 0), 0));
      expect(r.counts.HOME_BANNER).toEqual({ CREATE: 5 });
      expect(await count('SELECT COUNT(*) n FROM demo_seed_records')).toBe(0);
      expect(await count('SELECT COUNT(*) n FROM vendors')).toBe(0);
      expect(await count('SELECT COUNT(*) n FROM marketplace_sectors')).toBe(0);
      expect(await count('SELECT COUNT(*) n FROM home_banners')).toBe(0);
      expect(fs.readdirSync(uploadsDir)).toEqual([]);
    });

    it('lists the exact product images the asset pack does not have', async () => {
      const r = await runDemoImport(world.ds, DEMO_CATALOG, options({ mode: 'dry-run' }));
      expect(r.missingImages.length).toBeGreaterThan(0);
      expect(r.missingImages.every((k) => /^(products|vendors|sectors)\//.test(k))).toBe(true);
    });
  });

  describe('a real merchant is never touched', () => {
    it('a vendor that already has a demo vendor\'s name but was not created by the importer is a CONFLICT: untouched, and its catalogue is skipped', async () => {
      const real = (await world.ds.query(`INSERT INTO vendors (name, name_ar, is_active) VALUES ('Abu Aly Grills', 'تاجر حقيقي', true) RETURNING id`))[0];
      const r = await runDemoImport(world.ds, DEMO_CATALOG, options({ mode: 'dry-run' }));
      const conflict = r.items.find((i) => i.demoKey === 'vendor:abu-aly-grills')!;
      expect(conflict.action).toBe('CONFLICT');
      expect(conflict.entityId).toBe(real.id);
      expect(r.items.some((i) => i.demoKey.startsWith('product:abu-aly-grills:'))).toBe(false);
      await world.ds.query('DELETE FROM vendors WHERE id = $1', [real.id]);
    });
  });

  describe('execute', () => {
    let report: Awaited<ReturnType<typeof runDemoImport>>;

    beforeAll(async () => {
      report = await runDemoImport(world.ds, DEMO_CATALOG, options());
    });

    it('creates the whole marketplace and tracks every record it created', async () => {
      expect(report.errors).toEqual([]);
      expect(report.counts.SECTOR).toEqual({ CREATE: 6 });
      expect(report.counts.VENDOR).toEqual({ CREATE: 30 });
      expect(report.counts.HOME_BANNER).toEqual({ CREATE: 5 });
      const tracked = await count('SELECT COUNT(*) n FROM demo_seed_records');
      expect(tracked).toBe(report.items.filter((i) => i.action === 'CREATE').length);
      const types = new Set((await world.ds.query('SELECT DISTINCT entity_type t FROM demo_seed_records')).map((r: any) => r.t));
      expect(types).toEqual(new Set(['SECTOR', 'VENDOR', 'BRANCH', 'PRODUCT_CATEGORY', 'PRODUCT', 'PRODUCT_OPTION', 'PRODUCT_OPTION_VALUE', 'HOME_BANNER']));
    });

    describe('what the CUSTOMER sees (real API)', () => {
      let sectors: any[];
      const vendorsOf = async (sectorId: string) => {
        const all: any[] = [];
        for (let page = 1; page < 20; page += 1) {
          const res = await world.api('get', '/vendors', { query: { sectorId, page: String(page), limit: '50' } });
          const rows = expectData<any[]>(res);
          all.push(...rows);
          if (rows.length < 50) break;
        }
        return all;
      };

      beforeAll(async () => {
        sectors = expectData<any[]>(await world.api('get', '/sectors'));
      });

      it('1-2. at least five categories, each with at least five active published vendors', async () => {
        expect(sectors.length).toBeGreaterThanOrEqual(5);
        expect(sectors.map((x) => x.slug).sort()).toEqual(['bakery', 'coffee-spices', 'groceries', 'pharmacy', 'produce', 'restaurants']);
        for (const sector of sectors) {
          const vendors = await vendorsOf(sector.id);
          expect(vendors.length).toBeGreaterThanOrEqual(5);
        }
      });

      it('3. at least 25 DISTINCT published vendors in total (no vendor counted twice)', async () => {
        const ids = new Set<string>();
        for (const sector of sectors) for (const v of await vendorsOf(sector.id)) ids.add(v.vendorBranchId ?? v.id);
        expect(ids.size).toBeGreaterThanOrEqual(25);
        expect(ids.size).toBe(30);
      });

      it('4-6. every vendor opens, has a usable catalogue (products with a price and unit), and its images resolve to real files', async () => {
        let products = 0;
        let imageRefs = 0;
        for (const sector of sectors) {
          for (const v of await vendorsOf(sector.id)) {
            const branchId = v.vendorBranchId ?? v.id;
            const branch = expectData<any>(await world.api('get', `/vendor-branches/${branchId}`));
            expect(branch).toMatchObject({ isOpen: true });
            const list = expectData<any[]>(await world.api('get', `/vendor-branches/${branchId}/products`, { query: { limit: '100' } }));
            expect(list.length).toBeGreaterThanOrEqual(6);
            for (const p of list) {
              products += 1;
              expect(Number(p.priceMinor)).toBeGreaterThan(0);
              expect(['PIECE', 'WEIGHT']).toContain(p.pricingUnit);
              expect(p.isAvailable).toBe(true);
              if (p.imageUrl) {
                imageRefs += 1;
                expect(p.imageUrl).toMatch(/^\/uploads\/files\/marketplace\/products\//);
                expect(fs.existsSync(path.join(uploadsDir, p.imageUrl.replace('/uploads/files/', '')))).toBe(true);
              }
            }
          }
        }
        expect(products).toBe(await count('SELECT COUNT(*) n FROM products'));
        expect(imageRefs).toBeGreaterThan(50); // many real product images from the pack; the rest show the placeholder
      });

      it('sector tiles, vendor logos and banner images are real stored files, never a dangling URL', async () => {
        const urls: string[] = [
          ...(await world.ds.query('SELECT image_url u FROM marketplace_sectors WHERE image_url IS NOT NULL')).map((r: any) => r.u),
          ...(await world.ds.query('SELECT logo_url u FROM vendors WHERE logo_url IS NOT NULL')).map((r: any) => r.u),
          ...(await world.ds.query('SELECT image_url u FROM home_banners')).map((r: any) => r.u),
        ];
        expect(urls.length).toBeGreaterThan(30);
        for (const u of urls) expect(fs.existsSync(path.join(uploadsDir, u.replace('/uploads/files/', '')))).toBe(true);
      });

      it('7-9. search finds vendors and products; product details open', async () => {
        const found = expectData<any>(await world.api('get', '/search', { query: { q: 'Pizza' } }));
        expect(found.vendors.data.length + found.products.data.length).toBeGreaterThan(0);
        expect(found.vendors.data.some((v: any) => /pizza/i.test(v.name ?? v.vendorName ?? ''))).toBe(true);
        const productHit = expectData<any>(await world.api('get', '/search', { query: { q: 'Tomatoes' } })).products.data[0];
        expect(productHit).toBeDefined();
        const details = expectData<any>(await world.api('get', `/products/${productHit.id ?? productHit.productId}`));
        expect(details).toMatchObject({ id: productHit.id ?? productHit.productId });
        expect(Number(details.priceMinor)).toBeGreaterThan(0);
      });

      it('option groups (variants) load for the products that have them', async () => {
        const [withOption] = await world.ds.query(`SELECT p.id FROM products p JOIN product_options o ON o.product_id = p.id LIMIT 1`);
        const details = expectData<any>(await world.api('get', `/products/${withOption.id}`));
        expect(details.options.length).toBeGreaterThan(0);
        expect(details.options[0].values.length).toBeGreaterThan(0);
      });

      it('10-12. the demo journey: browse → open a vendor → add products → reach a checkout quote that can be placed', async () => {
        await s.configureDeliveryPricing();
        const zone = await s.deliveryZone({ serviceAreaId: areaId, feeMinor: 1500 });
        const customer: Actor = await s.customer('Demo Shopper');
        const restaurants = sectors.find((x) => x.slug === 'restaurants');
        const vendor = (await vendorsOf(restaurants.id))[0];
        const branchId = vendor.vendorBranchId ?? vendor.id;
        const products = expectData<any[]>(await world.api('get', `/vendor-branches/${branchId}/products`, { query: { limit: '100' } })).filter((p) => p.pricingUnit === 'PIECE');
        await s.addToCart(customer, products[0].id, 2);
        await s.addToCart(customer, products[1].id, 1);
        const quote = expectData<any>(
          await world.api('post', '/checkout/quote', { token: customer.accessToken, body: { deliveryAddress: { line1: 'Demo street 1', deliveryZoneId: zone.id }, paymentMethod: 'COD' } }),
          201,
        );
        expect(quote.canPlaceOrder).toBe(true);
        expect(quote.blockers).toEqual([]);
        expect(quote.summary.subtotalMinor).toBe(2 * Number(products[0].priceMinor) + Number(products[1].priceMinor));
        expect(quote.summary.totalMinor).toBeGreaterThan(quote.summary.subtotalMinor);
      });

      it('the customer app can read the banners: 5, with images and a category destination', async () => {
        const banners = expectData<any[]>(await world.api('get', '/home-banners'));
        expect(banners).toHaveLength(5);
        for (const b of banners) {
          expect(b.imageUrl).toMatch(/^\/uploads\/files\/marketplace\/banners\//);
          expect(b.actionType).toBe('SECTOR');
          expect(sectors.map((x) => x.id)).toContain(b.actionTargetId);
        }
      });
    });

    it('demo records are clearly identified: demonstration address text, no opening hours, no invented contact data', async () => {
      const [branch] = await world.ds.query('SELECT address, opening_hours, latitude, longitude FROM vendor_branches LIMIT 1');
      expect(branch.address).toMatch(/Demonstration listing/);
      expect(branch.opening_hours).toEqual({});
      const phones = await world.ds.query(`SELECT 1 FROM users WHERE id IN (SELECT entity_id FROM demo_seed_records)`);
      expect(phones).toEqual([]); // the importer creates no user, no phone number
    });

    it('branches are synthetic points INSIDE the service area, all different', async () => {
      const [area] = await world.ds.query('SELECT center_latitude AS lat, center_longitude AS lng, radius_meters AS r FROM service_areas WHERE id = $1', [areaId]);
      const rows = await world.ds.query('SELECT latitude, longitude FROM vendor_branches');
      expect(new Set(rows.map((r: any) => `${r.latitude},${r.longitude}`)).size).toBe(30);
      for (const r of rows) {
        const dLat = ((r.latitude - area.lat) * Math.PI) / 180;
        const dLng = ((r.longitude - area.lng) * Math.PI) / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos((area.lat * Math.PI) / 180) * Math.cos((r.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
        expect(2 * 6371000 * Math.asin(Math.sqrt(a))).toBeLessThan(Number(area.r));
      }
    });

    describe('idempotency and non-destructiveness', () => {
      it('running it again creates NOTHING and changes no row count', async () => {
        const before = await count('SELECT (SELECT COUNT(*) FROM vendors) + (SELECT COUNT(*) FROM products) + (SELECT COUNT(*) FROM demo_seed_records) + (SELECT COUNT(*) FROM home_banners) + (SELECT COUNT(*) FROM vendor_branches) n');
        const again = await runDemoImport(world.ds, DEMO_CATALOG, options());
        expect(again.errors).toEqual([]);
        expect(again.items.filter((i) => i.action === 'CREATE')).toEqual([]);
        expect(again.counts.VENDOR).toEqual({ EXISTS: 30 });
        const after = await count('SELECT (SELECT COUNT(*) FROM vendors) + (SELECT COUNT(*) FROM products) + (SELECT COUNT(*) FROM demo_seed_records) + (SELECT COUNT(*) FROM home_banners) + (SELECT COUNT(*) FROM vendor_branches) n');
        expect(after).toBe(before);
      });

      it('an admin\'s edits to a demo record survive a re-run (renamed vendor, repriced product, deactivated product) — and nothing is duplicated', async () => {
        const [vendor] = await world.ds.query(`SELECT entity_id id FROM demo_seed_records WHERE demo_key = 'vendor:flatini-pizza'`);
        await world.ds.query(`UPDATE vendors SET name = 'Flatini Pizza (renamed by admin)' WHERE id = $1`, [vendor.id]);
        const [product] = await world.ds.query(`SELECT entity_id id FROM demo_seed_records WHERE demo_key = 'product:flatini-pizza:veggie-pizza'`);
        await world.ds.query(`UPDATE products SET price_minor = 99900, is_available = false WHERE id = $1`, [product.id]);
        const again = await runDemoImport(world.ds, DEMO_CATALOG, options());
        expect(again.items.filter((i) => i.action === 'CREATE')).toEqual([]);
        const [v] = await world.ds.query('SELECT name FROM vendors WHERE id = $1', [vendor.id]);
        expect(v.name).toBe('Flatini Pizza (renamed by admin)');
        const [p] = await world.ds.query('SELECT price_minor, is_available FROM products WHERE id = $1', [product.id]);
        expect(Number(p.price_minor)).toBe(99900);
        expect(p.is_available).toBe(false);
        expect(await count(`SELECT COUNT(*) n FROM vendors WHERE name ILIKE 'Flatini Pizza%'`)).toBe(1);
      });

      it('a product ADDED to the catalogue later is created on the next run; everything else is left alone', async () => {
        const extended = {
          ...DEMO_CATALOG,
          vendors: DEMO_CATALOG.vendors.map((v) =>
            v.slug === 'tea-house' ? { ...v, categories: [{ ...v.categories[0], products: [...v.categories[0].products, { name: 'Jasmine Tea Bags (25)', nameAr: 'شاي ياسمين أكياس (25)', priceMinor: 5200 }] }, ...v.categories.slice(1)] } : v,
          ),
        };
        const r = await runDemoImport(world.ds, extended, options());
        expect(r.items.filter((i) => i.action === 'CREATE').map((i) => i.demoKey)).toEqual(['product:tea-house:jasmine-tea-bags-25']);
      });

      it('an admin who DELETED a demo vendor does not get it back', async () => {
        const [vendor] = await world.ds.query(`SELECT entity_id id FROM demo_seed_records WHERE demo_key = 'vendor:zaman-koshary'`);
        await world.ds.query('UPDATE vendors SET deleted_at = now() WHERE id = $1', [vendor.id]);
        const r = await runDemoImport(world.ds, DEMO_CATALOG, options());
        expect(r.items.find((i) => i.demoKey === 'vendor:zaman-koshary')).toMatchObject({ action: 'DELETED_BY_ADMIN' });
        expect(r.items.filter((i) => i.action === 'CREATE')).toEqual([]);
        await world.ds.query('UPDATE vendors SET deleted_at = NULL WHERE id = $1', [vendor.id]);
      });
    });

    describe('replacement at launch', () => {
      it('--report style listing shows every demo record and its state', async () => {
        const rows = await listDemoRecords(world.ds);
        expect(rows.length).toBe(await count('SELECT COUNT(*) n FROM demo_seed_records'));
        expect(rows.every((r) => r.exists)).toBe(true);
      });

      it('deactivation takes ONLY demo content off the app, deletes nothing, and leaves a real merchant live', async () => {
        const realSector = (await world.ds.query(`INSERT INTO marketplace_sectors (name, name_ar, slug, sort_order, is_active) VALUES ('Real Sector', 'قطاع حقيقي', 'real-sector', 99, true) RETURNING id`))[0];
        const realVendor = (await world.ds.query(`INSERT INTO vendors (name, name_ar, is_active) VALUES ('Real Merchant', 'تاجر حقيقي', true) RETURNING id`))[0];
        const rowsBefore = await count('SELECT (SELECT COUNT(*) FROM vendors) + (SELECT COUNT(*) FROM products) + (SELECT COUNT(*) FROM marketplace_sectors) + (SELECT COUNT(*) FROM demo_seed_records) n');
        const result = await deactivateDemoRecords(world.ds);
        expect(result.deactivated.VENDOR).toBeGreaterThanOrEqual(29);
        expect(await count('SELECT COUNT(*) n FROM vendors WHERE is_active')).toBe(1); // only the real merchant
        expect(await count('SELECT COUNT(*) n FROM products WHERE is_available')).toBe(0);
        expect(await count('SELECT COUNT(*) n FROM marketplace_sectors WHERE is_active')).toBe(1);
        expect((await world.ds.query('SELECT is_active FROM vendors WHERE id = $1', [realVendor.id]))[0].is_active).toBe(true);
        expect((await world.ds.query('SELECT is_active FROM marketplace_sectors WHERE id = $1', [realSector.id]))[0].is_active).toBe(true);
        expect(await count('SELECT (SELECT COUNT(*) FROM vendors) + (SELECT COUNT(*) FROM products) + (SELECT COUNT(*) FROM marketplace_sectors) + (SELECT COUNT(*) FROM demo_seed_records) n')).toBe(rowsBefore);
        // …and the customer app no longer shows any of it.
        const sectors = expectData<any[]>(await world.api('get', '/sectors'));
        expect(sectors.map((x) => x.slug)).toEqual(['real-sector']);
        expect(expectData<any[]>(await world.api('get', '/home-banners'))).toEqual([]);
      });
    });
  });
});
