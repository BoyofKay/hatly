import { DataSource } from 'typeorm';
import { resetAndMigrate } from './support/db';
import { TestData } from './support/test-data';
import { OrderOperations1700006400000 } from '../../src/database/migrations/1700006400000-OrderOperations';

/**
 * The order-operations migration is additive and reversible: down() removes exactly what up() added, up() re-applies cleanly, and
 * pre-existing dispatch alerts survive both directions (older duplicate open alerts are RESOLVED, never deleted).
 */
describe('OrderOperations migration (up / down / up)', () => {
  let dataSource: DataSource;
  const migration = new OrderOperations1700006400000();
  const tables = ['order_vendor_segment_events', 'dispatch_attempts', 'refund_payouts'];
  const exists = async (table: string) =>
    (await dataSource.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1", [table]))[0].n === 1;
  const column = async (table: string, name: string) =>
    (await dataSource.query('SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = $1 AND column_name = $2', [table, name]))[0].n === 1;

  beforeAll(async () => {
    const { AppDataSource } = await import('../../src/database/data-source');
    dataSource = AppDataSource;
    if (!dataSource.isInitialized) await dataSource.initialize();
    await resetAndMigrate(dataSource);
  });
  afterAll(async () => {
    try {
      if (dataSource?.isInitialized) await resetAndMigrate(dataSource);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  });

  it('down() removes the new tables, columns and the open-alert unique index; up() restores them all', async () => {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    try {
      for (const t of tables) expect(await exists(t)).toBe(true);
      expect(await column('deliveries', 'consecutive_unanswered')).toBe(true);
      expect(await column('dispatch_alerts', 'detail')).toBe(true);

      await migration.down(runner);
      for (const t of tables) expect(await exists(t)).toBe(false);
      expect(await column('deliveries', 'consecutive_unanswered')).toBe(false);
      expect(await column('dispatch_alerts', 'detail')).toBe(false);
      expect(await column('dispatch_alerts', 'resolved_by_user_id')).toBe(false);

      await migration.up(runner);
      for (const t of tables) expect(await exists(t)).toBe(true);
      const index = await dataSource.query("SELECT indexdef FROM pg_indexes WHERE indexname = 'UQ_dispatch_alerts_open'");
      expect(index[0].indexdef).toMatch(/UNIQUE/);
      const fks = await dataSource.query(
        `SELECT conname FROM pg_constraint WHERE contype = 'f' AND conrelid = ANY(ARRAY['dispatch_attempts'::regclass, 'refund_payouts'::regclass, 'order_vendor_segment_events'::regclass])`,
      );
      expect(fks.length).toBeGreaterThanOrEqual(6);
    } finally {
      await runner.release();
    }
  });

  it('older duplicate OPEN alerts of the same (order, reason) are resolved — never deleted — when the unique index is created', async () => {
    const data = new TestData(dataSource);
    const createdOrderIds: string[] = [];
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    try {
      const customer = await data.user();
      const order = await data.order(customer.id);
      createdOrderIds.push(order.id);
      await migration.down(runner);
      for (const ago of ['3 minutes', '2 minutes', '1 minute']) {
        await dataSource.query(
          `INSERT INTO dispatch_alerts (order_id, reason, created_at) VALUES ($1, 'NO_ELIGIBLE_DRIVER', now() - $2::interval)`,
          [order.id, ago],
        );
      }
      await migration.up(runner);
      const rows = await dataSource.query('SELECT resolved_at FROM dispatch_alerts WHERE order_id = $1 ORDER BY created_at', [order.id]);
      expect(rows).toHaveLength(3); // nothing deleted
      expect(rows.map((r: { resolved_at: Date | null }) => r.resolved_at !== null)).toEqual([true, true, false]); // only the newest stays open
      await expect(
        dataSource.query(`INSERT INTO dispatch_alerts (order_id, reason) VALUES ($1, 'NO_ELIGIBLE_DRIVER')`, [order.id]),
      ).rejects.toThrow(/UQ_dispatch_alerts_open/);
    } finally {
      await dataSource.query('DELETE FROM dispatch_alerts WHERE order_id = ANY($1::uuid[])', [createdOrderIds]);
      await runner.release();
      await data.dispose();
    }
  });
});
