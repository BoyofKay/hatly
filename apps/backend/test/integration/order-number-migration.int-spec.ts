import { DataSource } from 'typeorm';
import { resetAndMigrate } from './support/db';
import { TestData } from './support/test-data';

/**
 * The `OrderNumber` migration's backfill, against real PostgreSQL: existing ("legacy") orders that predate the column get a real,
 * unique, deterministically-ordered number; the column then becomes NOT NULL + UNIQUE; and the sequence a NEW order draws from
 * afterwards continues past every backfilled value (no restart, no collision).
 *
 * `undoLastMigration()` reverts back to the pre-`OrderNumber` schema — dropping the column, its unique index and the
 * sequence — which is exactly the schema legacy orders were created under. Raw rows are then inserted directly
 * (bypassing `OrderCreationService`/`nextOrderNumber`, exactly like a real pre-migration order would have been), and
 * migrating forward again re-applies the SAME `up()` the production deploy runs.
 *
 * Every migration that landed AFTER `OrderNumber` (indexes, marketplace subcategories, proof of delivery, ...) is unrelated to
 * `order_number`, so it sits on top of it and must be undone first, then re-applied in the same order production would. The set
 * is derived from the registered migrations (ordered by their timestamp) rather than hardcoded, so adding a migration never
 * silently breaks this test: it undoes exactly "everything after OrderNumber, then OrderNumber", and asserts the re-apply list
 * is exactly that, in order.
 */
describe('OrderNumber migration — backfill on real PostgreSQL', () => {
  let dataSource: DataSource;
  let data: TestData;

  beforeAll(async () => {
    const { AppDataSource } = await import('../../src/database/data-source');
    dataSource = AppDataSource;
    if (!dataSource.isInitialized) await dataSource.initialize();
  });

  afterAll(async () => {
    // This spec undoes real migrations. Whatever happened (including a failure midway), leave the shared integration
    // database fully migrated so the specs that run after it never inherit a half-reverted schema.
    try {
      if (dataSource?.isInitialized) await resetAndMigrate(dataSource);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  });

  it('backfills legacy orders deterministically (created_at, id), then enforces NOT NULL + UNIQUE, and the sequence continues past them', async () => {
    await resetAndMigrate(dataSource);
    data = new TestData(dataSource);

    // Revert to the pre-OrderNumber schema: no order_number column, no sequence. Everything registered after `OrderNumber`
    // is undone first (unrelated migrations — harmless to drop/reapply here), then `OrderNumber` itself.
    const ordered = dataSource.migrations
      .map((m) => m.name as string)
      .sort((x, y) => Number(/(\d+)$/.exec(x)![1]) - Number(/(\d+)$/.exec(y)![1]));
    const from = ordered.indexOf('OrderNumber1700004300000');
    expect(from).toBeGreaterThanOrEqual(0);
    const expectedReapply = ordered.slice(from);
    // The customer is created on the CURRENT schema (the User entity knows columns later migrations add, e.g. staff_level),
    // before the schema is rolled back; the legacy orders below are raw SQL on the old schema.
    const customer = await data.user();
    for (let i = 0; i < expectedReapply.length; i++) await dataSource.undoLastMigration();
    const columnsBefore = await dataSource.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'order_number'",
    );
    expect(columnsBefore).toEqual([]);

    // Three "legacy" orders, inserted directly (as they would have existed before this migration ever ran), with created_at
    // spread out and NOT in insertion order — the backfill must follow created_at, not insertion order or id.
    const legacyIds: string[] = [];
    const createdAts = [
      new Date('2024-01-03T00:00:00Z'),
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-02T00:00:00Z'),
    ];
    for (const createdAt of createdAts) {
      const [{ id }] = await dataSource.query(
        `INSERT INTO orders (customer_id, status, fulfillment_type, subtotal_minor, payment_method, created_at, updated_at)
         VALUES ($1, 'PENDING', 'DELIVERY', 1000, 'COD', $2, $2) RETURNING id`,
        [customer.id, createdAt],
      );
      legacyIds.push(id);
    }

    // Re-apply — this runs the OrderNumber migration's up() against the legacy rows above .
    const applied = await dataSource.runMigrations({ transaction: 'each' });
    expect(applied.map((m) => m.name)).toEqual(expectedReapply);

    const rows: Array<{ id: string; order_number: string; created_at: Date }> = await dataSource.query(
      `SELECT id, order_number, created_at FROM orders WHERE id = ANY($1::uuid[]) ORDER BY created_at ASC`,
      [legacyIds],
    );
    expect(rows).toHaveLength(3);

    // Format: HT- plus at least 6 digits.
    for (const row of rows) expect(row.order_number).toMatch(/^HT-\d{6,}$/);

    // Deterministic order: the sequence values increase with created_at, regardless of insertion/id order.
    const seqOf = (n: string) => Number(n.replace('HT-', ''));
    const seqs = rows.map((r) => seqOf(r.order_number));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(3);

    // NOT NULL + UNIQUE now hold at the database level.
    await expect(
      dataSource.query(
        `INSERT INTO orders (customer_id, status, fulfillment_type, subtotal_minor, payment_method) VALUES ($1, 'PENDING', 'DELIVERY', 1000, 'COD')`,
        [customer.id],
      ),
    ).rejects.toThrow(/order_number/);
    await expect(
      dataSource.query(
        `INSERT INTO orders (customer_id, order_number, status, fulfillment_type, subtotal_minor, payment_method) VALUES ($1, $2, 'PENDING', 'DELIVERY', 1000, 'COD')`,
        [customer.id, rows[0].order_number],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);

    // The NEXT value the real generator (`nextOrderNumber`, drawing from this same sequence) would hand a genuinely new order is
    // strictly after every backfilled one: the sequence was advanced BY the backfill itself, never reset.
    const [{ nextval }] = await dataSource.query("SELECT nextval('order_number_seq') AS nextval");
    expect(Number(nextval)).toBeGreaterThan(Math.max(...seqs));
  });
});
