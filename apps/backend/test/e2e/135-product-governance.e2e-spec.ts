/**
 * Release 2C (2026-11-07) — R7 product governance:
 *  - a vendor's price REDUCTION applies directly;
 *  - a price INCREASE, a NEW product and product-detail changes (name, description, category, image, options) need Hatly's approval, and
 *    the approved version stays live until then;
 *  - Excel / bulk paths follow the same rule per change (covered in 77-multipart-uploads);
 *  - Admin's own product edits apply directly.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';
import { boundary } from './support/external-boundary';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — product governance (R7)', () => {
  let world: World;
  let s: Scenario;
  let catalog: Actor;
  let viewer: Actor;
  let vendor: VendorFixture;
  let other: VendorFixture;
  const q = (sql: string, params: unknown[] = []) => world.ds.query(sql, params);
  const vendorApi = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: unknown, who: Actor = vendor.manager) =>
    world.api(method, `/vendor${path}`, { token: who.accessToken, ...(body !== undefined ? { body } : {}) });
  const adminApi = (method: 'get' | 'post' | 'patch', path: string, body?: unknown, who: Actor = catalog) =>
    world.api(method, `/admin${path}`, { token: who.accessToken, ...(body !== undefined ? { body } : {}) });
  const publicProduct = (id: string) => world.api('get', `/products/${id}`);
  const row = async (id: string) => (await q('SELECT name, price_minor, is_available, approval_status, image_url, category_id FROM products WHERE id = $1', [id]))[0];

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    const area = await s.serviceArea({ radiusMeters: 50000 });
    catalog = await s.admin([Permission.MANAGE_CATALOG, Permission.VIEW_ORDERS], 'Catalog Reviewer'); // the staff inbox needs order viewing
    viewer = await s.admin([Permission.VIEW_ORDERS], 'No Catalog');
    vendor = await s.vendor({ name: 'Governed Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    other = await s.vendor({ name: 'Other Governed Vendor', serviceAreaId: area.id, lat: 30.422, lng: 31.562 });
  });
  beforeEach(() => boundary.reset());
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('a NEW vendor product is saved PENDING and unavailable, invisible to customers; Hatly is told; approval puts it live as asked', async () => {
    const created = expectData<any>(
      await vendorApi('post', '/products', { vendorBranchId: vendor.branchId, categoryId: vendor.categoryId, name: 'Mango Juice', priceMinor: 3000, pricingUnit: 'PIECE' }),
      201,
    );
    expect(created).toMatchObject({ approvalStatus: 'PENDING', isAvailable: false });
    expect((await publicProduct(created.id)).status).toBe(404); // not even listed as unavailable
    expect(expectData<any[]>(await world.api('get', `/vendor-branches/${vendor.branchId}/products`)).map((x) => x.id)).not.toContain(created.id);
    const c = await s.customer();
    expect((await world.api('post', '/cart/items', { token: c.accessToken, body: { productId: created.id, quantity: 1 } })).status).toBeGreaterThanOrEqual(400);
    expect((await q(`SELECT 1 FROM staff_notifications WHERE category = 'OPS_PRODUCT_REVIEW' AND user_id = $1`, [catalog.id])).length).toBeGreaterThanOrEqual(1);

    // activating while it waits only records the wish; it stays off
    expectData(await vendorApi('patch', `/products/${created.id}/activate`));
    expect((await row(created.id)).is_available).toBe(false);
    // editing while it waits applies directly (Hatly reviews the product as it is)
    expectData(await vendorApi('patch', `/products/${created.id}`, { priceMinor: 3500, name: 'Fresh Mango Juice' }));
    expect(await row(created.id)).toMatchObject({ price_minor: 3500, name: 'Fresh Mango Juice', approval_status: 'PENDING' });

    const list = expectData<any[]>(await adminApi('get', '/product-change-requests'));
    const req = list.find((r) => r.productId === created.id);
    expect(req).toMatchObject({ kind: 'NEW_PRODUCT', status: 'PENDING', vendorName: 'Governed Vendor', current: { name: 'Fresh Mango Juice', priceMinor: 3500 } });
    expect((await adminApi('post', `/product-change-requests/${req.id}/approve`, {}, viewer)).status).toBe(403);
    expect(expectData<any>(await adminApi('post', `/product-change-requests/${req.id}/approve`, { note: 'looks good' }), 201)).toMatchObject({ status: 'APPROVED', decisionNote: 'looks good' });
    expect(await row(created.id)).toMatchObject({ approval_status: 'APPROVED', is_available: true });
    expect(expectData(await publicProduct(created.id)).isAvailable).toBe(true);
    expect((await q(`SELECT 1 FROM staff_notifications WHERE category = 'VENDOR_PRODUCT_REVIEW_DECIDED' AND user_id = $1`, [vendor.manager.id])).length).toBe(1);
    expect((await adminApi('post', `/product-change-requests/${req.id}/approve`, {})).status).toBe(409); // decided once
  });

  it('a rejected new product stays off and cannot be activated; editing it sends it back for review', async () => {
    const created = expectData<any>(
      await vendorApi('post', '/products', { vendorBranchId: vendor.branchId, categoryId: vendor.categoryId, name: 'Mystery Box', priceMinor: 9900, pricingUnit: 'PIECE', isAvailable: false }),
      201,
    );
    const [req] = await q(`SELECT id, payload FROM product_change_requests WHERE product_id = $1`, [created.id]);
    expect(req.payload).toEqual({ isAvailable: false });
    expect(expectData<any>(await adminApi('post', `/product-change-requests/${req.id}/reject`, { note: 'unclear product' }), 201)).toMatchObject({ status: 'REJECTED' });
    expect(await row(created.id)).toMatchObject({ approval_status: 'REJECTED', is_available: false });
    const act = await vendorApi('patch', `/products/${created.id}/activate`);
    expect(act.status).toBe(409);
    expect(act.body.error.details.code).toBe('PRODUCT_REJECTED');
    expectData(await vendorApi('patch', `/products/${created.id}`, { name: 'Gift Box (assorted sweets)' }));
    expect((await row(created.id)).approval_status).toBe('PENDING');
    expect((await q(`SELECT count(*)::int AS n FROM product_change_requests WHERE product_id = $1 AND kind = 'NEW_PRODUCT' AND status = 'PENDING'`, [created.id]))[0].n).toBe(1);
  });

  it('on a LIVE product: a price reduction applies now; an increase and detail changes wait (merged into one request); the approved version stays live', async () => {
    const p = await s.product(vendor, { name: 'Cola', priceMinor: 2000 });
    const down = expectData<any>(await vendorApi('patch', `/products/${p.id}`, { priceMinor: 1800 }));
    expect(down.pendingChange).toBeNull();
    expect(expectData(await publicProduct(p.id)).priceMinor).toBe(1800);

    const up = expectData<any>(await vendorApi('patch', `/products/${p.id}`, { priceMinor: 2500, description: 'Cold can' }));
    expect(up.pendingChange).toMatchObject({ kind: 'UPDATE', status: 'PENDING', payload: { priceMinor: 2500, description: 'Cold can' }, current: { priceMinor: 1800 } });
    const again = expectData<any>(await vendorApi('patch', `/products/${p.id}`, { name: 'Cola Zero', quantity: undefined }));
    expect(again.pendingChange.id).toBe(up.pendingChange.id); // merged
    expect(again.pendingChange.payload).toMatchObject({ priceMinor: 2500, description: 'Cold can', name: 'Cola Zero' });
    expect(await row(p.id)).toMatchObject({ price_minor: 1800, name: 'Cola' }); // approved version stays live
    const foreignCategory = await vendorApi('patch', `/products/${p.id}`, { categoryId: other.categoryId });
    expect(foreignCategory.status).toBe(400);

    expectData(await adminApi('post', `/product-change-requests/${up.pendingChange.id}/approve`, {}), 201);
    expect(await row(p.id)).toMatchObject({ price_minor: 2500, name: 'Cola Zero' });
    expect((await q(`SELECT 1 FROM admin_audit_logs WHERE action = 'product.change_decided' AND target_id = $1`, [p.id])).length).toBe(1);
  });

  it('a vendor can withdraw a pending change (not a new product); another vendor cannot see or withdraw it', async () => {
    const p = await s.product(vendor, { name: 'Water', priceMinor: 500 });
    const up = expectData<any>(await vendorApi('patch', `/products/${p.id}`, { priceMinor: 700 }));
    const mine = expectData<any[]>(await vendorApi('get', `/products/change-requests?vendorBranchId=${vendor.branchId}`));
    expect(mine.map((r) => r.id)).toContain(up.pendingChange.id);
    expect(expectData<any[]>(await vendorApi('get', '/products/change-requests', undefined, other.manager)).map((r) => r.id)).not.toContain(up.pendingChange.id);
    expect((await vendorApi('post', `/products/change-requests/${up.pendingChange.id}/withdraw`, undefined, other.manager)).status).toBe(404);
    expect(expectData<any>(await vendorApi('post', `/products/change-requests/${up.pendingChange.id}/withdraw`), 201)).toMatchObject({ status: 'WITHDRAWN' });
    expect((await adminApi('post', `/product-change-requests/${up.pendingChange.id}/approve`, {})).status).toBe(409);
    expect((await row(p.id)).price_minor).toBe(500);
    const [newReq] = await q(`SELECT r.id FROM product_change_requests r JOIN products p ON p.id = r.product_id WHERE r.kind = 'NEW_PRODUCT' AND p.vendor_branch_id = $1 LIMIT 1`, [vendor.branchId]);
    expect((await vendorApi('post', `/products/change-requests/${newReq.id}/withdraw`)).status).toBe(409);
  });

  it('options of a live product: adding or raising is a request (replayed on approval); lowering and removing apply directly', async () => {
    const p = await s.product(vendor, { name: 'Pizza', priceMinor: 8000 });
    const asked = expectData<any>(await vendorApi('post', `/products/${p.id}/options`, { name: 'Size', isRequired: false, allowsMultiple: false, values: [{ name: 'Large', priceDeltaMinor: 2000 }] }), 201);
    expect(asked.request).toMatchObject({ kind: 'OPTIONS', payload: { op: 'CREATE_OPTION' } });
    expect(expectData<any[]>(await vendorApi('get', `/products/${p.id}/options`))).toHaveLength(0);
    expectData(await adminApi('post', `/product-change-requests/${asked.request.id}/approve`, {}), 201);
    const [size] = expectData<any[]>(await vendorApi('get', `/products/${p.id}/options`));
    const large = size.values[0];
    expect(Number(large.priceDeltaMinor)).toBe(2000);

    const raise = expectData<any>(await vendorApi('patch', `/product-option-values/${large.id}`, { priceDeltaMinor: 2500 }));
    expect(raise.request).toMatchObject({ kind: 'OPTIONS', payload: { op: 'UPDATE_VALUE' } });
    const lower = expectData<any>(await vendorApi('patch', `/product-option-values/${large.id}`, { priceDeltaMinor: 1500 }));
    expect(lower.request).toBeUndefined();
    expect(Number((await q('SELECT price_delta_minor FROM product_option_values WHERE id = $1', [large.id]))[0].price_delta_minor)).toBe(1500);
    expect((await vendorApi('patch', `/product-option-values/${large.id}`, { priceDeltaMinor: 1 }, other.manager)).status).toBe(404);
    expectData(await vendorApi('delete', `/product-options/${size.id}`));
    expect(expectData<any[]>(await vendorApi('get', `/products/${p.id}/options`))).toHaveLength(0);
  });

  it('a rename of a live product waits for approval; Admin edits apply directly', async () => {
    const p = await s.product(vendor, { name: 'Bread', priceMinor: 1000 });
    const res = await vendorApi('patch', `/products/${p.id}`, { name: 'Baladi Bread' });
    expect(res.body.data.pendingChange.payload.name).toBe('Baladi Bread');
    expectData(await adminApi('patch', `/products/${p.id}`, { priceMinor: 1500, name: 'Fino Bread' }));
    expect(await row(p.id)).toMatchObject({ price_minor: 1500, name: 'Fino Bread' });
    expect((await q(`SELECT count(*)::int AS n FROM product_change_requests WHERE product_id = $1`, [p.id]))[0].n).toBe(1); // only the vendor's
  });
});
