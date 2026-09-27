import { randomUUID } from 'crypto';
import { DataSource, EntityMetadata, ObjectLiteral } from 'typeorm';
import { TestData } from './support/test-data';
import { foreignKeyFixtures } from './support/fk-fixtures';
import { ADDED_FOREIGN_KEYS, ExpectedForeignKey } from './support/referential-integrity';
import { FinancialEvent } from '../../src/modules/finance/entities/financial-event.entity';
import { DeviceToken } from '../../src/modules/notifications/entities/device-token.entity';
import { WalletTransaction } from '../../src/modules/wallet/entities/wallet-transaction.entity';
import { LoyaltyPointsTransaction } from '../../src/modules/loyalty/entities/loyalty-points-transaction.entity';

/**
 * Real PostgreSQL proof of the Group 7A foreign keys. The expected policy comes from
 * support/referential-integrity.ts (independent of the migration's own list), and
 * every check runs against the real constraint, not a mock.
 */
describe('Real PostgreSQL referential integrity (Group 7A foreign keys)', () => {
  let ds: DataSource;
  let data: TestData;

  beforeAll(async () => {
    const { AppDataSource } = await import('../../src/database/data-source');
    ds = AppDataSource;
    if (!ds.isInitialized) await ds.initialize();
    data = new TestData(ds);
  });
  afterEach(async () => {
    await data.dispose();
  });
  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  const fkName = (fk: ExpectedForeignKey) => `fk_${fk.table}_${fk.column}`;
  const meta = (table: string): EntityMetadata => ds.entityMetadatas.find((m) => m.tableName === table)!;
  const prop = (table: string, column: string): string => meta(table).columns.find((c) => c.databaseName === column)!.propertyName;
  const tables = [...new Set(ADDED_FOREIGN_KEYS.map((f) => f.table))];
  const unique = () => randomUUID();

  const { validProps } = foreignKeyFixtures(() => ds, () => data);

  const insert = (table: string, props: Record<string, unknown>) => ds.getRepository(meta(table).target as never).insert(props as never);
  const save = (table: string, props: Record<string, unknown>) => data.save<ObjectLiteral>(meta(table).target as never, props as never);

  // ---- the constraints exist, are validated, and carry the reviewed delete policy --------------------------------------
  it.each(ADDED_FOREIGN_KEYS.map((f) => [`${f.table}.${f.column}`, f] as const))(
    '%s is a real, VALIDATED foreign key with the reviewed ON DELETE policy and nullability',
    async (_label, fk) => {
      const [row] = await ds.query(
        `SELECT c.convalidated, c.confdeltype::text AS action, c.confrelid::regclass::text AS parent, pa.attname::text AS parent_col
         FROM pg_constraint c JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
         WHERE c.conname = $1 AND c.contype = 'f' AND c.conrelid = quote_ident($2)::regclass`,
        [fkName(fk), fk.table],
      );
      expect(row).toBeDefined();
      expect(row.convalidated).toBe(true);
      expect(row.parent).toBe(fk.references);
      expect(row.parent_col).toBe('id');
      expect(row.action).toBe(fk.onDelete === 'CASCADE' ? 'c' : 'a');
      const [col] = await ds.query('SELECT is_nullable FROM information_schema.columns WHERE table_name = $1 AND column_name = $2', [fk.table, fk.column]);
      expect(col.is_nullable === 'YES').toBe(fk.nullable);
      expect(fk.financialHistory ? fk.onDelete : 'any').not.toBe('CASCADE'); // financial history is never cascade-deletable
    },
  );

  // ---- valid references are accepted ---------------------------------------------------------------------------------
  it.each(tables)('%s: a row whose every reference points at a real row is accepted and reloads intact', async (table) => {
    const props = await validProps(table);
    const saved = (await save(table, props)) as { id: string };
    const [reloaded] = await ds.query(`SELECT * FROM "${table}" WHERE id = $1`, [saved.id]);
    for (const fk of ADDED_FOREIGN_KEYS.filter((f) => f.table === table)) {
      expect(reloaded[fk.column]).toBe(props[prop(table, fk.column)]);
    }
  });

  // ---- invalid references are rejected by PostgreSQL itself, naming the exact constraint -------------------------------
  it.each(ADDED_FOREIGN_KEYS.map((f) => [`${f.table}.${f.column}`, f] as const))(
    '%s rejects a reference to a row that does not exist (23503, from the expected constraint)',
    async (_label, fk) => {
      const props = { ...(await validProps(fk.table)), [prop(fk.table, fk.column)]: randomUUID() };
      await expect(insert(fk.table, props)).rejects.toMatchObject({ code: '23503', constraint: fkName(fk) });
    },
  );

  // ---- nullable / NOT NULL behaviour ----------------------------------------------------------------------------------
  it.each(ADDED_FOREIGN_KEYS.map((f) => [`${f.table}.${f.column}`, f] as const))(
    '%s: NULL is %s as designed',
    async (_label, fk) => {
      const props = { ...(await validProps(fk.table)), [prop(fk.table, fk.column)]: null };
      if (fk.nullable) {
        const saved = (await save(fk.table, props)) as { id: string };
        const [row] = await ds.query(`SELECT "${fk.column}" AS v FROM "${fk.table}" WHERE id = $1`, [saved.id]);
        expect(row.v).toBeNull();
      } else {
        await expect(insert(fk.table, props)).rejects.toMatchObject({ code: '23502' });
      }
    },
  );

  // ---- delete policy: NO ACTION refuses, nothing cascades, history survives -----------------------------------------------
  it.each(ADDED_FOREIGN_KEYS.filter((f) => f.onDelete === 'NO ACTION').map((f) => [`${f.table}.${f.column}`, f] as const))(
    '%s: deleting the referenced row is REFUSED (NO ACTION) and the referencing history survives untouched',
    async (_label, fk) => {
      const props = await validProps(fk.table);
      const child = (await save(fk.table, props)) as { id: string };
      const parentIdValue = props[prop(fk.table, fk.column)] as string;

      await expect(ds.query(`DELETE FROM "${fk.references}" WHERE id = $1`, [parentIdValue])).rejects.toMatchObject({
        code: '23503',
        constraint: fkName(fk),
      });

      expect((await ds.query(`SELECT count(*)::int AS n FROM "${fk.table}" WHERE id = $1`, [child.id]))[0].n).toBe(1);
      expect((await ds.query(`SELECT count(*)::int AS n FROM "${fk.references}" WHERE id = $1`, [parentIdValue]))[0].n).toBe(1);
    },
  );

  it('an attempted delete of a user with wallet + loyalty + device-token rows is refused as a whole — no ledger row is lost and NOTHING is cascaded (the tokens survive too)', async () => {
    const user = await data.user();
    const wallet = await data.save<WalletTransaction>(WalletTransaction, {
      customerId: user.id, amountDeltaMinor: 900, type: 'ADMIN_CREDIT' as never, reason: 'x', idempotencyKey: `ri-${unique()}`,
    });
    const loyalty = await data.save<LoyaltyPointsTransaction>(LoyaltyPointsTransaction, {
      customerId: user.id, pointsDelta: 30, type: 'ADMIN_ADJUSTMENT' as never, reason: 'x', idempotencyKey: `ri-${unique()}`,
    });
    const token = await data.save<DeviceToken>(DeviceToken, { userId: user.id, token: `tok-${unique()}`, platform: 'ios' });

    await expect(ds.query('DELETE FROM users WHERE id = $1', [user.id])).rejects.toMatchObject({ code: '23503' });

    expect((await ds.query('SELECT count(*)::int AS n FROM wallet_transactions WHERE id = $1', [wallet.id]))[0].n).toBe(1);
    expect((await ds.query('SELECT count(*)::int AS n FROM loyalty_points_transactions WHERE id = $1', [loyalty.id]))[0].n).toBe(1);
    expect((await ds.query('SELECT count(*)::int AS n FROM device_tokens WHERE id = $1', [token.id]))[0].n).toBe(1);
  });

  it('an order that has ledger/financial history cannot be deleted, and no history row follows it away', async () => {
    const customer = await data.user();
    const order = await data.order(customer.id);
    const event = await data.save<FinancialEvent>(FinancialEvent, { type: 'FAILED_DELIVERY_RECORDED', direction: 'INFORMATIONAL', idempotencyKey: `ri-${unique()}`, orderId: order.id } as never);
    const wallet = await data.save<WalletTransaction>(WalletTransaction, {
      customerId: customer.id, orderId: order.id, amountDeltaMinor: 5, type: 'ORDER_REFUND' as never, idempotencyKey: `ri-${unique()}`,
    });

    await expect(ds.query('DELETE FROM orders WHERE id = $1', [order.id])).rejects.toMatchObject({ code: '23503' });
    expect((await ds.query('SELECT count(*)::int AS n FROM financial_events WHERE id = $1', [event.id]))[0].n).toBe(1);
    expect((await ds.query('SELECT count(*)::int AS n FROM wallet_transactions WHERE id = $1', [wallet.id]))[0].n).toBe(1);
  });

  // ---- the one CASCADE: device tokens ------------------------------------------------------------------------------------
  it('device_tokens.user_id CASCADE: deleting a user with no ledger history removes exactly that user\'s tokens and no one else\'s', async () => {
    const leaving = await data.user();
    const staying = await data.user();
    await data.save<DeviceToken>(DeviceToken, { userId: leaving.id, token: `tok-${unique()}`, platform: 'android' });
    await data.save<DeviceToken>(DeviceToken, { userId: leaving.id, token: `tok-${unique()}`, platform: 'ios' });
    const kept = await data.save<DeviceToken>(DeviceToken, { userId: staying.id, token: `tok-${unique()}`, platform: 'android' });

    await ds.query('DELETE FROM users WHERE id = $1', [leaving.id]);

    expect((await ds.query('SELECT count(*)::int AS n FROM device_tokens WHERE user_id = $1', [leaving.id]))[0].n).toBe(0);
    expect((await ds.query('SELECT count(*)::int AS n FROM device_tokens WHERE id = $1', [kept.id]))[0].n).toBe(1);
    expect((await ds.query('SELECT count(*)::int AS n FROM users WHERE id = $1', [staying.id]))[0].n).toBe(1);
  });
});
