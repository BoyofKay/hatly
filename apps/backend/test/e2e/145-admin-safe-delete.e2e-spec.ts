/**
 * Safe delete across the admin panel (2026-11-21). Every delete is a soft delete: the record disappears from the admin lists and from the
 * customer side, history stays, and a delete that would break something live is refused with a reason. Also covers the new edits
 * (offer, driver details, store staff details).
 */
import { bootWorld, World } from './support/world';
import { Actor, Scenario, expectData } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — admin safe delete and edit', () => {
  let world: World;
  let s: Scenario;
  let sa: Actor;
  let area: { id: string; lat: number; lng: number };
  const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: unknown, token = sa.accessToken) => world.api(method, path, { token, body });
  const listed = async (path: string, id: string) => JSON.stringify((await api('get', path)).body).includes(id);

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    sa = await s.superAdmin();
    area = await s.serviceArea({ name: 'Delete Area' });
    await s.configureDeliveryPricing();
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('a product: deleted, gone from the admin list and from customers’ carts, and its order history kept', async () => {
    const vendor = await s.vendor({ serviceAreaId: area.id, lat: area.lat, lng: area.lng });
    const kept = await s.product(vendor);
    const doomed = await s.product(vendor);
    const customer = await s.customer();
    await s.addToCart(customer, doomed.id, 1);
    await s.addToCart(customer, kept.id, 1);
    expect(await listed(`/admin/products?vendorBranchId=${vendor.branchId}`, doomed.id)).toBe(true);

    const res = await api('delete', `/admin/products/${doomed.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.alsoRemoved.cartLines).toBe(1);
    expect(await listed(`/admin/products?vendorBranchId=${vendor.branchId}`, doomed.id)).toBe(false);
    expect(await listed(`/admin/products?vendorBranchId=${vendor.branchId}`, kept.id)).toBe(true);
    const cart = JSON.stringify((await world.api('get', '/cart', { token: customer.accessToken })).body);
    expect(cart).not.toContain(doomed.id);
    expect(cart).toContain(kept.id);
    expect((await api('delete', `/admin/products/${doomed.id}`)).status).toBe(404); // already deleted
    const [row] = await world.ds.query(`SELECT deleted_at IS NOT NULL AS deleted, is_available FROM products WHERE id = $1`, [doomed.id]);
    expect(row).toEqual({ deleted: true, is_available: false }); // the row itself stays for history
  });

  it('a category that still holds products is refused; once empty it is deleted', async () => {
    const vendor = await s.vendor({ serviceAreaId: area.id, lat: area.lat, lng: area.lng });
    const p = await s.product(vendor);
    const refused = await api('delete', `/admin/product-categories/${vendor.categoryId}`);
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toContain('CATEGORY_HAS_PRODUCTS');
    expectData(await api('delete', `/admin/products/${p.id}`));
    expect((await api('delete', `/admin/product-categories/${vendor.categoryId}`)).status).toBe(200);
    expect(await listed(`/admin/product-categories?vendorBranchId=${vendor.branchId}`, vendor.categoryId)).toBe(false);
  });

  it('a store with an order in progress cannot be deleted; after the order is cancelled it is deleted with its branch, menu and staff', async () => {
    const vendor = await s.vendor({ serviceAreaId: area.id, lat: area.lat, lng: area.lng });
    const product = await s.product(vendor);
    const customer = await s.customer();
    const order = await s.simpleOrder(customer, vendor, product.id, { lat: area.lat, lng: area.lng });
    const refused = await api('delete', `/admin/vendors/${vendor.vendorId}`);
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toContain('HAS_LIVE_ORDERS');
    expect((await api('delete', `/admin/vendor-branches/${vendor.branchId}`)).status).toBe(409);

    await world.ds.query(`UPDATE orders SET status = 'CANCELLED' WHERE id = $1`, [order.id ?? order.orderId]);
    const res = await api('delete', `/admin/vendors/${vendor.vendorId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.alsoRemoved).toEqual(expect.objectContaining({ branches: 1, products: 1, categories: 1, staff: 1 }));
    expect(await listed('/admin/vendors', vendor.vendorId)).toBe(false);
    expect(await listed(`/admin/vendor-branches?vendorId=${vendor.vendorId}`, vendor.branchId)).toBe(false);
    // the store's manager can no longer sign in or use the old token
    expect((await world.api('get', '/vendor/overview', { token: vendor.manager.accessToken })).status).toBe(401);
    // the old order is still readable by admins (history kept)
    expect((await api('get', `/admin/orders/${order.id ?? order.orderId}`)).status).toBe(200);
  });

  it('a service area with stores or zones is refused; an empty one is deleted', async () => {
    const busy = await s.serviceArea({ name: 'Busy Area' });
    await s.deliveryZone({ serviceAreaId: busy.id });
    const r1 = await api('delete', `/admin/service-areas/${busy.id}`);
    expect(r1.status).toBe(409);
    expect(JSON.stringify(r1.body)).toContain('SERVICE_AREA_HAS_ZONES');
    const empty = await s.serviceArea({ name: 'Empty Area' });
    expect((await api('delete', `/admin/service-areas/${empty.id}`)).status).toBe(200);
    expect(await listed('/admin/service-areas', empty.id)).toBe(false);
  });

  it('delivery zones cannot be deleted (owner decision): there is no delete route, deactivate or edit instead', async () => {
    const own = await s.serviceArea({ name: 'Zone Keep Area' });
    const zone = await s.deliveryZone({ serviceAreaId: own.id, name: 'Zone Kept' });
    expect((await api('delete', `/admin/delivery-zones/${zone.id}`)).status).toBe(404);
    expect(await listed('/admin/delivery-zones', zone.id)).toBe(true);
  });

  it('a driver is edited, then deleted: signed out, gone from the list, phone free again', async () => {
    const driver = await s.driver({ lat: area.lat, lng: area.lng });
    const edited = expectData<any>(await api('patch', `/admin/drivers/${driver.driverId}/profile`, { fullName: 'Renamed Driver' }));
    expect(edited.fullName).toBe('Renamed Driver');
    expect((await api('delete', `/admin/drivers/${driver.driverId}`)).status).toBe(200);
    expect(await listed('/admin/drivers', driver.driverId)).toBe(false);
    expect((await world.api('post', '/auth/driver/login', { body: { phone: driver.phone, password: driver.password } })).status).toBe(401);
    expect((await api('post', '/admin/drivers', { phone: driver.phone, fullName: 'New Driver Same Phone', password: 'Driver-Pass-123' })).status).toBe(201);
  });

  it('a vehicle type in use is refused', async () => {
    await s.driver({ lat: area.lat, lng: area.lng });
    const [vt] = await world.ds.query(`SELECT vehicle_type_id AS id FROM drivers WHERE deleted_at IS NULL AND vehicle_type_id IS NOT NULL LIMIT 1`);
    const r = await api('delete', `/admin/vehicle-types/${vt.id}`);
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toContain('VEHICLE_TYPE_IN_USE');
  });

  it('store staff: edited (name and role), then deleted', async () => {
    const vendor = await s.vendor({ serviceAreaId: area.id, lat: area.lat, lng: area.lng });
    const [row] = await world.ds.query(`SELECT id FROM vendor_staff WHERE vendor_branch_id = $1`, [vendor.branchId]);
    const edited = expectData<any>(await api('patch', `/admin/vendor-staff/${row.id}`, { fullName: 'Edited Staff', role: 'VENDOR' }));
    expect(edited.fullName).toBe('Edited Staff');
    expect((await api('delete', `/admin/vendor-staff/${row.id}`)).status).toBe(200);
    expect(await listed('/admin/vendor-staff', row.id)).toBe(false);
  });

  it('an offer is renamed (rules stay locked), then deleted', async () => {
    const vendor = await s.vendor({ serviceAreaId: area.id, lat: area.lat, lng: area.lng });
    const start = new Date(Date.now() - 3600_000).toISOString();
    const end = new Date(Date.now() + 7 * 86400_000).toISOString();
    const offer = expectData<any>(
      await api('post', '/admin/offers', { vendorBranchId: vendor.branchId, name: 'Ten off', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'PERCENTAGE', discountValue: 1000, startAt: start, endAt: end }),
      201,
    );
    // edits go through the existing marketing endpoint (name / dates / limits; discount rules only via clone)
    expect((await api('patch', `/admin/offers/${offer.id}`, { name: 'Ten percent off' })).status).toBe(200);
    expect((await api('patch', `/admin/offers/${offer.id}`, { discountValue: 1500 })).status).toBe(400);
    expect((await api('delete', `/admin/offers/${offer.id}`)).status).toBe(200);
    expect(await listed('/admin/offers', offer.id)).toBe(false);
  });

  it('a sector with stores is refused; deleting needs the same permission that manages it', async () => {
    const sector = await s.sector('Delete Sector');
    const vendor = await s.vendor({ serviceAreaId: area.id, lat: area.lat, lng: area.lng });
    await s.assignSector(vendor, sector.id);
    expect((await api('delete', `/admin/sectors/${sector.id}`)).status).toBe(409);
    const noPerm = await s.admin([Permission.VIEW_ORDERS], 'No Delete Perm');
    expect((await api('delete', `/admin/products/00000000-0000-4000-8000-000000000000`, undefined, noPerm.accessToken)).status).toBe(403);
    // editing rights alone are not enough to delete: DELETE_RECORDS is needed too
    const editor = await s.admin([Permission.MANAGE_CATALOG], 'Catalog Editor');
    const vendor2 = await s.vendor({ serviceAreaId: area.id, lat: area.lat, lng: area.lng });
    const p2 = await s.product(vendor2);
    expect((await api('patch', `/admin/products/${p2.id}`, { name: 'Edited by editor' }, editor.accessToken)).status).toBe(200);
    expect((await api('delete', `/admin/products/${p2.id}`, undefined, editor.accessToken)).status).toBe(403);
    const deleter = await s.admin([Permission.MANAGE_CATALOG, Permission.DELETE_RECORDS], 'Catalog Admin');
    expect((await api('delete', `/admin/products/${p2.id}`, undefined, deleter.accessToken)).status).toBe(200);
  });

  it('branch go-live checklist: a bare branch lists its blockers; once fixed it is ready', async () => {
    const vendor = await s.vendor({ serviceAreaId: area.id, lat: area.lat, lng: area.lng });
    const read = async () => expectData<any>(await api('get', `/admin/vendor-branches/${vendor.branchId}/readiness`));
    let r = await read();
    const failing = (x: any) => x.checks.filter((c: any) => !c.ok && c.level === 'BLOCKER').map((c: any) => c.key).sort();
    expect(r.ready).toBe(false);
    expect(failing(r)).toEqual(['COMMISSION', 'DELIVERY_ZONES', 'MENU', 'SECTOR']);
    expectData(await api('patch', `/admin/vendor-branches/${vendor.branchId}`, { commissionRateBasisPoints: 1500 }));
    await s.product(vendor);
    const sector = await s.sector('Readiness Sector');
    await s.assignSector(vendor, sector.id);
    await s.deliveryZone({ serviceAreaId: area.id });
    r = await read();
    expect(failing(r)).toEqual([]);
    expect(r.ready).toBe(true);
  });
});
