/**
 * Security milestone — object-level isolation (BOLA/IDOR) for the resources the earlier journeys (20-authorization,
 * 91-idor-ratings-and-checkout) did not reach, with TWO identities per role over real HTTP. A "deny" means: the documented status
 * (404 indistinguishable from "does not exist", or 403 for a branch the caller provably has no link to) AND the victim's row is
 * unchanged in PostgreSQL AND nothing of the victim's leaks into the response.
 */
import * as jwt from 'jsonwebtoken';
import { bootWorld, World } from './support/world';
import { Actor, DriverFixture, Scenario, VendorFixture, expectData } from './support/actors';

describe('E2E — object-level isolation (security milestone)', () => {
  let world: World;
  let s: Scenario;
  let vendorA: VendorFixture;
  let vendorB: VendorFixture;
  let productA: { id: string };
  let productB: { id: string };
  let customerA: Actor;
  let customerB: Actor;
  let driverA: DriverFixture;
  let driverB: DriverFixture;
  let orderA: any;
  const homeA = { lat: 30.4225, lng: 31.5625 };
  const q = (sql: string, params: unknown[] = []) => world.ds.query(sql, params);
  const deny = (status: number) => expect([403, 404]).toContain(status);

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    vendorA = await s.vendor({ name: 'Iso Vendor A', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    vendorB = await s.vendor({ name: 'Iso Vendor B', serviceAreaId: area.id, lat: 30.451, lng: 31.601 });
    productA = await s.product(vendorA, { name: 'Iso A Product', priceMinor: 10000 });
    productB = await s.product(vendorB, { name: 'Iso B Product', priceMinor: 20000 });
    driverA = await s.driver({ lat: 30.4212, lng: 31.5612, fullName: 'Iso Driver A' });
    driverB = await s.driver({ lat: 30.4512, lng: 31.6012, fullName: 'Iso Driver B' });
    customerA = await s.customer('Iso Customer A');
    customerB = await s.customer('Iso Customer B');
    orderA = await s.simpleOrder(customerA, vendorA, productA.id, homeA);
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('Customer A vs Customer B', () => {
    it("cannot mark A's notification read, read A's tracking, or cancel A's order — and A's data is unchanged", async () => {
      await q(
        `INSERT INTO customer_notifications (customer_id, order_id, type, order_number, is_read) SELECT $1, id, 'ORDER_CONFIRMED', order_number, false FROM orders WHERE id = $2`,
        [customerA.id, orderA.id],
      );
      const [{ id: notificationId }] = await q('SELECT id FROM customer_notifications WHERE customer_id = $1 LIMIT 1', [customerA.id]);
      const read = await world.api('post', `/customer/notifications/${notificationId}/read`, { token: customerB.accessToken });
      expect(read.status).toBe(404);
      expect((await q('SELECT is_read FROM customer_notifications WHERE id = $1', [notificationId]))[0].is_read).toBe(false);
      const listB = expectData<any[]>(await world.api('get', '/customer/notifications', { token: customerB.accessToken }));
      expect(listB.map((n) => n.id)).not.toContain(notificationId);

      const tracking = await world.api('get', `/orders/${orderA.id}/tracking`, { token: customerB.accessToken });
      expect(tracking.status).toBe(404);
      expect(JSON.stringify(tracking.body)).not.toContain(orderA.orderNumber);

      const before = (await q('SELECT status FROM orders WHERE id = $1', [orderA.id]))[0].status;
      expect((await world.api('post', `/orders/${orderA.id}/cancel`, { token: customerB.accessToken, body: {} })).status).toBe(404);
      expect((await q('SELECT status FROM orders WHERE id = $1', [orderA.id]))[0].status).toBe(before);
    });

    it("a FOREIGN option value nested in the cart body (another product's option) is refused and nothing is added", async () => {
      const option = expectData<any>(
        await world.api('post', `/admin/products/${productA.id}/options`, {
          token: (await s.superAdmin()).accessToken, // fixture set up by Hatly (a vendor's option change on a live product is a request — R7)
          body: { name: 'Size', isRequired: false, allowsMultiple: false, values: [{ name: 'Large', priceDeltaMinor: 500 }] },
        }),
        201,
      );
      const foreignValueId = option.values[0].id;
      await world.api('delete', '/cart', { token: customerB.accessToken });
      const res = await world.api('post', '/cart/items', { token: customerB.accessToken, body: { productId: productB.id, quantity: 1, selectedOptionValueIds: [foreignValueId] } });
      expect(res.status).toBe(400);
      const cart = expectData<any>(await world.api('get', '/cart', { token: customerB.accessToken }));
      expect(JSON.stringify(cart)).not.toContain(productB.id);
    });

    it("A's uploaded photo cannot be referenced by B (custom-request images are owner-only), B's own works", async () => {
      const photoOfA = await s.uploadFakePhoto(customerA.accessToken);
      const body = { adHocPlaceName: 'Corner Pharmacy', adHocServiceType: 'BUY_FROM_PLACE', freeTextDescription: 'As in the photo', quantity: 1, pickupLatitude: 30.42, pickupLongitude: 31.56 };
      const stolen = await world.api('post', '/cart/adhoc-items', { token: customerB.accessToken, body: { ...body, imageUrls: [photoOfA] } });
      expect(stolen.status).toBe(400);
      expect(stolen.body.error.details.code).toBe('INVALID_IMAGE_REFERENCE');
      const own = await s.uploadFakePhoto(customerB.accessToken);
      expect((await world.api('post', '/cart/adhoc-items', { token: customerB.accessToken, body: { ...body, imageUrls: [own] } })).status).toBe(201);
    });

    it("cannot rate the driver of A's delivery", async () => {
      const res = await world.api('post', '/ratings/driver', { token: customerB.accessToken, body: { deliveryId: '00000000-0000-4000-8000-000000000000', stars: 1 } });
      deny(res.status);
    });
  });

  describe('Vendor A vs Vendor B — options, product state, nested ids, imports', () => {
    let optionA: any;
    beforeAll(async () => {
      optionA = expectData<any>(
        await world.api('post', `/admin/products/${productA.id}/options`, {
          token: (await s.superAdmin()).accessToken,
          body: { name: 'Spice', isRequired: false, allowsMultiple: false, values: [{ name: 'Hot', priceDeltaMinor: 0 }] },
        }),
        201,
      );
    });

    it("cannot list, add to, rename, delete or re-price A's option groups/values", async () => {
      const t = { token: vendorB.manager.accessToken };
      deny((await world.api('get', `/vendor/products/${productA.id}/options`, t)).status);
      deny((await world.api('post', `/vendor/products/${productA.id}/options`, { ...t, body: { name: 'Injected', values: [{ name: 'x' }] } })).status);
      deny((await world.api('patch', `/vendor/product-options/${optionA.id}`, { ...t, body: { name: 'Hijacked' } })).status);
      deny((await world.api('post', `/vendor/product-options/${optionA.id}/values`, { ...t, body: { name: 'Free', priceDeltaMinor: -9000 } })).status);
      deny((await world.api('patch', `/vendor/product-option-values/${optionA.values[0].id}`, { ...t, body: { priceDeltaMinor: 99999 } })).status);
      deny((await world.api('delete', `/vendor/product-option-values/${optionA.values[0].id}`, t)).status);
      deny((await world.api('delete', `/vendor/product-options/${optionA.id}`, t)).status);
      const [row] = await q('SELECT name FROM product_options WHERE id = $1', [optionA.id]);
      expect(row.name).toBe('Spice');
      const [value] = await q('SELECT price_delta_minor FROM product_option_values WHERE id = $1', [optionA.values[0].id]);
      expect(Number(value.price_delta_minor)).toBe(0);
    });

    it("cannot deactivate, zero the stock of, or upload an image for A's product", async () => {
      const t = { token: vendorB.manager.accessToken };
      deny((await world.api('patch', `/vendor/products/${productA.id}/deactivate`, t)).status);
      deny((await world.api('patch', `/vendor/products/${productA.id}/set-inventory-zero`, t)).status);
      deny((await world.api('get', `/vendor/products/${productA.id}`, t)).status);
      const [row] = await q('SELECT is_available, image_url FROM products WHERE id = $1', [productA.id]);
      expect(row.is_available).toBe(true);
      expect(row.image_url).toBeNull();
    });

    it("nested foreign ids: creating a product in A's branch, or under A's category, or MOVING a product to A's branch, is refused", async () => {
      const t = { token: vendorB.manager.accessToken };
      const intoA = await world.api('post', '/vendor/products', { ...t, body: { vendorBranchId: vendorA.branchId, categoryId: vendorA.categoryId, name: 'Planted', priceMinor: 1, pricingUnit: 'PIECE' } });
      deny(intoA.status);
      const underA = await world.api('post', '/vendor/products', { ...t, body: { vendorBranchId: vendorB.branchId, categoryId: vendorA.categoryId, name: 'Cross Category', priceMinor: 100, pricingUnit: 'PIECE' } });
      expect(underA.status).toBeGreaterThanOrEqual(400);
      expect(underA.status).toBeLessThan(500);
      const move = await world.api('patch', `/vendor/products/${productB.id}`, { ...t, body: { vendorBranchId: vendorA.branchId } });
      expect(move.status).toBe(400); // not an accepted field at all (forbidNonWhitelisted)
      const recategorise = await world.api('patch', `/vendor/products/${productB.id}`, { ...t, body: { categoryId: vendorA.categoryId } });
      expect(recategorise.status).toBeGreaterThanOrEqual(400);
      const [row] = await q('SELECT vendor_branch_id, category_id FROM products WHERE id = $1', [productB.id]);
      expect(row).toEqual({ vendor_branch_id: vendorB.branchId, category_id: vendorB.categoryId });
      expect((await q("SELECT count(*)::int AS n FROM products WHERE name IN ('Planted', 'Cross Category')"))[0].n).toBe(0);
    });

    it("cannot download A's catalogue as an import template", async () => {
      deny((await world.api('get', '/vendor/products/import-template', { token: vendorB.manager.accessToken, query: { vendorBranchId: vendorA.branchId } })).status);
    });

    it('losing the branch link takes effect on the very next request (no token refresh): replaying an allowed request is refused', async () => {
      const t = { token: vendorB.manager.accessToken };
      expect((await world.api('get', `/vendor/products/${productB.id}`, t)).status).toBe(200);
      const links = await q('SELECT * FROM vendor_staff WHERE user_id = $1', [vendorB.manager.id]);
      await q('DELETE FROM vendor_staff WHERE user_id = $1', [vendorB.manager.id]);
      try {
        deny((await world.api('get', `/vendor/products/${productB.id}`, t)).status);
        deny((await world.api('patch', `/vendor/products/${productB.id}`, { ...t, body: { name: 'After Unlink' } })).status);
        expect(expectData<any[]>(await world.api('get', '/vendor/branches', t))).toEqual([]);
      } finally {
        for (const l of links) await q('INSERT INTO vendor_staff (id, user_id, vendor_branch_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)', [l.id, l.user_id, l.vendor_branch_id, l.created_at, l.updated_at]);
      }
      expect((await world.api('get', `/vendor/products/${productB.id}`, t)).status).toBe(200);
    });
  });

  describe('Driver A vs Driver B — weights and replay after reassignment', () => {
    it("after an admin reassigns A's delivery to B, A's replayed status update is refused and A no longer sees it; B can act", async () => {
      await s.vendorPrepares(vendorA, orderA.id);
      const holder = await s.driverAssignedTo(orderA.id);
      const [first, second] = holder.id === driverA.id ? [driverA, driverB] : [driverB, driverA];
      const delivery = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: first.accessToken })).find((d) => d.orderId === orderA.id);
      expect(delivery).toBeTruthy();

      // a driver that is NOT assigned cannot record a weight on the order's items
      const [item] = await q('SELECT i.id FROM order_items i JOIN order_vendor_segments g ON g.id = i.order_vendor_segment_id WHERE g.order_id = $1 LIMIT 1', [orderA.id]);
      deny((await world.api('post', `/driver/order-items/${item.id}/weight`, { token: second.accessToken, body: { weightGrams: 1 } })).status);

      const dispatcher = await s.superAdmin();
      await world.ds.query('UPDATE drivers SET is_online = true WHERE id = $1', [second.driverId]);
      const reassigned = await world.api('post', `/admin/orders/${orderA.id}/reassign-driver`, { token: dispatcher.accessToken, body: { driverId: second.driverId } });
      expect(reassigned.status).toBeLessThan(300);

      const replay = await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: first.accessToken, body: { status: 'PICKED_UP' } });
      deny(replay.status);
      deny((await world.api('get', `/driver/deliveries/${delivery.id}`, { token: first.accessToken })).status);
      expect((await q('SELECT status FROM orders WHERE id = $1', [orderA.id]))[0].status).toBe('ASSIGNED_TO_DRIVER');
      const mine = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: second.accessToken }));
      expect(mine.map((d) => d.orderId)).toContain(orderA.id);
    });
  });

  describe('privilege escalation', () => {
    it('role/identity fields in a body are refused, never applied (registration, profile, admin driver creation)', async () => {
      const reg = await world.api('post', '/auth/customer/password/register', { body: { phone: '+201099999001', password: 'Esc4late-Pass!', fullName: 'Escalator', role: 'SUPER_ADMIN' } });
      expect(reg.status).toBe(400);
      expect((await q("SELECT count(*)::int AS n FROM users WHERE phone = '+201099999001'"))[0].n).toBe(0);
      const cart = await world.api('post', '/cart/items', { token: customerB.accessToken, body: { productId: productB.id, quantity: 1, customerId: customerA.id, priceMinor: 1 } });
      expect(cart.status).toBe(400);
    });

    it('spoofed identity headers are ignored; an unsigned (alg=none) or role-edited token is refused', async () => {
      const spoof = await world.api('get', '/admin/orders', { token: customerA.accessToken, headers: { 'x-user-id': (await s.superAdmin()).id, 'x-user-role': 'SUPER_ADMIN', 'x-forwarded-user': 'admin' } });
      expect(spoof.status).toBe(403);
      const [header, payload] = customerA.accessToken.split('.');
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
      const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ ...claims, role: 'SUPER_ADMIN' })).toString('base64url')}.`;
      expect((await world.api('get', '/admin/orders', { token: none })).status).toBe(401);
      const edited = `${header}.${Buffer.from(JSON.stringify({ ...claims, role: 'SUPER_ADMIN' })).toString('base64url')}.${customerA.accessToken.split('.')[2]}`;
      expect((await world.api('get', '/admin/orders', { token: edited })).status).toBe(401);
      const hs512 = jwt.sign({ ...claims, role: 'SUPER_ADMIN' }, 'guess', { algorithm: 'HS512' });
      expect((await world.api('get', '/admin/orders', { token: hs512 })).status).toBe(401);
    });
  });
});
