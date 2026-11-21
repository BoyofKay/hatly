/**
 * deploy/production/reset-test-orders-and-drivers.sql against a database with real-shaped data (a delivered order with a driver, proof,
 * money events and a vendor settlement; a placed order; an online driver): the dry run changes nothing, the cutoff guard refuses newer
 * orders, and the applied run removes orders and drivers while keeping customers, stores and menus — with no foreign-key error anywhere.
 */
import { execFileSync } from 'child_process';
import * as path from 'path';
import { bootWorld, World } from './support/world';
import { Actor, Scenario, expectData } from './support/actors';
import { E2E_DATABASE_URL } from './support/config';

const SCRIPT = path.resolve(__dirname, '../../../../deploy/production/reset-test-orders-and-drivers.sql');

describe('E2E — production test-data reset script', () => {
  let world: World;
  let s: Scenario;
  let customers: Actor[];
  const count = async (sql: string) => Number((await world.ds.query(sql))[0].n);
  const runScript = (vars: Record<string, string>) => {
    const args = [E2E_DATABASE_URL, '-X', '-q', '-f', SCRIPT, ...Object.entries(vars).flatMap(([k, v]) => ['-v', `${k}=${v}`])];
    try {
      return { ok: true, out: execFileSync('psql', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (e: any) {
      return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    const area = await s.serviceArea({ name: 'Reset Area', lat: 30.42, lng: 31.56 });
    await s.configureDeliveryPricing();
    const vendor = await s.vendor({ serviceAreaId: area.id, lat: 30.42, lng: 31.56, commissionBasisPoints: 1000 });
    const product = await s.product(vendor);
    const home = { lat: 30.421, lng: 31.561 };
    customers = [await s.customer('Kept Customer A'), await s.customer('Kept Customer B')];

    // a delivered order: driver, proof photo, financial events
    await s.driver({ lat: 30.42, lng: 31.56 });
    await s.addToCart(customers[0], product.id, 1);
    const delivered = await s.checkout(customers[0], home, 'COD');
    await s.vendorPrepares(vendor, delivered.id);
    const d = await s.driverAssignedTo(delivered.id);
    const sa = await s.superAdmin();
    expectData(await world.api('patch', `/admin/drivers/${d.driverId}/commission-rate`, { token: sa.accessToken, body: { commissionRateBasisPoints: 2000 } }));
    const delivery = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: d.accessToken })).find((x) => x.orderId === delivered.id);
    const step = (status: string, extra: Record<string, unknown> = {}) => world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: d.accessToken, body: { status, ...extra } });
    expectData(await step('PICKED_UP'));
    expectData(await step('ON_THE_WAY'));
    expectData(await step('DELIVERED', { proofPhotoUrl: await s.uploadFakePhoto(d.accessToken), recipientName: 'A' }));

    // an order still open
    await s.addToCart(customers[1], product.id, 2);
    await s.checkout(customers[1], home, 'COD');
    expect(await count(`SELECT count(*) AS n FROM financial_events`)).toBeGreaterThan(0);
  });
  afterAll(async () => {
    await world.close();
  });

  it('the dry run prints the plan and changes nothing', async () => {
    const orders = await count(`SELECT count(*) AS n FROM orders`);
    const r = runScript({ cutoff: "'2100-01-01 00:00:00+00'" });
    expect(r.ok).toBe(true);
    expect(r.out).toContain('DRY RUN');
    expect(await count(`SELECT count(*) AS n FROM orders`)).toBe(orders);
  });

  it('refuses to run when an order is newer than the cutoff', async () => {
    const r = runScript({ cutoff: "'2000-01-01 00:00:00+00'", apply: 'yes' });
    expect(r.ok).toBe(false);
    expect(r.out).toContain('created after the cutoff');
    expect(await count(`SELECT count(*) AS n FROM orders`)).toBeGreaterThan(0);
  });

  it('refuses to run without a cutoff', async () => {
    const r = runScript({ apply: 'yes' });
    expect(r.out).toContain('pass the cutoff');
    expect(await count(`SELECT count(*) AS n FROM orders`)).toBeGreaterThan(0);
  });

  it('applied: orders, drivers and their history are gone; customers, stores and menus stay; driver phones are free', async () => {
    const customersBefore = await count(`SELECT count(*) AS n FROM users WHERE role = 'CUSTOMER' AND deleted_at IS NULL`);
    const productsBefore = await count(`SELECT count(*) AS n FROM products WHERE deleted_at IS NULL`);
    const r = runScript({ cutoff: "'2100-01-01 00:00:00+00'", apply: 'yes' });
    expect(r.out).toContain('COMMIT');
    expect(r.ok).toBe(true);
    for (const table of ['orders', 'order_vendor_segments', 'order_items', 'deliveries', 'payments', 'proof_of_deliveries', 'dispatch_attempts', 'drivers', 'vendor_settlement_periods', 'driver_settlement_periods']) {
      expect([table, await count(`SELECT count(*) AS n FROM ${table}`)]).toEqual([table, 0]);
    }
    expect(await count(`SELECT count(*) AS n FROM financial_events WHERE order_id IS NOT NULL OR driver_id IS NOT NULL`)).toBe(0);
    expect(await count(`SELECT count(*) AS n FROM users WHERE role = 'CUSTOMER' AND deleted_at IS NULL`)).toBe(customersBefore);
    expect(await count(`SELECT count(*) AS n FROM products WHERE deleted_at IS NULL`)).toBe(productsBefore);
    expect(await count(`SELECT count(*) AS n FROM users WHERE role = 'DRIVER' AND (deleted_at IS NULL OR is_active OR phone NOT LIKE 'del-%')`)).toBe(0);
    // the kept customer still signs in and sees an empty order list
    const res = await world.api('get', '/orders', { token: customers[0].accessToken });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body.data)).toBe('[]');
  });
});
