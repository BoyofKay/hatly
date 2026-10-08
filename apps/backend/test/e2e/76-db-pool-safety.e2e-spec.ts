/**
 * M5 Batch 3 — database connection-pool safety under concurrency.
 *
 * The defect: a request that opens a transaction holds ONE pooled connection, and code inside it commonly reads other data via
 * the normal repositories, which checks out a SECOND connection from the same pool. With as many concurrent transactions as the
 * pool has connections, every transaction waits for a connection only another one can free: the pool deadlocks and the whole API
 * stalls (node-postgres waits forever by default). It surfaced as the intermittent 90 s hang of "50 parallel requests" in
 * 50-inventory-concurrency (10 parallel checkouts vs. the default pool of 10) — `pg_stat_activity` showed all 10 connections
 * "idle in transaction" at once.
 *
 * The guard (src/database/transaction-limiter.ts) caps open transactions at pool size − 1. It is proven here deterministically,
 * not by hoping a race lines up: the app runs with a pool of just TWO connections (so at most ONE transaction at a time) and a
 * short acquire timeout, then takes many concurrent transactional requests that DO read through the pool inside their
 * transaction (cart add + checkout). Without the guard two overlapping requests deadlock every time and the rest fail on the
 * acquire timeout; with it all of them complete.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture } from './support/actors';

const KEYS = ['DB_POOL_MAX', 'DB_CONNECTION_TIMEOUT_MS'];
const CONCURRENCY = 8;

describe('E2E — concurrent transactions never deadlock the connection pool (pool of 2)', () => {
  let world: World;
  let s: Scenario;
  let vendor: VendorFixture;
  let product: { id: string };
  const saved: Record<string, string | undefined> = {};
  const home = { lat: 30.425, lng: 31.565 };

  beforeAll(async () => {
    for (const k of KEYS) saved[k] = process.env[k];
    process.env.DB_POOL_MAX = '2';
    process.env.DB_CONNECTION_TIMEOUT_MS = '4000';
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    vendor = await s.vendor({ name: 'Pool Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    product = await s.product(vendor, { name: 'Pool Product', priceMinor: 10000, inventoryMode: 'TRACKED', quantity: 100 });
  });

  afterAll(async () => {
    try {
      await world?.close();
    } finally {
      for (const k of KEYS) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
    }
  });

  const customers = (n: number): Promise<Actor[]> => Promise.all(Array.from({ length: n }, (_, i) => s.customer(`Pool Customer ${i}`)));

  it('the app really runs on a pool of two (guards the test itself)', () => {
    expect((world.ds.driver as any).master.options.max).toBe(2);
  });

  it(`${CONCURRENCY} concurrent cart additions (a transaction that reads through the pool while open) all succeed`, async () => {
    const actors = await customers(CONCURRENCY);
    const results = await Promise.all(
      actors.map((c) => world.api('post', '/cart/items', { token: c.accessToken, body: { productId: product.id, quantity: 1 } })),
    );
    expect(results.map((r) => r.status)).toEqual(Array(CONCURRENCY).fill(201));
  });

  it(`${CONCURRENCY} concurrent checkouts (cart lock + planner + inventory + snapshots) all succeed, and stock is decremented exactly once each`, async () => {
    const before = (await world.ds.query('SELECT quantity FROM products WHERE id = $1', [product.id]))[0].quantity as number;
    const actors = await customers(CONCURRENCY);
    for (const c of actors) await s.addToCart(c, product.id, 1);
    const results = await Promise.all(actors.map((c) => s.checkout(c, home).then(() => 201, (e: Error) => e.message)));
    expect(results).toEqual(Array(CONCURRENCY).fill(201));
    expect((await world.ds.query('SELECT quantity FROM products WHERE id = $1', [product.id]))[0].quantity).toBe(before - CONCURRENCY);
  });

  it('plain reads keep being served while transactions are queued (the API does not stall)', async () => {
    const actors = await customers(CONCURRENCY);
    const writes = actors.map((c) => world.api('post', '/cart/items', { token: c.accessToken, body: { productId: product.id, quantity: 1 } }));
    const reads = Array.from({ length: 20 }, () => world.api('get', `/vendor-branches/${vendor.branchId}/products`));
    const results = await Promise.all([...writes, ...reads]);
    expect(results.filter((r) => r.status >= 500)).toEqual([]);
  });
});
