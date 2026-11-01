/**
 * Managing product option groups ("modifiers") without touching the database: admins (MANAGE_CATALOG) and the vendors who own the product's
 * branch can create/edit/delete groups and values over the API. The server keeps every rule (coherent min/max, no negative prices, unique
 * names, ownership), and the CART and CHECKOUT re-validate against the CURRENT groups — so a group edited after an item was added can never
 * produce an order that breaks it.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — product option management', () => {
  let world: World;
  let s: Scenario;
  let vendor: VendorFixture;
  let otherVendor: VendorFixture;
  let catalogAdmin: Actor;
  let noPermissionAdmin: Actor;
  const home = { lat: 30.425, lng: 31.565 };

  const adminApi = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: unknown, who: Actor = catalogAdmin) =>
    world.api(method, `/admin${path}`, { token: who.accessToken, body });
  const vendorApi = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: unknown, who: Actor = vendor.manager) =>
    world.api(method, `/vendor${path}`, { token: who.accessToken, body });
  const code = (res: any) => res.body?.error?.details?.code as string | undefined;
  const addToCart = (c: Actor, productId: string, body: Record<string, unknown> = {}) => world.api('post', '/cart/items', { token: c.accessToken, body: { productId, quantity: 1, ...body } });
  const group = (productId: string, over: Record<string, unknown> = {}) =>
    adminApi('post', `/products/${productId}/options`, { name: 'Toppings', allowsMultiple: true, values: [{ name: 'Olives', priceDeltaMinor: 500 }, { name: 'Cheese', priceDeltaMinor: 1000 }, { name: 'Mushrooms', priceDeltaMinor: 800 }], ...over });

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    vendor = await s.vendor({ name: 'Options Owner', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    otherVendor = await s.vendor({ name: 'Someone Else', serviceAreaId: area.id, lat: 30.422, lng: 31.562 });
    catalogAdmin = await s.admin([Permission.MANAGE_CATALOG], 'Catalog Admin');
    noPermissionAdmin = await s.admin([Permission.VIEW_ORDERS], 'No Catalog');
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('authorization', () => {
    it('admin needs MANAGE_CATALOG; a customer or anonymous caller gets nothing', async () => {
      const p = await s.product(vendor, { priceMinor: 10000 });
      const customer = await s.customer();
      expect((await adminApi('get', `/products/${p.id}/options`, undefined, noPermissionAdmin)).status).toBe(403);
      expect((await adminApi('post', `/products/${p.id}/options`, { name: 'x', values: [] }, noPermissionAdmin)).status).toBe(403);
      expect((await adminApi('get', `/products/${p.id}/options`, undefined, customer)).status).toBe(403);
      expect((await world.api('get', `/admin/products/${p.id}/options`)).status).toBe(401);
      expect((await world.api('post', `/vendor/products/${p.id}/options`, { token: customer.accessToken, body: { name: 'x', values: [] } })).status).toBe(403);
      expect((await world.api('get', `/vendor/products/${p.id}/options`)).status).toBe(401);
    });

    it('a vendor manages ONLY their own products: someone else\'s product, group and value are plain 404s and nothing changes', async () => {
      const mine = await s.product(vendor, { priceMinor: 10000 });
      const theirs = await s.product(otherVendor, { priceMinor: 10000 });
      const theirGroup = expectData<any>(await adminApi('post', `/products/${theirs.id}/options`, { name: 'Size', values: [{ name: 'S' }, { name: 'L', priceDeltaMinor: 500 }] }), 201);

      const ownCreate = await vendorApi('post', `/products/${mine.id}/options`, { name: 'Size', isRequired: true, values: [{ name: 'S' }, { name: 'L', priceDeltaMinor: 500 }] });
      expectData(ownCreate, 201);

      expect((await vendorApi('get', `/products/${theirs.id}/options`)).status).toBe(404);
      expect((await vendorApi('post', `/products/${theirs.id}/options`, { name: 'Hack', values: [{ name: 'a' }] })).status).toBe(404);
      expect((await vendorApi('patch', `/product-options/${theirGroup.id}`, { name: 'Renamed' })).status).toBe(404);
      expect((await vendorApi('delete', `/product-options/${theirGroup.id}`)).status).toBe(404);
      expect((await vendorApi('post', `/product-options/${theirGroup.id}/values`, { name: 'XL' })).status).toBe(404);
      expect((await vendorApi('patch', `/product-option-values/${theirGroup.values[0].id}`, { priceDeltaMinor: 1 })).status).toBe(404);
      expect((await vendorApi('delete', `/product-option-values/${theirGroup.values[0].id}`)).status).toBe(404);
      const unchanged = expectData<any[]>(await adminApi('get', `/products/${theirs.id}/options`));
      expect(unchanged).toHaveLength(1);
      expect(unchanged[0]).toMatchObject({ name: 'Size' });
      expect(unchanged[0].values).toHaveLength(2);
    });
  });

  describe('rules the server enforces', () => {
    it('create → read back with values; unique names; bounded counts', async () => {
      const p = await s.product(vendor, { priceMinor: 10000 });
      const created = expectData<any>(await group(p.id), 201);
      expect(created).toMatchObject({ name: 'Toppings', allowsMultiple: true, isRequired: false, minSelections: 0, maxSelections: null });
      expect(created.values.map((v: any) => [v.name, Number(v.priceDeltaMinor)])).toEqual([['Olives', 500], ['Cheese', 1000], ['Mushrooms', 800]]);
      expect(code(await group(p.id))).toBe('OPTION_NAME_TAKEN');
      expect(code(await group(p.id, { name: 'TOPPINGS' }))).toBe('OPTION_NAME_TAKEN'); // case-insensitive
      expect(code(await adminApi('post', `/product-options/${created.id}/values`, { name: 'olives' }))).toBe('OPTION_VALUE_NAME_TAKEN');
      expect((await adminApi('post', `/products/${p.id}/options`, { name: 'Dup values', values: [{ name: 'A' }, { name: 'a' }] })).status).toBe(409);
    });

    it('prices are whole minor units within bounds and can never take the product below zero', async () => {
      const p = await s.product(vendor, { priceMinor: 1000 });
      expect((await group(p.id, { name: 'Float', values: [{ name: 'x', priceDeltaMinor: 1.5 }] })).status).toBe(400);
      expect((await group(p.id, { name: 'Huge', values: [{ name: 'x', priceDeltaMinor: 99_999_999 }] })).status).toBe(400);
      expect(code(await group(p.id, { name: 'TooNegative', values: [{ name: 'x', priceDeltaMinor: -1500 }] }))).toBe('INVALID_OPTION_PRICE');
      expectData(await group(p.id, { name: 'Discount', values: [{ name: 'x', priceDeltaMinor: -500 }] }), 201);
      const created = expectData<any>(await group(p.id, { name: 'Edit me', values: [{ name: 'y', priceDeltaMinor: 100 }] }), 201);
      expect(code(await adminApi('patch', `/product-option-values/${created.values[0].id}`, { priceDeltaMinor: -1001 }))).toBe('INVALID_OPTION_PRICE');
    });

    it('limits must be coherent: single-choice has no maximum, max ≥ max(min, 1), min cannot exceed the number of values', async () => {
      const p = await s.product(vendor, { priceMinor: 10000 });
      expect(code(await group(p.id, { name: 'A', allowsMultiple: false, minSelections: 2 }))).toBe('INVALID_OPTION_LIMITS');
      expect(code(await group(p.id, { name: 'B', allowsMultiple: false, maxSelections: 3 }))).toBe('INVALID_OPTION_LIMITS');
      expect(code(await group(p.id, { name: 'C', minSelections: 3, maxSelections: 2 }))).toBe('INVALID_OPTION_LIMITS');
      expect(code(await group(p.id, { name: 'D', minSelections: 4 }))).toBe('INVALID_OPTION_LIMITS'); // only 3 values
      const ok = expectData<any>(await group(p.id, { name: 'E', minSelections: 1, maxSelections: 2 }), 201);
      expect(ok).toMatchObject({ isRequired: true, minSelections: 1, maxSelections: 2 }); // min ≥ 1 means required
      // a patch that would break coherence is refused too
      expect(code(await adminApi('patch', `/product-options/${ok.id}`, { allowsMultiple: false }))).toBe('INVALID_OPTION_LIMITS');
      expect(code(await adminApi('patch', `/product-options/${ok.id}`, { minSelections: 3 }))).toBe('INVALID_OPTION_LIMITS'); // 3 > max 2
    });

    it('a group that requires a choice cannot lose its last values; the whole group can be deleted instead', async () => {
      const p = await s.product(vendor, { priceMinor: 10000 });
      const required = expectData<any>(await group(p.id, { name: 'Size', isRequired: true, allowsMultiple: false, values: [{ name: 'S' }, { name: 'L' }] }), 201);
      expectData(await adminApi('delete', `/product-option-values/${required.values[0].id}`));
      const blocked = await adminApi('delete', `/product-option-values/${required.values[1].id}`);
      expect(blocked.status).toBe(409);
      expect(code(blocked)).toBe('OPTION_GROUP_WOULD_BE_EMPTY');
      expectData(await adminApi('delete', `/product-options/${required.id}`));
      expect(expectData<any[]>(await adminApi('get', `/products/${p.id}/options`))).toEqual([]);
      expect(code(await group(p.id, { name: 'Empty required', isRequired: true, values: [] }))).toBe('INVALID_OPTION_LIMITS');
    });

    it('a malformed id is a client error, an unknown one a 404', async () => {
      expect((await adminApi('delete', '/product-options/not-a-uuid')).status).toBe(400);
      expect((await adminApi('delete', '/product-options/00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect((await adminApi('get', '/products/00000000-0000-4000-8000-000000000000/options')).status).toBe(404);
    });
  });

  describe('the customer cart follows the managed groups (server-side min / max)', () => {
    it('a group created through the API prices, validates and snapshots exactly like a seeded one', async () => {
      const p = await s.product(vendor, { name: 'Managed Pizza', priceMinor: 12000 });
      const size = expectData<any>(await group(p.id, { name: 'Size', isRequired: true, allowsMultiple: false, values: [{ name: 'Small' }, { name: 'Large', priceDeltaMinor: 6000 }] }), 201);
      const toppings = expectData<any>(await group(p.id, { name: 'Toppings', minSelections: 1, maxSelections: 2 }), 201);
      const [small, large] = size.values;
      const [olives, cheese, mushrooms] = toppings.values;

      // the public product exposes the limits so the app can enforce them too
      const detail = expectData<any>(await world.api('get', `/products/${p.id}`));
      const publicToppings = detail.options.find((o: any) => o.name === 'Toppings');
      expect(publicToppings).toMatchObject({ minSelections: 1, maxSelections: 2, allowsMultiple: true });

      const c = await s.customer();
      expect(code(await addToCart(c, p.id, { selectedOptionValueIds: [large.id] }))).toBe('OPTION_REQUIRED'); // Toppings: none chosen, min 1
      expect(code(await addToCart(c, p.id, { selectedOptionValueIds: [large.id, olives.id, cheese.id, mushrooms.id] }))).toBe('OPTION_MAX_SELECTIONS');
      const cart = expectData<any>(await addToCart(c, p.id, { selectedOptionValueIds: [large.id, olives.id, cheese.id] }), 201);
      expect(cart.groups[0].items[0].unitPriceMinor).toBe(12000 + 6000 + 500 + 1000);
      const order = await s.checkout(c, home);
      expect(order.subtotalMinor).toBe(19500);
      void small;
    });
  });

  describe('checkout re-validates against the CURRENT groups', () => {
    it('a group edited AFTER the item was added can no longer yield an order that breaks it (quote blocker AND order refusal; fixing the cart fixes it)', async () => {
      const p = await s.product(vendor, { name: 'Late Edit', priceMinor: 5000 });
      const c = await s.customer();
      expectData(await addToCart(c, p.id), 201); // no options yet
      const quoteBefore = expectData<any>(await world.api('post', '/checkout/quote', { token: c.accessToken, body: { deliveryAddress: { line1: 'x', latitude: home.lat, longitude: home.lng }, paymentMethod: 'COD' } }), 201);
      expect(quoteBefore.canPlaceOrder).toBe(true);

      // the vendor now makes a choice mandatory
      const required = expectData<any>(await vendorApi('post', `/products/${p.id}/options`, { name: 'Sauce', isRequired: true, allowsMultiple: false, values: [{ name: 'Mild' }, { name: 'Hot', priceDeltaMinor: 200 }] }), 201);

      const quote = expectData<any>(await world.api('post', '/checkout/quote', { token: c.accessToken, body: { deliveryAddress: { line1: 'x', latitude: home.lat, longitude: home.lng }, paymentMethod: 'COD' } }), 201);
      expect(quote.canPlaceOrder).toBe(false);
      expect(quote.blockers.map((b: any) => b.code)).toContain('OPTION_REQUIRED');
      const refused = await world.api('post', '/orders', { token: c.accessToken, body: { paymentMethod: 'COD', deliveryAddress: { line1: 'x', latitude: home.lat, longitude: home.lng } } });
      expect(refused.status).toBe(400);
      expect(code(refused)).toBe('OPTION_REQUIRED');
      const [{ n }] = await world.ds.query('SELECT count(*)::int AS n FROM orders WHERE customer_id = $1', [c.id]);
      expect(n).toBe(0);

      // re-choosing fixes it (the item is replaced with a valid selection)
      await world.api('delete', '/cart', { token: c.accessToken });
      expectData(await addToCart(c, p.id, { selectedOptionValueIds: [required.values[1].id] }), 201);
      const order = await s.checkout(c, home);
      expect(order.subtotalMinor).toBe(5200);
    });

    it('deleting a value removes it from carts that held it; the price drops with it and a required group asks again', async () => {
      const p = await s.product(vendor, { name: 'Removed Choice', priceMinor: 3000 });
      const size = expectData<any>(await group(p.id, { name: 'Size', isRequired: true, allowsMultiple: false, values: [{ name: 'S' }, { name: 'L', priceDeltaMinor: 700 }] }), 201);
      const extras = expectData<any>(await group(p.id, { name: 'Extras', values: [{ name: 'Dip', priceDeltaMinor: 400 }] }), 201);
      const c = await s.customer();
      const cart = expectData<any>(await addToCart(c, p.id, { selectedOptionValueIds: [size.values[1].id, extras.values[0].id] }), 201);
      expect(cart.groups[0].items[0].unitPriceMinor).toBe(4100);

      expectData(await adminApi('delete', `/product-option-values/${extras.values[0].id}`)); // optional extra removed
      const afterExtra = expectData<any>(await world.api('get', '/cart', { token: c.accessToken }));
      expect(afterExtra.groups[0].items[0].unitPriceMinor).toBe(3700);

      expectData(await adminApi('delete', `/product-options/${size.id}`)); // the whole required group removed: nothing left to require
      const afterGroup = expectData<any>(await world.api('get', '/cart', { token: c.accessToken }));
      expect(afterGroup.groups[0].items[0].unitPriceMinor).toBe(3000);
      expect((await s.checkout(c, home)).subtotalMinor).toBe(3000);
    });

    it('past orders keep their frozen modifier snapshot when the groups change afterwards', async () => {
      const p = await s.product(vendor, { name: 'Frozen', priceMinor: 4000 });
      const g = expectData<any>(await group(p.id, { name: 'Size', isRequired: true, allowsMultiple: false, values: [{ name: 'L', priceDeltaMinor: 900 }] }), 201);
      const c = await s.customer();
      expectData(await addToCart(c, p.id, { selectedOptionValueIds: [g.values[0].id] }), 201);
      const order = await s.checkout(c, home);
      expectData(await adminApi('patch', `/product-option-values/${g.values[0].id}`, { priceDeltaMinor: 5000, name: 'XL' }));
      expectData(await adminApi('delete', `/product-options/${g.id}`));
      const [row] = await world.ds.query('SELECT options_snapshot FROM order_items oi JOIN order_vendor_segments s ON s.id = oi.order_vendor_segment_id WHERE s.order_id = $1', [order.id]);
      expect(row.options_snapshot.map((o: any) => [o.valueName, o.priceDeltaMinor])).toEqual([['L', 900]]);
      const details = expectData<any>(await world.api('get', `/orders/${order.id}`, { token: c.accessToken }));
      expect(details.subtotalMinor).toBe(4900);
    });
  });
});
