/**
 * Catalog Foundation + product-first API over real HTTP and real PostgreSQL: an admin-curated marketplace
 * product identity (`catalog_products`), EXPLICIT links to the existing vendor listings (`products`),
 * `GET /products?sectorId=`, `GET /catalog-products/:id`, and the additive fields on `GET /products/:id`
 * and search. Also proves the existing vendor-scoped browsing and the cart still use the listing id.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';

describe('E2E — catalog products (marketplace product identity)', () => {
  let world: World;
  let s: Scenario;
  let superAdmin: Actor;
  let customer: Actor;
  let area: { id: string; lat: number; lng: number };
  let farArea: { id: string; lat: number; lng: number };
  let sectorId: string;
  let otherSectorId: string;
  let v1: VendorFixture;
  let v2: VendorFixture;
  let v3: VendorFixture;
  let vFar: VendorFixture;
  const home = { latitude: 30.425, longitude: 31.565 };
  const codeOf = (r: { body: any }) => r.body.error?.details?.code;
  const admin = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: unknown, query?: Record<string, string | number | boolean>) =>
    world.api(method, path, { token: superAdmin.accessToken, ...(body !== undefined ? { body } : {}), ...(query ? { query } : {}) });
  const createCatalog = async (over: Record<string, unknown> = {}) =>
    expectData(await admin('post', '/admin/catalog-products', { name: 'Cola 1.25L', pricingUnit: 'PIECE', ...over }), 201);
  const link = (catalogId: string, productId: string) => admin('post', `/admin/catalog-products/${catalogId}/listings`, { productId });
  const listing = (sector = sectorId, query: Record<string, string | number | boolean> = {}) =>
    world.api('get', '/products', { query: { sectorId: sector, ...query } });
  const items = (res: { body: any; status: number }) => expectData<any[]>(res);
  const window = () => ({ startAt: new Date(Date.now() - 3600_000).toISOString(), endAt: new Date(Date.now() + 86_400_000).toISOString() });

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    superAdmin = await s.superAdmin();
    customer = await s.customer();
    area = await s.serviceArea({ radiusMeters: 30000 });
    farArea = await s.serviceArea({ name: 'Far Area', lat: 27.0, lng: 30.0, radiusMeters: 20000 });
    sectorId = (await s.sector('Beverages')).id;
    otherSectorId = (await s.sector('Pharmacy')).id;
    v1 = await s.vendor({ name: 'Market One', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    v2 = await s.vendor({ name: 'Market Two', serviceAreaId: area.id, lat: 30.422, lng: 31.562 });
    v3 = await s.vendor({ name: 'Market Three', serviceAreaId: area.id, lat: 30.423, lng: 31.563 });
    vFar = await s.vendor({ name: 'Far Market', serviceAreaId: farArea.id, lat: 27.001, lng: 30.001 });
    for (const v of [v1, v2, v3, vFar]) await s.assignSector(v, sectorId);
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  // ------------------------------------------------------------------ admin: create / update / activate

  describe('admin catalog products', () => {
    it('creates a catalog product (active by default) and returns it', async () => {
      const created = await createCatalog({ nameAr: 'كولا', brand: 'Cola Co', barcode: '6221234567890', description: 'Fizzy' });
      expect(created).toMatchObject({ name: 'Cola 1.25L', nameAr: 'كولا', brand: 'Cola Co', pricingUnit: 'PIECE', barcode: '6221234567890', isActive: true });
      expect(created.id).toEqual(expect.any(String));
      const row = (await world.ds.query('SELECT * FROM catalog_products WHERE id = $1', [created.id]))[0];
      expect(row).toMatchObject({ name: 'Cola 1.25L', pricing_unit: 'PIECE', is_active: true });
    });

    it('validates input, keeps the barcode unique among live catalog products, and is permission-gated', async () => {
      expect((await admin('post', '/admin/catalog-products', { pricingUnit: 'PIECE' })).status).toBe(400); // name required
      expect((await admin('post', '/admin/catalog-products', { name: 'X', pricingUnit: 'BOX' })).status).toBe(400);
      const first = await createCatalog({ name: 'Barcode A', barcode: 'GTIN-DUP-1' });
      const dup = await admin('post', '/admin/catalog-products', { name: 'Barcode B', pricingUnit: 'PIECE', barcode: 'GTIN-DUP-1' });
      expect(dup.status).toBe(409);
      expect(codeOf(dup)).toBe('CATALOG_BARCODE_ALREADY_EXISTS');
      // two products WITHOUT a barcode are fine (NULLs never collide)
      await createCatalog({ name: 'No barcode 1' });
      await createCatalog({ name: 'No barcode 2' });
      // a barcode match is information only: the lookup returns it, nothing gets linked
      const found = await admin('get', '/admin/catalog-products', undefined, { barcode: 'GTIN-DUP-1' });
      expect(expectData<any[]>(found).map((c) => c.id)).toEqual([first.id]);

      const noPerm = await s.admin([]);
      expect((await world.api('get', '/admin/catalog-products', { token: noPerm.accessToken })).status).toBe(403);
      expect((await world.api('post', '/admin/catalog-products', { token: v1.manager.accessToken, body: { name: 'Nope', pricingUnit: 'PIECE' } })).status).toBe(403);
      expect((await world.api('post', '/admin/catalog-products', { body: { name: 'Nope', pricingUnit: 'PIECE' } })).status).toBe(401);
      const withPerm = await s.admin(['MANAGE_CATALOG' as never]);
      expect((await world.api('get', '/admin/catalog-products', { token: withPerm.accessToken })).status).toBe(200);
    });

    it('updates, clears optional fields, activates/deactivates, and lists with filters', async () => {
      const c = await createCatalog({ name: 'Updatable', brand: 'B1', barcode: 'GTIN-UPD-1' });
      const updated = expectData(await admin('patch', `/admin/catalog-products/${c.id}`, { name: 'Updatable 2', brand: null, barcode: null, nameAr: 'قابل' }));
      expect(updated).toMatchObject({ name: 'Updatable 2', brand: null, barcode: null, nameAr: 'قابل' });
      const off = expectData(await admin('patch', `/admin/catalog-products/${c.id}/deactivate`));
      expect(off.isActive).toBe(false);
      expect(expectData<any[]>(await admin('get', '/admin/catalog-products', undefined, { isActive: 'false', search: 'Updatable' })).map((x) => x.id)).toEqual([c.id]);
      expect(expectData(await admin('patch', `/admin/catalog-products/${c.id}/activate`)).isActive).toBe(true);
      const one = expectData(await admin('get', `/admin/catalog-products/${c.id}`));
      expect(one).toMatchObject({ id: c.id, listings: [] });
      expect((await admin('get', '/admin/catalog-products/not-a-uuid')).status).toBe(400);
      expect((await admin('get', '/admin/catalog-products/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    });
  });

  // ------------------------------------------------------------------ explicit link / unlink

  describe('linking a vendor listing', () => {
    it('links explicitly, keeps the listing id and all its data, and unlinks again', async () => {
      const catalog = await createCatalog({ name: 'Link Me' });
      const p = await s.product(v1, { name: 'Different Name Entirely', priceMinor: 9000 });
      const before = (await world.ds.query('SELECT id, price_minor, name, vendor_branch_id FROM products WHERE id = $1', [p.id]))[0];

      const linked = expectData(await link(catalog.id, p.id), 201);
      expect(linked).toMatchObject({ id: p.id, catalogProductId: catalog.id, priceMinor: 9000 });
      const after = (await world.ds.query('SELECT id, price_minor, name, vendor_branch_id, catalog_product_id FROM products WHERE id = $1', [p.id]))[0];
      expect(after).toMatchObject({ id: before.id, price_minor: before.price_minor, name: before.name, vendor_branch_id: before.vendor_branch_id, catalog_product_id: catalog.id });
      // idempotent for the same pair
      expectData(await link(catalog.id, p.id), 201);
      // shows up in the admin detail
      const detail = expectData(await admin('get', `/admin/catalog-products/${catalog.id}`));
      expect(detail.listings.map((l: any) => l.id)).toEqual([p.id]);

      const unlinked = expectData(await admin('delete', `/admin/catalog-products/${catalog.id}/listings/${p.id}`));
      expect(unlinked.catalogProductId).toBeNull();
      expect((await world.ds.query('SELECT catalog_product_id FROM products WHERE id = $1', [p.id]))[0].catalog_product_id).toBeNull();
      const again = await admin('delete', `/admin/catalog-products/${catalog.id}/listings/${p.id}`);
      expect(again.status).toBe(404);
      expect(codeOf(again)).toBe('LISTING_NOT_LINKED');
      // and can be linked again afterwards
      expectData(await link(catalog.id, p.id), 201);
    });

    it('never links by name or barcode on its own: a same-named listing / same barcode stays unlinked', async () => {
      const catalog = await createCatalog({ name: 'Twin Name', barcode: 'GTIN-TWIN' });
      const twin = await s.product(v2, { name: 'Twin Name', priceMinor: 5000 });
      expect((await world.ds.query('SELECT catalog_product_id FROM products WHERE id = $1', [twin.id]))[0].catalog_product_id).toBeNull();
      const detail = expectData(await admin('get', `/admin/catalog-products/${catalog.id}`));
      expect(detail.listings).toEqual([]);
    });

    it('rejects the same catalog product twice in one branch (also enforced by the DB), allows it in different branches', async () => {
      const catalog = await createCatalog({ name: 'Once Per Branch' });
      const a1 = await s.product(v1, { name: 'A1' });
      const a2 = await s.product(v1, { name: 'A2' });
      const b1 = await s.product(v2, { name: 'B1' });
      expectData(await link(catalog.id, a1.id), 201);
      const dup = await link(catalog.id, a2.id);
      expect(dup.status).toBe(409);
      expect(codeOf(dup)).toBe('CATALOG_PRODUCT_ALREADY_LISTED_IN_BRANCH');
      expectData(await link(catalog.id, b1.id), 201); // different branch: fine

      // the partial unique index is the real guarantee — bypass the API and hit it directly
      await expect(world.ds.query('UPDATE products SET catalog_product_id = $1 WHERE id = $2', [catalog.id, a2.id])).rejects.toMatchObject({ code: '23505' });

      // a SOFT-DELETED listing never blocks a future one
      await world.ds.query('UPDATE products SET deleted_at = now() WHERE id = $1', [a1.id]);
      expectData(await link(catalog.id, a2.id), 201);
    });

    it('rejects a pricing_unit mismatch and locks the catalog pricing unit while listings are linked', async () => {
      const pieceCatalog = await createCatalog({ name: 'Piece Only', pricingUnit: 'PIECE' });
      const weighted = await s.product(v1, { name: 'By Weight', pricingUnit: 'WEIGHT', priceMinor: 4000 });
      const mismatch = await link(pieceCatalog.id, weighted.id);
      expect(mismatch.status).toBe(400);
      expect(codeOf(mismatch)).toBe('PRICING_UNIT_MISMATCH');
      expect((await world.ds.query('SELECT catalog_product_id FROM products WHERE id = $1', [weighted.id]))[0].catalog_product_id).toBeNull();

      const piece = await s.product(v1, { name: 'A Piece' });
      expectData(await link(pieceCatalog.id, piece.id), 201);
      const locked = await admin('patch', `/admin/catalog-products/${pieceCatalog.id}`, { pricingUnit: 'WEIGHT' });
      expect(locked.status).toBe(409);
      expect(codeOf(locked)).toBe('PRICING_UNIT_LOCKED');
      // with nothing linked it can change
      const free = await createCatalog({ name: 'Changeable', pricingUnit: 'PIECE' });
      expect(expectData(await admin('patch', `/admin/catalog-products/${free.id}`, { pricingUnit: 'WEIGHT' })).pricingUnit).toBe('WEIGHT');
    });

    it('rejects a listing linked elsewhere, an inactive catalog product, and unknown/soft-deleted records', async () => {
      const c1 = await createCatalog({ name: 'Owner 1' });
      const c2 = await createCatalog({ name: 'Owner 2' });
      const p = await s.product(v3, { name: 'Linked Once' });
      expectData(await link(c1.id, p.id), 201);
      const elsewhere = await link(c2.id, p.id);
      expect(elsewhere.status).toBe(409);
      expect(codeOf(elsewhere)).toBe('LISTING_ALREADY_LINKED');

      const inactive = await createCatalog({ name: 'Inactive One', isActive: false });
      const q = await s.product(v3, { name: 'Q' });
      const rejected = await link(inactive.id, q.id);
      expect(rejected.status).toBe(409);
      expect(codeOf(rejected)).toBe('CATALOG_PRODUCT_INACTIVE');

      expect((await link('00000000-0000-4000-8000-000000000000', q.id)).status).toBe(404);
      expect((await link(c2.id, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect((await admin('post', `/admin/catalog-products/${c2.id}/listings`, { productId: 'nope' })).status).toBe(400);
      await world.ds.query('UPDATE products SET deleted_at = now() WHERE id = $1', [q.id]);
      expect((await link(c2.id, q.id)).status).toBe(404); // soft-deleted listing
      await world.ds.query('UPDATE catalog_products SET deleted_at = now() WHERE id = $1', [c2.id]);
      expect((await admin('get', `/admin/catalog-products/${c2.id}`)).status).toBe(404); // soft-deleted catalog product
    });
  });

  // ------------------------------------------------------------------ GET /products?sectorId=

  describe('product-first listing', () => {
    let cola: { id: string };
    let colaV1: { id: string };
    let colaV2: { id: string };
    let colaV3: { id: string };
    let solo: { id: string };
    let single: { id: string };
    let singleListing: { id: string };
    let plain: { id: string };

    beforeAll(async () => {
      // an isolated sector so the assertions below see exactly this data
      const sec = (await s.sector('Grocery Listing')).id;
      const g1 = await s.vendor({ name: 'Grocer 1', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
      const g2 = await s.vendor({ name: 'Grocer 2', serviceAreaId: area.id, lat: 30.422, lng: 31.562 });
      const g3 = await s.vendor({ name: 'Grocer 3', serviceAreaId: area.id, lat: 30.423, lng: 31.563 });
      for (const g of [g1, g2, g3]) await s.assignSector(g, sec);
      (globalThis as any).__listingSector = sec;
      cola = await createCatalog({ name: 'Grocery Cola 1.25L', nameAr: 'كولا ١٫٢٥', brand: 'Cola Co', imageUrl: 'https://img.test/cola.png' });
      colaV1 = await s.product(g1, { name: 'Cola 1.25 litre', priceMinor: 3000 });
      colaV2 = await s.product(g2, { name: 'COCA-COLA family', priceMinor: 2500 });
      colaV3 = await s.product(g3, { name: 'cola bottle', priceMinor: 2800 });
      for (const p of [colaV1, colaV2, colaV3]) expectData(await link(cola.id, p.id), 201);
      solo = await createCatalog({ name: 'Grocery Water 1L' });
      singleListing = await s.product(g1, { name: 'Water 1 litre', priceMinor: 900 });
      expectData(await link(solo.id, singleListing.id), 201);
      plain = await s.product(g2, { name: 'Grocery Plain Rice', priceMinor: 6000 });
      single = { id: singleListing.id };
    });

    const sec = () => (globalThis as any).__listingSector as string;

    it('an UNLINKED listing is its own item: catalogProductId null, listingId = its product id, storeCount 1', async () => {
      const res = items(await listing(sec()));
      const rice = res.find((i) => i.name === 'Grocery Plain Rice');
      expect(rice).toMatchObject({ catalogProductId: null, listingId: plain.id, storeCount: 1, fromPriceMinor: 6000, pricingUnit: 'PIECE', hasOffer: false });
    });

    it('two+ listings of one catalog product collapse into ONE item with correct fromPriceMinor and storeCount', async () => {
      const res = items(await listing(sec()));
      const colas = res.filter((i) => i.catalogProductId === cola.id);
      expect(colas).toHaveLength(1);
      expect(colas[0]).toMatchObject({
        catalogProductId: cola.id,
        listingId: null, // more than one relevant listing
        name: 'Grocery Cola 1.25L', // shared catalog display fields, not any vendor's own name
        nameAr: 'كولا ١٫٢٥',
        brand: 'Cola Co',
        imageUrl: 'https://img.test/cola.png',
        fromPriceMinor: 2500,
        storeCount: 3,
        hasOffer: false,
      });
      // none of the three vendor listings also appears as its own item
      for (const p of [colaV1, colaV2, colaV3]) expect(res.find((i) => i.listingId === p.id)).toBeUndefined();
    });

    it('a catalog product with exactly ONE relevant listing exposes that listingId (and still its catalogProductId)', async () => {
      const res = items(await listing(sec()));
      const water = res.find((i) => i.catalogProductId === solo.id);
      expect(water).toMatchObject({ listingId: single.id, storeCount: 1, fromPriceMinor: 900 });
      expect(res).toHaveLength(3); // cola group, water, rice
    });

    it('searches the SHARED name for linked items (not each vendor\'s own spelling) and the listing name for unlinked ones', async () => {
      const byCatalogName = items(await listing(sec(), { search: 'grocery cola' }));
      expect(byCatalogName.map((i) => i.catalogProductId)).toEqual([cola.id]);
      expect(byCatalogName[0].storeCount).toBe(3);
      // a vendor's own name for a LINKED listing does not match on its own
      expect(items(await listing(sec(), { search: 'COCA' }))).toEqual([]);
      const byListingName = items(await listing(sec(), { search: 'plain rice' }));
      expect(byListingName.map((i) => i.name)).toEqual(['Grocery Plain Rice']);
      expect(items(await listing(sec(), { search: 'x' }))).toHaveLength(3); // below the 2-char minimum: no filter
    });

    it('sorts at group level, paginates over GROUPS, and documents price semantics (fromPriceMinor)', async () => {
      const asc = items(await listing(sec(), { sort: 'price_asc' }));
      expect(asc.map((i) => i.fromPriceMinor)).toEqual([900, 2500, 6000]);
      const desc = items(await listing(sec(), { sort: 'price_desc' }));
      expect(desc.map((i) => i.fromPriceMinor)).toEqual([6000, 2500, 900]);
      const page2 = await listing(sec(), { sort: 'price_asc', page: 2, limit: 1 });
      expect(items(page2).map((i) => i.fromPriceMinor)).toEqual([2500]);
      expect(page2.body.meta).toMatchObject({ page: 2, limit: 1, total: 3 });
      const newest = items(await listing(sec(), { sort: 'newest' }));
      expect(newest).toHaveLength(3);
      expect(items(await listing(sec()))).toHaveLength(3); // default = newest
      expect(items(await listing(sec(), { sort: 'bestSelling' }))).toHaveLength(3);
      // highestRated needs the same minimum number of ratings as everywhere else → none qualifies yet
      expect(items(await listing(sec(), { sort: 'highestRated' }))).toEqual([]);
      await world.ds.query('UPDATE products SET rating_count = 5, rating_sum_stars = 25 WHERE id = ANY($1::uuid[])', [[colaV1.id, colaV2.id]]);
      const rated = items(await listing(sec(), { sort: 'highestRated' }));
      expect(rated.map((i) => i.catalogProductId)).toEqual([cola.id]); // aggregated across its listings
    });

    it('validates its inputs (sectorId required, uuid, unknown sort, unknown/inactive sector) with clean 4xx', async () => {
      expect((await world.api('get', '/products')).status).toBe(400);
      expect((await world.api('get', '/products', { query: { sectorId: 'nope' } })).status).toBe(400);
      expect((await listing(sec(), { sort: 'cheapest' })).status).toBe(400);
      expect((await world.api('get', '/products', { query: { sectorId: '00000000-0000-4000-8000-000000000000' } })).status).toBe(404);
      expect(items(await listing(otherSectorId))).toEqual([]); // a sector with no vendors is simply empty
    });

    it('does not expose products outside the requested sector', async () => {
      const res = items(await listing(otherSectorId));
      expect(res).toEqual([]);
      const beverages = items(await listing(sectorId));
      expect(beverages.find((i) => i.name === 'Grocery Plain Rice')).toBeUndefined();
    });

    it('applies the existing service-area rule: inside → listed, another area → only its own vendors, outside every area → empty', async () => {
      const inside = items(await listing(sec(), home));
      expect(inside).toHaveLength(3);
      const outside = await listing(sec(), { latitude: 10.0, longitude: 10.0 });
      expect(outside.status).toBe(200);
      expect(outside.body.data).toEqual([]);
      expect(outside.body.meta.total).toBe(0);
      // Beverages sector has one vendor in the far area only
      const far = await world.api('get', '/products', { query: { sectorId, latitude: 27.001, longitude: 30.001 } });
      expect(expectData<any[]>(far).every((i) => i.name !== 'Grocery Plain Rice')).toBe(true);
    });

    it('excludes inactive/unavailable listings and inactive branches/vendors; an emptied group disappears, a shrunken group updates', async () => {
      // unavailable listing → storeCount 3 → 2, fromPrice recomputed
      expectData(await admin('patch', `/admin/products/${colaV2.id}/deactivate`));
      let colaItem = items(await listing(sec())).find((i) => i.catalogProductId === cola.id);
      expect(colaItem).toMatchObject({ storeCount: 2, fromPriceMinor: 2800, listingId: null });
      // inactive branch
      await world.ds.query('UPDATE vendor_branches SET is_active = false WHERE id = (SELECT vendor_branch_id FROM products WHERE id = $1)', [colaV3.id]);
      colaItem = items(await listing(sec())).find((i) => i.catalogProductId === cola.id);
      expect(colaItem).toMatchObject({ storeCount: 1, listingId: colaV1.id, fromPriceMinor: 3000 });
      // inactive vendor
      await world.ds.query('UPDATE vendors SET is_active = false WHERE id = (SELECT b.vendor_id FROM products p JOIN vendor_branches b ON b.id = p.vendor_branch_id WHERE p.id = $1)', [colaV1.id]);
      expect(items(await listing(sec())).find((i) => i.catalogProductId === cola.id)).toBeUndefined();
      // restore for later tests
      expectData(await admin('patch', `/admin/products/${colaV2.id}/activate`));
      await world.ds.query('UPDATE vendor_branches SET is_active = true WHERE id = (SELECT vendor_branch_id FROM products WHERE id = $1)', [colaV3.id]);
      await world.ds.query('UPDATE vendors SET is_active = true WHERE id = (SELECT b.vendor_id FROM products p JOIN vendor_branches b ON b.id = p.vendor_branch_id WHERE p.id = $1)', [colaV1.id]);
      expect(items(await listing(sec())).find((i) => i.catalogProductId === cola.id)?.storeCount).toBe(3);
    });

    it('signals hasOffer when ANY listing of the group has an active offer (offers stay per-branch)', async () => {
      const branch = (await world.ds.query('SELECT vendor_branch_id FROM products WHERE id = $1', [colaV2.id]))[0].vendor_branch_id;
      expectData(await admin('post', '/admin/offers', { vendorBranchId: branch, name: 'Cola flash', mechanism: 'FLASH_SALE', specialPriceMinor: 2000, productIds: [colaV2.id], ...window() }), 201);
      expect(items(await listing(sec())).find((i) => i.catalogProductId === cola.id)?.hasOffer).toBe(true);
      expect(items(await listing(sec())).find((i) => i.catalogProductId === solo.id)?.hasOffer).toBe(false);
    });

    it('an INACTIVE catalog product is not public: its listings appear as ordinary individual items', async () => {
      expectData(await admin('patch', `/admin/catalog-products/${cola.id}/deactivate`));
      const res = items(await listing(sec()));
      expect(res.find((i) => i.catalogProductId === cola.id)).toBeUndefined();
      for (const p of [colaV1, colaV2, colaV3]) expect(res.find((i) => i.listingId === p.id)).toMatchObject({ catalogProductId: null, storeCount: 1 });
      expect((await world.api('get', `/catalog-products/${cola.id}`)).status).toBe(404);
      expectData(await admin('patch', `/admin/catalog-products/${cola.id}/activate`));
      expect(items(await listing(sec())).find((i) => i.catalogProductId === cola.id)?.storeCount).toBe(3);
    });
  });

  // ------------------------------------------------------------------ GET /catalog-products/:id

  describe('catalog product details (vendor selector data)', () => {
    let catalog: { id: string };
    let l1: { id: string };
    let l2: { id: string };
    let l3: { id: string };
    let lFar: { id: string };

    beforeAll(async () => {
      catalog = await createCatalog({ name: 'Selector Cola', nameAr: 'كولا الاختيار', description: 'Cold', brand: 'Cola Co', barcode: 'GTIN-SELECTOR' });
      l1 = await s.product(v1, { name: 'v1 cola', priceMinor: 3100, inventoryMode: 'TRACKED', quantity: 4 });
      l2 = await s.product(v2, { name: 'v2 cola', priceMinor: 2600 });
      l3 = await s.product(v3, { name: 'v3 cola', priceMinor: 2900 });
      lFar = await s.product(vFar, { name: 'far cola', priceMinor: 2000 });
      for (const p of [l1, l2, l3, lFar]) expectData(await link(catalog.id, p.id), 201);
      await world.ds.query('UPDATE vendor_branches SET rating_count = 4, rating_sum_stars = 18, is_open = true WHERE id = $1', [v2.branchId]);
      const b1 = v1.branchId;
      expectData(await admin('post', '/admin/offers', { vendorBranchId: b1, name: 'l1 flash', mechanism: 'FLASH_SALE', specialPriceMinor: 2400, productIds: [l1.id], ...window() }), 201);
    });

    it('returns the shared identity and every relevant vendor listing, sorted by price ascending, with real branch data', async () => {
      const details = expectData(await world.api('get', `/catalog-products/${catalog.id}`));
      expect(details).toMatchObject({ id: catalog.id, name: 'Selector Cola', nameAr: 'كولا الاختيار', description: 'Cold', brand: 'Cola Co', pricingUnit: 'PIECE', storeCount: 4 });
      expect(details.barcode).toBeUndefined(); // identity plumbing is not public data
      expect(details.listings.map((l: any) => l.listingId)).toEqual([lFar.id, l2.id, l3.id, l1.id]); // 2000, 2600, 2900, 3100
      const two = details.listings.find((l: any) => l.listingId === l2.id);
      expect(two).toMatchObject({
        vendorBranchId: v2.branchId,
        vendor: { id: v2.vendorId, name: 'Market Two', nameAr: null, logoUrl: null },
        isOpen: true,
        ratingAverage: 4.5,
        ratingCount: 4,
        priceMinor: 2600,
        activeOffer: null,
        isAvailable: true,
        inventoryMode: 'OPEN',
        quantity: null,
      });
      const one = details.listings.find((l: any) => l.listingId === l1.id);
      expect(one).toMatchObject({ inventoryMode: 'TRACKED', quantity: 4, ratingAverage: 0, ratingCount: 0, activeOffer: { mechanism: 'FLASH_SALE', specialPriceMinor: 2400 } });
      // no fabricated ETA / delivery fee anywhere
      for (const l of details.listings) {
        expect(l).not.toHaveProperty('eta');
        expect(l).not.toHaveProperty('etaMinutes');
        expect(l).not.toHaveProperty('deliveryFeeMinor');
      }
    });

    it('filters by service area when coordinates are supplied; outside every area → no listings; only the identity remains', async () => {
      const home1 = expectData(await world.api('get', `/catalog-products/${catalog.id}`, { query: home }));
      expect(home1.listings.map((l: any) => l.listingId)).toEqual([l2.id, l3.id, l1.id]);
      expect(home1.storeCount).toBe(3);
      const far = expectData(await world.api('get', `/catalog-products/${catalog.id}`, { query: { latitude: 27.001, longitude: 30.001 } }));
      expect(far.listings.map((l: any) => l.listingId)).toEqual([lFar.id]);
      const nowhere = expectData(await world.api('get', `/catalog-products/${catalog.id}`, { query: { latitude: 10, longitude: 10 } }));
      expect(nowhere.listings).toEqual([]);
      expect(nowhere.name).toBe('Selector Cola');
    });

    it('drops unavailable listings and listings of inactive branches/vendors', async () => {
      expectData(await admin('patch', `/admin/products/${l3.id}/deactivate`));
      await world.ds.query('UPDATE vendor_branches SET is_active = false WHERE id = $1', [v1.branchId]);
      const details = expectData(await world.api('get', `/catalog-products/${catalog.id}`, { query: home }));
      expect(details.listings.map((l: any) => l.listingId)).toEqual([l2.id]);
      expectData(await admin('patch', `/admin/products/${l3.id}/activate`));
      await world.ds.query('UPDATE vendor_branches SET is_active = true WHERE id = $1', [v1.branchId]);
      expect(expectData(await world.api('get', `/catalog-products/${catalog.id}`, { query: home })).listings).toHaveLength(3);
    });

    it('404 for unknown / soft-deleted / inactive catalog products, 400 for a malformed id or coordinates', async () => {
      expect((await world.api('get', '/catalog-products/00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect((await world.api('get', '/catalog-products/not-a-uuid')).status).toBe(400);
      expect((await world.api('get', `/catalog-products/${catalog.id}`, { query: { latitude: 999, longitude: 0 } })).status).toBe(400);
      const tmp = await createCatalog({ name: 'Soon Deleted' });
      await world.ds.query('UPDATE catalog_products SET deleted_at = now() WHERE id = $1', [tmp.id]);
      expect((await world.api('get', `/catalog-products/${tmp.id}`)).status).toBe(404);
    });
  });

  // ------------------------------------------------------------------ existing behavior is preserved

  describe('existing behavior is preserved', () => {
    it('vendor-scoped product browsing returns exactly what it did before (no catalog fields, no relations leaked)', async () => {
      const catalog = await createCatalog({ name: 'Vendor Scoped Catalog' });
      const p = await s.product(v1, { name: 'Vendor Scoped Item', priceMinor: 7000 });
      expectData(await link(catalog.id, p.id), 201);
      const list = expectData<any[]>(await world.api('get', `/vendor-branches/${v1.branchId}/products`, { query: { search: 'Vendor Scoped' } }));
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: p.id, name: 'Vendor Scoped Item', priceMinor: 7000, vendorBranchId: v1.branchId, activeOffer: null });
      expect(list[0]).not.toHaveProperty('catalogProductId');
      expect(list[0]).not.toHaveProperty('vendorBranch');
      const asc = expectData<any[]>(await world.api('get', `/vendor-branches/${v1.branchId}/products`, { query: { sort: 'price_asc' } }));
      expect(asc.map((x) => x.priceMinor)).toEqual([...asc.map((x) => x.priceMinor)].sort((a, b) => a - b));
    });

    it('GET /products/:id keeps every existing field and ADDS catalogProductId + a small vendor summary', async () => {
      const catalog = await createCatalog({ name: 'Details Catalog' });
      const p = await s.product(v2, { name: 'Details Item', priceMinor: 8000 });
      const beforeLink = expectData(await world.api('get', `/products/${p.id}`));
      expect(beforeLink).toMatchObject({ id: p.id, name: 'Details Item', priceMinor: 8000, pricingUnit: 'PIECE', inventoryMode: 'OPEN', isAvailable: true, options: [], activeOffer: null, catalogProductId: null });
      expect(beforeLink.vendor).toMatchObject({ id: v2.vendorId, vendorBranchId: v2.branchId, name: 'Market Two', branchName: 'Market Two Main', isOpen: expect.any(Boolean), ratingCount: expect.any(Number) });
      expect(beforeLink).not.toHaveProperty('vendorBranch');

      expectData(await link(catalog.id, p.id), 201);
      const linked = expectData(await world.api('get', `/products/${p.id}`));
      expect(linked.catalogProductId).toBe(catalog.id);
      // every field that existed before is still present and unchanged (linking only touches updatedAt)
      for (const key of Object.keys(beforeLink).filter((k) => k !== 'catalogProductId' && k !== 'updatedAt')) expect(linked[key]).toEqual(beforeLink[key]);
      // an inactive catalog product is never exposed
      expectData(await admin('patch', `/admin/catalog-products/${catalog.id}/deactivate`));
      expect(expectData(await world.api('get', `/products/${p.id}`)).catalogProductId).toBeNull();
    });

    it('search results carry catalogProductId (active catalog only) without changing which products match', async () => {
      const catalog = await createCatalog({ name: 'Searchable Catalog' });
      const linked = await s.product(v3, { name: 'Zebra Searchable', priceMinor: 1200 });
      const unlinked = await s.product(v3, { name: 'Zebra Unlinked', priceMinor: 1300 });
      expectData(await link(catalog.id, linked.id), 201);
      const res = expectData<any>(await world.api('get', '/search', { query: { q: 'Zebra' } }));
      const byId = new Map<string, any>(res.products.data.map((x: any) => [x.id, x]));
      expect(byId.get(linked.id)?.catalogProductId).toBe(catalog.id);
      expect(byId.get(unlinked.id)?.catalogProductId).toBeNull();
      expect(res.products.data).toHaveLength(2);
      expectData(await admin('patch', `/admin/catalog-products/${catalog.id}/deactivate`));
      const after = expectData<any>(await world.api('get', '/search', { query: { q: 'Zebra' } }));
      expect(after.products.data.every((x: any) => x.catalogProductId === null)).toBe(true);
    });

    it('the cart still uses the ORIGINAL listing id, and a marketplace product can be bought from two vendors', async () => {
      const catalog = await createCatalog({ name: 'Cart Catalog' });
      const a = await s.product(v1, { name: 'Cart A', priceMinor: 4000 });
      const b = await s.product(v2, { name: 'Cart B', priceMinor: 3500 });
      expectData(await link(catalog.id, a.id), 201);
      expectData(await link(catalog.id, b.id), 201);
      const buyer = await s.customer('Catalog Buyer');
      const cart = await s.addToCart(buyer, b.id, 2);
      const group = cart.groups.find((g: any) => g.vendorBranchId === v2.branchId);
      expect(group.items[0]).toMatchObject({ productId: b.id, quantity: 2 });
      // selecting another vendor for the same marketplace product = adding THAT listing's id
      const both = await s.addToCart(buyer, a.id, 1);
      const ids = both.groups.flatMap((g: any) => g.items.map((i: any) => i.productId)).sort();
      expect(ids).toEqual([a.id, b.id].sort());
      expect(both.groups).toHaveLength(2);
      // and the catalog id is never accepted as a product id
      const bad = await world.api('post', '/cart/items', { token: buyer.accessToken, body: { productId: catalog.id, quantity: 1 } });
      expect(bad.status).toBeGreaterThanOrEqual(400);
      expect(bad.status).toBeLessThan(500);
      expectData(await world.api('delete', '/cart', { token: buyer.accessToken }));
    });

    it('deleting a catalog product (hard, via SQL) only nulls the link — listings survive (ON DELETE SET NULL)', async () => {
      const catalog = await createCatalog({ name: 'Hard Delete Catalog' });
      const p = await s.product(v3, { name: 'Survivor' });
      expectData(await link(catalog.id, p.id), 201);
      await world.ds.query('DELETE FROM catalog_products WHERE id = $1', [catalog.id]);
      const row = (await world.ds.query('SELECT id, catalog_product_id FROM products WHERE id = $1', [p.id]))[0];
      expect(row).toMatchObject({ id: p.id, catalog_product_id: null });
    });
  });
});
