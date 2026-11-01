import { DataSource } from 'typeorm';
import { resetAndMigrate } from './support/db';
import { TestData } from './support/test-data';
import { NotificationOutboxAndChangeFeed1700007100000 } from '../../src/database/migrations/1700007100000-NotificationOutboxAndChangeFeed';

/**
 * Slice 2 schema, against real PostgreSQL: event-level notification uniqueness, the outbox's honesty constraints (no delivered/opened state,
 * SENT ⇔ sent_at, SKIPPED needs a reason), the change-feed triggers (transactional, ordered, rollback-safe) and a clean down()/up().
 */
describe('NotificationOutboxAndChangeFeed migration', () => {
  let ds: DataSource;
  let data: TestData;
  const migration = new NotificationOutboxAndChangeFeed1700007100000();
  const exists = async (table: string) => (await ds.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1", [table]))[0].n === 1;
  const column = async (table: string, name: string) => (await ds.query('SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = $1 AND column_name = $2', [table, name]))[0].n === 1;
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

  it('notifications of one event are unique per (order, type, event); lifecycle notifications stay unique per (order, type)', async () => {
    const customer = await data.user();
    const order = await data.order(customer.id);
    const insert = (type: string, key: string | null) =>
      ds.query('INSERT INTO customer_notifications (customer_id, order_id, type, order_number, event_key) VALUES ($1, $2, $3, $4, $5)', [customer.id, order.id, type, order.orderNumber, key]);
    await insert('ORDER_PLACED', null);
    expect(await rejects('INSERT INTO customer_notifications (customer_id, order_id, type, order_number) VALUES ($1, $2, $3, $4)', [customer.id, order.id, 'ORDER_PLACED', order.orderNumber])).toBe(true);
    await insert('ORDER_ITEM_UNAVAILABLE', 'exception:a:items:1');
    await insert('ORDER_ITEM_UNAVAILABLE', 'exception:b:items:1'); // another case of the same order notifies again
    expect(await rejects('INSERT INTO customer_notifications (customer_id, order_id, type, order_number, event_key) VALUES ($1, $2, $3, $4, $5)', [customer.id, order.id, 'ORDER_ITEM_UNAVAILABLE', order.orderNumber, 'exception:a:items:1'])).toBe(true);
    await data.dispose();
  });

  it('the outbox cannot represent "delivered" or "opened", and its states stay consistent', async () => {
    const customer = await data.user();
    const base = `INSERT INTO notification_outbox (event_key, recipient_user_id, recipient_kind, channel, category, title, body, status, sent_at, skip_reason) VALUES ($1, $2, 'CUSTOMER', 'PUSH', 'C', 't', 'b', $3, $4, $5)`;
    expect(await rejects(base, ['k1', customer.id, 'DELIVERED', null, null])).toBe(true);
    expect(await rejects(base, ['k2', customer.id, 'OPENED', null, null])).toBe(true);
    expect(await rejects(base, ['k3', customer.id, 'SENT', null, null])).toBe(true); // SENT needs evidence of the hand-over
    expect(await rejects(base, ['k4', customer.id, 'QUEUED', new Date(), null])).toBe(true); // a timestamp without the state
    expect(await rejects(base, ['k5', customer.id, 'SKIPPED', null, null])).toBe(true); // skipped needs a reason
    await ds.query(base, ['ok1', customer.id, 'SKIPPED', null, 'NO_DEVICE']);
    await ds.query(base, ['ok2', customer.id, 'SENT', new Date(), null]);
    expect(await rejects(base, ['ok2', customer.id, 'SENT', new Date(), null])).toBe(true); // same event + recipient + channel
    await ds.query('DELETE FROM notification_outbox');
    await data.dispose();
  });

  it('the database records a change in the same transaction as the change — and nothing when it rolls back', async () => {
    const customer = await data.user();
    const branch = await data.vendorBranch();
    const order = await data.order(customer.id);
    const segment = await data.segment(order.id, branch.id);
    const events = (id: string) => ds.query('SELECT entity, kind, vendor_branch_id, txid FROM change_events WHERE entity_id = $1 ORDER BY seq', [id]);

    expect((await events(segment.id)).map((e: any) => e.kind)).toEqual(['CREATED']);
    expect((await events(order.id)).map((e: any) => [e.entity, e.kind])).toEqual([['ORDER', 'CREATED']]);

    await expect(
      ds.transaction(async (m) => {
        await m.query("UPDATE order_vendor_segments SET status = 'CONFIRMED' WHERE id = $1", [segment.id]);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect((await events(segment.id)).length).toBe(1);

    await ds.query("UPDATE order_vendor_segments SET status = 'CONFIRMED' WHERE id = $1", [segment.id]);
    expect((await events(segment.id)).map((e: any) => e.kind)).toEqual(['CREATED', 'STATUS']);
    // An order-level change reaches the vendor as a change of its part.
    await ds.query("UPDATE orders SET status = 'CANCELLED' WHERE id = $1", [order.id]);
    const forVendor = await ds.query("SELECT kind FROM change_events WHERE entity = 'SEGMENT' AND entity_id = $1 AND kind LIKE 'ORDER_%'", [segment.id]);
    expect(forVendor.length).toBe(1);
    // A statement that changes nothing writes nothing.
    const before = (await ds.query('SELECT count(*)::int AS n FROM change_events'))[0].n;
    await ds.query('UPDATE orders SET status = status WHERE id = $1', [order.id]);
    expect((await ds.query('SELECT count(*)::int AS n FROM change_events'))[0].n).toBe(before);
    // Every event carries the transaction it belongs to (the reader's ordering key) and the branch that scopes it.
    const rows = await events(segment.id);
    expect(rows.every((e: any) => e.vendor_branch_id === branch.id && Number(e.txid) > 0)).toBe(true);
    await ds.query('DELETE FROM change_events');
    await data.dispose();
  });

  it('down() removes everything it added (and keeps one notification per order and type); up() re-applies cleanly', async () => {
    const customer = await data.user();
    const order = await data.order(customer.id);
    await ds.query("INSERT INTO customer_notifications (customer_id, order_id, type, order_number, event_key) VALUES ($1, $2, 'ORDER_ITEM_UNAVAILABLE', $3, 'exception:a:items:1')", [customer.id, order.id, order.orderNumber]);
    await ds.query("INSERT INTO customer_notifications (customer_id, order_id, type, order_number, event_key) VALUES ($1, $2, 'ORDER_ITEM_UNAVAILABLE', $3, 'exception:b:items:1')", [customer.id, order.id, order.orderNumber]);
    const runner = ds.createQueryRunner();
    await runner.connect();
    try {
      await migration.down(runner);
      for (const t of ['notification_outbox', 'staff_notifications', 'notification_preferences', 'change_events', 'change_feed_state']) expect(await exists(t)).toBe(false);
      expect(await column('customer_notifications', 'event_key')).toBe(false);
      expect(await column('order_exceptions', 'isolation_code')).toBe(false);
      expect((await ds.query("SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'hatly_emit_change'"))[0].n).toBe(0);
      expect((await ds.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname LIKE 'trg_change_%'"))[0].n).toBe(0);
      expect((await ds.query("SELECT count(*)::int AS n FROM customer_notifications WHERE order_id = $1 AND type = 'ORDER_ITEM_UNAVAILABLE'", [order.id]))[0].n).toBe(1);
      expect((await ds.query("SELECT indexdef FROM pg_indexes WHERE indexname = 'UQ_customer_notifications_order_type'"))[0].indexdef).not.toMatch(/WHERE/);

      await migration.up(runner);
      for (const t of ['notification_outbox', 'staff_notifications', 'notification_preferences', 'change_events', 'change_feed_state']) expect(await exists(t)).toBe(true);
      expect((await ds.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname LIKE 'trg_change_%'"))[0].n).toBe(6);
      expect((await ds.query('SELECT pruned_through_txid FROM change_feed_state WHERE id = 1')).length).toBe(1);
    } finally {
      await runner.release();
    }
    await data.dispose();
  });
});
