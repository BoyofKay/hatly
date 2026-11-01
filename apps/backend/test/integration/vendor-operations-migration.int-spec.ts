import { DataSource } from 'typeorm';
import { resetAndMigrate } from './support/db';
import { TestData } from './support/test-data';
import { VendorOperationsFoundations1700007200000 } from '../../src/database/migrations/1700007200000-VendorOperationsFoundations';

/**
 * Vendor-operations schema, against real PostgreSQL: closure range/overlay constraints, the stock-movement trigger (every quantity change leaves a
 * row, context is transaction-local, no context is recorded honestly as UNATTRIBUTED, a rolled-back change leaves nothing), one open stocktake per
 * branch, the settlement-term values, and a clean down()/up().
 */
describe('VendorOperationsFoundations migration', () => {
  let ds: DataSource;
  let data: TestData;
  const migration = new VendorOperationsFoundations1700007200000();
  const exists = async (table: string) => (await ds.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1", [table]))[0].n === 1;
  const rejects = async (sql: string, params: unknown[] = []) => {
    let failed = false;
    await ds.transaction(async (m) => {
      try {
        await m.transaction(async (sp) => void (await sp.query(sql, params)));
      } catch {
        failed = true;
      }
    });
    return failed;
  };

  /** A tracked product with a stated quantity on a fresh branch, created through SQL so the INSERT trigger is exercised too. */
  async function trackedProduct(quantity: number) {
    const branch = await data.vendorBranch();
    const [category] = await ds.query(`INSERT INTO product_categories (vendor_branch_id, name) VALUES ($1, $2) RETURNING id`, [branch.id, `cat-${Date.now()}`]).catch(() => [null]);
    const [product] = await ds.query(
      `INSERT INTO products (vendor_branch_id, category_id, name, price_minor, inventory_mode, quantity, pricing_unit) VALUES ($1, $2, 'Ledger product', 1000, 'TRACKED', $3, 'PIECE') RETURNING id`,
      [branch.id, category?.id ?? null, quantity],
    );
    data.track('products', product.id);
    return { branch, productId: product.id as string };
  }
  const movements = (productId: string) => ds.query('SELECT reason, before_quantity AS before, after_quantity AS after, delta, source_captured, actor_user_id FROM stock_movements WHERE product_id = $1 ORDER BY occurred_at, id', [productId]);

  beforeAll(async () => {
    const { AppDataSource } = await import('../../src/database/data-source');
    ds = AppDataSource;
    if (!ds.isInitialized) await ds.initialize();
    await resetAndMigrate(ds);
    data = new TestData(ds);
  });
  afterAll(async () => {
    try {
      if (ds?.isInitialized) await resetAndMigrate(ds);
    } finally {
      if (ds?.isInitialized) await ds.destroy();
    }
  });

  it('the stock trigger records every quantity change; context is transaction-local; no context is UNATTRIBUTED; a rollback leaves no row', async () => {
    const actor = await data.user();
    const { productId } = await trackedProduct(20);
    expect(await movements(productId)).toEqual([expect.objectContaining({ reason: 'INITIAL_STOCK', before: null, after: 20, delta: 20, source_captured: true })]);

    await ds.transaction(async (m) => {
      await m.query(`SELECT set_config('hatly.stock_ctx', $1, true)`, [JSON.stringify({ reason: 'MANUAL_ADJUSTMENT', actorUserId: actor.id, actorRole: 'VENDOR' })]);
      await m.query('UPDATE products SET quantity = 15 WHERE id = $1', [productId]);
    });
    // the context ended with that transaction: the next change has none
    await ds.query('UPDATE products SET quantity = 14 WHERE id = $1', [productId]);
    const rows = await movements(productId);
    expect(rows[1]).toMatchObject({ reason: 'MANUAL_ADJUSTMENT', before: 20, after: 15, delta: -5, source_captured: true, actor_user_id: actor.id });
    expect(rows[2]).toMatchObject({ reason: 'UNATTRIBUTED', before: 15, after: 14, delta: -1, source_captured: false, actor_user_id: null });

    // a change that is not a quantity change writes nothing
    await ds.query("UPDATE products SET name = 'Renamed' WHERE id = $1", [productId]);
    expect(await movements(productId)).toHaveLength(3);

    // a rolled-back change leaves nothing behind
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await runner.query('UPDATE products SET quantity = 1 WHERE id = $1', [productId]);
    await runner.rollbackTransaction();
    await runner.release();
    expect(await movements(productId)).toHaveLength(3);

    // an untracked product never enters the ledger
    await ds.query("UPDATE products SET inventory_mode = 'OPEN', quantity = NULL WHERE id = $1", [productId]);
    const after = await movements(productId);
    expect(after[3]).toMatchObject({ before: 14, after: null, delta: -14 }); // leaving TRACKED is itself a recorded change
    await ds.query('UPDATE products SET price_minor = 2000 WHERE id = $1', [productId]);
    expect(await movements(productId)).toHaveLength(4);
    await data.dispose();
  });

  it('closures: the end must follow the start, the kind is one of two, and a closure needs a real branch and a real creator', async () => {
    const branch = await data.vendorBranch();
    const user = await data.user();
    const insert = (kind: string, start: string, end: string, branchId = branch.id, creator = user.id) =>
      ds.query(`INSERT INTO vendor_branch_closures (vendor_branch_id, kind, starts_at, ends_at, reason, created_by_user_id) VALUES ($1, $2, $3, $4, 'r', $5)`, [branchId, kind, start, end, creator]);
    expect(await rejects(`INSERT INTO vendor_branch_closures (vendor_branch_id, kind, starts_at, ends_at, reason, created_by_user_id) VALUES ($1, 'TEMPORARY', now(), now(), 'r', $2)`, [branch.id, user.id])).toBe(true);
    expect(await rejects(`INSERT INTO vendor_branch_closures (vendor_branch_id, kind, starts_at, ends_at, reason, created_by_user_id) VALUES ($1, 'FOREVER', now(), now() + interval '1 hour', 'r', $2)`, [branch.id, user.id])).toBe(true);
    expect(await rejects(`INSERT INTO vendor_branch_closures (vendor_branch_id, kind, starts_at, ends_at, reason, created_by_user_id) VALUES ($1, 'HOLIDAY', now(), now() + interval '1 hour', 'r', $2)`, ['00000000-0000-4000-8000-000000000000', user.id])).toBe(true);
    await insert('HOLIDAY', new Date().toISOString(), new Date(Date.now() + 3_600_000).toISOString());
    await ds.query('DELETE FROM vendor_branch_closures WHERE vendor_branch_id = $1', [branch.id]);
    await data.dispose();
  });

  it('only one OPEN stocktake per branch; settlement terms are WEEKLY or MONTHLY only; one row per vendor', async () => {
    const branch = await data.vendorBranch();
    const user = await data.user();
    await ds.query(`INSERT INTO stocktakes (vendor_branch_id, created_by_user_id) VALUES ($1, $2)`, [branch.id, user.id]);
    expect(await rejects(`INSERT INTO stocktakes (vendor_branch_id, created_by_user_id) VALUES ($1, $2)`, [branch.id, user.id])).toBe(true);
    await ds.query(`UPDATE stocktakes SET status = 'CANCELLED' WHERE vendor_branch_id = $1`, [branch.id]);
    await ds.query(`INSERT INTO stocktakes (vendor_branch_id, created_by_user_id) VALUES ($1, $2)`, [branch.id, user.id]); // allowed again once the first is closed
    await ds.query('DELETE FROM stocktakes WHERE vendor_branch_id = $1', [branch.id]);

    expect(await rejects(`INSERT INTO vendor_settlement_terms (vendor_id, frequency, updated_by_user_id) VALUES ($1, 'DAILY', $2)`, [branch.vendorId, user.id])).toBe(true);
    await ds.query(`INSERT INTO vendor_settlement_terms (vendor_id, frequency, updated_by_user_id) VALUES ($1, 'WEEKLY', $2)`, [branch.vendorId, user.id]);
    expect(await rejects(`INSERT INTO vendor_settlement_terms (vendor_id, frequency, updated_by_user_id) VALUES ($1, 'MONTHLY', $2)`, [branch.vendorId, user.id])).toBe(true);
    await ds.query('DELETE FROM vendor_settlement_terms WHERE vendor_id = $1', [branch.vendorId]);
    await data.dispose();
  });

  it('down() removes everything it added and the products table is back to normal; up() re-applies cleanly', async () => {
    const runner = ds.createQueryRunner();
    await runner.connect();
    try {
      await migration.down(runner);
      for (const t of ['vendor_branch_closures', 'stock_ledger_info', 'stock_movements', 'stocktakes', 'stocktake_lines', 'vendor_settlement_terms']) expect(await exists(t)).toBe(false);
      expect((await ds.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname LIKE 'trg_stock_movement_%'"))[0].n).toBe(0);
      expect((await ds.query("SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'hatly_record_stock_movement'"))[0].n).toBe(0);
      await migration.up(runner);
      for (const t of ['vendor_branch_closures', 'stock_ledger_info', 'stock_movements', 'stocktakes', 'stocktake_lines', 'vendor_settlement_terms']) expect(await exists(t)).toBe(true);
      expect((await ds.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname LIKE 'trg_stock_movement_%'"))[0].n).toBe(2);
      expect((await ds.query('SELECT started_at FROM stock_ledger_info WHERE id = 1')).length).toBe(1);
    } finally {
      await runner.release();
    }
  });
});
