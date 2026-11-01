/**
 * Store-policy requirement (Apple 5.1.1(v), Google Play account deletion): a customer can delete their own account in the app.
 * Real HTTP, real PostgreSQL. Proves what is ERASED (identity, addresses, tokens, notifications, open cart, finished orders' address
 * snapshot + note), what is KEPT (the order, its amounts, status and number), what BLOCKS deletion (an order in flight, a non-zero wallet),
 * that the sign-in dies at once, that the phone number is freed, and that nobody else's data is touched.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, DEFAULT_PASSWORD } from './support/actors';
import { boundary } from './support/external-boundary';

describe('E2E — customer account deletion', () => {
  let world: World;
  let s: Scenario;
  let product: { id: string };
  const home = { lat: 30.425, lng: 31.565 };
  const q = (sql: string, params: unknown[] = []) => world.ds.query(sql, params);
  const del = (token: string | undefined, body: Record<string, unknown> = { password: DEFAULT_PASSWORD }) => world.api('post', '/auth/customer/delete-account', { token, body });
  const userRow = async (id: string) => (await q('SELECT full_name, phone, email, password_hash, is_active, is_phone_verified FROM users WHERE id = $1', [id]))[0];
  const count = async (table: string, col: string, id: string) => Number((await q(`SELECT count(*)::int AS n FROM ${table} WHERE ${col} = $1`, [id]))[0].n);
  let seed = 0;
  const credit = (c: Actor, amountMinor: number) =>
    q("INSERT INTO wallet_transactions (customer_id, amount_delta_minor, type, idempotency_key, reason) VALUES ($1, $2, 'ADMIN_CREDIT', $3, 'e2e seed')", [c.id, amountMinor, `e2e-del-${c.id}-${seed++}`]);

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    const vendor = await s.vendor({ name: 'Deletion Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    product = await s.product(vendor, { priceMinor: 12000, inventoryMode: 'OPEN' });
  });
  beforeEach(() => boundary.reset());
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('a wrong password is refused (403 PASSWORD_INVALID) and changes nothing — the customer can still sign in', async () => {
    const c = await s.customer('Wrong Password Customer');
    const res = await del(c.accessToken, { password: 'Not-The-Password-1' });
    expect(res.status).toBe(403);
    expect(res.body?.error?.details?.code ?? res.body?.details?.code).toBe('PASSWORD_INVALID');
    expect((await userRow(c.id)).is_active).toBe(true);
    expect((await world.api('post', '/auth/customer/password/login', { body: { phone: c.phone, password: DEFAULT_PASSWORD } })).status).toBe(200);
  });

  it('an order in progress blocks deletion (409 ACCOUNT_HAS_ACTIVE_ORDERS) and nothing is erased', async () => {
    const c = await s.customer('Active Order Customer');
    await s.address(c, home);
    await s.addToCart(c, product.id, 1);
    const order = await s.checkout(c, home, 'COD');
    const res = await del(c.accessToken);
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('ACCOUNT_HAS_ACTIVE_ORDERS');
    const row = await userRow(c.id);
    expect(row.is_active).toBe(true);
    expect(row.full_name).toBe('Active Order Customer');
    expect(await count('addresses', 'customer_id', c.id)).toBeGreaterThan(0);
    expect(order.id).toBeDefined();
  });

  it('a non-zero wallet blocks deletion (409 ACCOUNT_HAS_WALLET_BALANCE): money is never silently forfeited', async () => {
    const c = await s.customer('Wallet Customer');
    await credit(c, 5000);
    const res = await del(c.accessToken);
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('ACCOUNT_HAS_WALLET_BALANCE');
    expect((await userRow(c.id)).is_active).toBe(true);
    expect(await count('wallet_transactions', 'customer_id', c.id)).toBe(1);
  });

  it('deletes: identity, addresses, tokens, notifications and the open cart are erased; the finished order is KEPT with its amounts but no address/note; sign-in dies; the phone is freed', async () => {
    const bystander = await s.customer('Bystander Customer');
    await s.address(bystander, home);
    await s.addToCart(bystander, product.id, 1);
    await s.checkout(bystander, home, 'COD'); // gives the bystander an address and an order that must survive untouched
    const bystanderAddresses = await count('addresses', 'customer_id', bystander.id);

    const c = await s.customer('Leaving Customer');
    await s.address(c, home);
    await s.addToCart(c, product.id, 1);
    const order = await s.checkout(c, home, 'COD');
    expect((await world.api('post', `/orders/${order.id}/cancel`, { token: c.accessToken, body: {} })).status).toBe(201);
    await q("UPDATE orders SET order_note = 'ring twice' WHERE id = $1", [order.id]);
    expect((await world.api('post', '/customer/device-token', { token: c.accessToken, body: { token: `fcm-${c.id}`, platform: 'android' } })).status).toBe(201);
    expect(await count('addresses', 'customer_id', c.id)).toBeGreaterThan(0);
    expect(await count('device_tokens', 'user_id', c.id)).toBe(1);
    await s.addToCart(c, product.id, 1); // an open cart at the moment of deletion
    const before = (await q('SELECT total_minor, order_number, status, delivery_address_snapshot FROM orders WHERE id = $1', [order.id]))[0];
    expect(before.delivery_address_snapshot?.line1).toBeTruthy();
    const oldPhone = c.phone;

    const res = await del(c.accessToken);
    expect(res.status).toBe(200);

    const row = await userRow(c.id);
    expect(row).toEqual({ full_name: 'Deleted customer', phone: expect.stringMatching(/^deleted-[0-9a-f]{11}$/), email: null, password_hash: null, is_active: false, is_phone_verified: false });
    expect(row.phone).not.toContain(oldPhone);
    for (const [table, col] of [['addresses', 'customer_id'], ['device_tokens', 'user_id'], ['customer_notifications', 'customer_id'], ['carts', 'customer_id'], ['favorites', 'customer_id']] as const) {
      expect([table, await count(table, col, c.id)]).toEqual([table, 0]);
    }
    const after = (await q('SELECT total_minor, order_number, status, delivery_address_snapshot, order_note FROM orders WHERE id = $1', [order.id]))[0];
    expect(after.total_minor).toBe(before.total_minor); // amounts untouched
    expect(after.order_number).toBe(before.order_number);
    expect(after.status).toBe(before.status);
    expect(after.delivery_address_snapshot).toEqual({ line1: '' });
    expect(after.order_note).toBeNull();

    // the sign-in is dead
    expect((await world.api('post', '/auth/customer/password/login', { body: { phone: oldPhone, password: DEFAULT_PASSWORD } })).status).toBe(401);
    expect((await world.api('post', '/auth/refresh', { body: { refreshToken: c.refreshToken } })).status).toBe(401);
    expect((await del(c.accessToken)).status).toBe(401); // a second attempt on the now-inactive account

    // the number is free again for a brand-new account
    // (the registration code request has a per-phone cooldown, so the no-code path — what OTP-off registration is — is used here)
    await s.setConfig('CUSTOMER_OTP_ENABLED', false);
    let again;
    try {
      again = await world.api('post', '/auth/customer/password/register', { body: { phone: oldPhone, fullName: 'Returning Person', password: DEFAULT_PASSWORD } });
    } finally {
      await s.setConfig('CUSTOMER_OTP_ENABLED', true);
    }
    expect([200, 201]).toContain(again.status);
    expect((await q('SELECT full_name FROM users WHERE phone = $1', [oldPhone]))[0].full_name).toBe('Returning Person');

    // a record of the deletion exists, by id only
    const audit = await q("SELECT action, actor_user_id, target_id, metadata FROM admin_audit_logs WHERE action = 'customer.account_deleted' AND actor_user_id = $1", [c.id]);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain(oldPhone);
    expect(JSON.stringify(audit[0])).not.toContain('Leaving Customer');

    // nobody else was touched
    expect(await count('addresses', 'customer_id', bystander.id)).toBe(bystanderAddresses);
    expect((await userRow(bystander.id)).full_name).toBe('Bystander Customer');
    expect(Number((await q('SELECT count(*)::int AS n FROM orders WHERE customer_id = $1', [bystander.id]))[0].n)).toBe(1);
  });

  it('only the signed-in CUSTOMER may call it, for their own account: anonymous 401, vendor/admin 403, missing password 400', async () => {
    const area = await s.serviceArea({ radiusMeters: 50000 });
    const vendor = await s.vendor({ name: 'Authz Vendor', serviceAreaId: area.id, lat: 30.422, lng: 31.562 });
    expect((await del(undefined)).status).toBe(401);
    expect((await del(vendor.manager.accessToken)).status).toBe(403);
    expect((await del((await s.superAdmin()).accessToken)).status).toBe(403);
    const c = await s.customer('Validation Customer');
    expect((await del(c.accessToken, {})).status).toBe(400);
    expect((await del(c.accessToken, { password: DEFAULT_PASSWORD, userId: 'someone-else' })).status).toBe(400); // no way to name another account
    expect((await userRow(c.id)).is_active).toBe(true);
  });
});
