import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { TestData } from './support/test-data';
import { Role } from '../../src/common/enums/role.enum';
import { ProofOfDelivery } from '../../src/modules/delivery/entities/proof-of-delivery.entity';
import { ProofOfDeliveryForeignKeys1700004800000 } from '../../src/database/migrations/1700004800000-ProofOfDeliveryForeignKeys';

/**
 * M5 Batch 3 — `proof_of_deliveries` is append-only evidence; its order/delivery/driver references must be real, validated,
 * NO ACTION foreign keys (migration 1700004800000), exactly like the other evidence/ledger tables (Group 7A).
 */
describe('proof_of_deliveries referential integrity (real PostgreSQL)', () => {
  let ds: DataSource;
  let data: TestData;
  const migration = new ProofOfDeliveryForeignKeys1700004800000();
  const COLUMNS = [
    ['order_id', 'orders'],
    ['delivery_id', 'deliveries'],
    ['driver_id', 'drivers'],
  ] as const;

  beforeAll(async () => {
    const { AppDataSource } = await import('../../src/database/data-source');
    ds = AppDataSource;
    if (!ds.isInitialized) await ds.initialize();
    data = new TestData(ds);
  });
  afterAll(async () => {
    await data.dispose();
    if (ds?.isInitialized) await ds.destroy();
  });

  async function validProps() {
    const customer = await data.user();
    const order = await data.order(customer.id);
    const driver = await data.driver((await data.user({ role: Role.DRIVER })).id);
    const delivery = await data.delivery(order.id, driver.id);
    return { orderId: order.id, deliveryId: delivery.id, driverId: driver.id, photoUrl: '/uploads/files/x.png', submittedAt: new Date() };
  }

  it.each(COLUMNS)('%s is a validated NO ACTION foreign key to %s', async (column, parent) => {
    const [row] = await ds.query(
      `SELECT convalidated, confdeltype::text AS action, confrelid::regclass::text AS parent
       FROM pg_constraint WHERE conname = $1 AND contype = 'f' AND conrelid = 'proof_of_deliveries'::regclass`,
      [`fk_proof_of_deliveries_${column}`],
    );
    expect(row).toMatchObject({ convalidated: true, action: 'a', parent });
  });

  it('a row whose references are all real is accepted', async () => {
    const saved = await data.save<ProofOfDelivery>(ProofOfDelivery, (await validProps()) as never);
    expect(saved.id).toBeDefined();
  });

  it.each([
    ['orderId', 'order_id'],
    ['deliveryId', 'delivery_id'],
    ['driverId', 'driver_id'],
  ])('a reference to a nonexistent %s is rejected by PostgreSQL (23503, from the expected constraint)', async (prop, column) => {
    const props = { ...(await validProps()), [prop]: randomUUID() };
    await expect(ds.getRepository(ProofOfDelivery).insert(props as never)).rejects.toMatchObject({
      code: '23503',
      constraint: `fk_proof_of_deliveries_${column}`,
    });
  });

  it('deleting a referenced order/delivery/driver that has Proof of Delivery history is REFUSED and the evidence survives', async () => {
    const props = await validProps();
    const pod = await data.save<ProofOfDelivery>(ProofOfDelivery, props as never);
    for (const [column, table] of COLUMNS) {
      const id = props[column === 'order_id' ? 'orderId' : column === 'delivery_id' ? 'deliveryId' : 'driverId'];
      await expect(ds.query(`DELETE FROM "${table}" WHERE id = $1`, [id])).rejects.toMatchObject({ code: '23503' });
    }
    expect((await ds.query('SELECT count(*)::int AS n FROM proof_of_deliveries WHERE id = $1', [pod.id]))[0].n).toBe(1);
  });

  it('down() removes exactly its constraints and up() re-adds them over existing valid rows; an orphan makes up() refuse without changing data', async () => {
    const runner = ds.createQueryRunner();
    await runner.connect();
    const names = COLUMNS.map(([c]) => `fk_proof_of_deliveries_${c}`);
    const count = async () => (await ds.query("SELECT count(*)::int AS n FROM pg_constraint WHERE contype='f' AND conname = ANY($1)", [names]))[0].n;
    let orphanId: string | undefined;
    try {
      const valid = await data.save<ProofOfDelivery>(ProofOfDelivery, (await validProps()) as never);
      await migration.down(runner);
      expect(await count()).toBe(0);

      await migration.up(runner);
      expect(await count()).toBe(3);
      expect((await ds.query('SELECT count(*)::int AS n FROM proof_of_deliveries WHERE id = $1', [valid.id]))[0].n).toBe(1);

      await migration.down(runner);
      orphanId = randomUUID();
      await ds.query(
        `INSERT INTO proof_of_deliveries (id, order_id, delivery_id, driver_id, photo_url, submitted_at) VALUES ($1, $2, $2, $2, 'x', now())`,
        [orphanId, randomUUID()],
      );
      await expect(migration.up(runner)).rejects.toThrow(/Refusing to add foreign keys.*proof_of_deliveries\.order_id -> orders: 1 orphan/);
      expect(await count()).toBe(0); // nothing half-applied
      expect((await ds.query('SELECT count(*)::int AS n FROM proof_of_deliveries WHERE id = $1', [orphanId]))[0].n).toBe(1); // untouched
    } finally {
      if (orphanId) await ds.query('DELETE FROM proof_of_deliveries WHERE id = $1', [orphanId]);
      if ((await count()) === 0) await migration.up(runner); // always leave the schema as migrated
      await runner.release();
    }
  });
});
