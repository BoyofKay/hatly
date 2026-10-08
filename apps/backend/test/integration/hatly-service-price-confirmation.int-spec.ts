import { DataSource } from 'typeorm';
import { TestData } from './support/test-data';
import { resetAndMigrate } from './support/db';
import { Role } from '../../src/common/enums/role.enum';
import { HatlyServicePriceConfirmation1700004900000 } from '../../src/database/migrations/1700004900000-HatlyServicePriceConfirmation';

/**
 * Real PostgreSQL: the price-confirmation migration lets Hatly operations (`ADMIN`) be a price recorder, keeps every other role
 * rule, keeps the one-record-per-item guarantee, and refuses to revert while operations-confirmed prices exist.
 */
describe('Hatly Service price confirmation — schema (real PostgreSQL)', () => {
  let ds: DataSource;
  let data: TestData;
  const migration = new HatlyServicePriceConfirmation1700004900000();

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
    try {
      if (ds?.isInitialized) await resetAndMigrate(ds); // this spec reverts a migration: always leave the shared schema fully migrated
    } finally {
      if (ds?.isInitialized) await ds.destroy();
    }
  });

  async function itemId(): Promise<{ id: string; adminId: string }> {
    const customer = await data.user();
    const admin = await data.user({ role: Role.ADMIN });
    const branch = await data.vendorBranch();
    const order = await data.order(customer.id);
    const segment = await data.segment(order.id, branch.id);
    return { id: (await data.item(segment.id)).id, adminId: admin.id };
  }
  const insert = (orderItemId: string, role: string, userId: string | null) =>
    ds.query(`INSERT INTO ad_hoc_purchase_records (order_item_id, amount_minor, recorded_by_role, recorded_by_user_id) VALUES ($1, 12500, $2, $3)`, [orderItemId, role, userId]);

  it('accepts an ADMIN record with the confirming user, still rejects any other role, and still allows ONE record per item', async () => {
    const { id, adminId } = await itemId();
    await expect(insert(id, 'ROOT', adminId)).rejects.toMatchObject({ code: '23514', constraint: 'chk_ad_hoc_purchase_record_recorder_role' });
    await insert(id, 'ADMIN', adminId);
    const [row] = await ds.query('SELECT recorded_by_role, recorded_by_user_id, recorded_by_driver_id FROM ad_hoc_purchase_records WHERE order_item_id = $1', [id]);
    expect(row).toEqual({ recorded_by_role: 'ADMIN', recorded_by_user_id: adminId, recorded_by_driver_id: null });
    await expect(insert(id, 'ADMIN', adminId)).rejects.toMatchObject({ code: '23505' }); // a price is recorded once, ever
    await ds.query('DELETE FROM ad_hoc_purchase_records WHERE order_item_id = $1', [id]);
  });

  it('down() refuses to revert while operations-confirmed prices exist, and reverts cleanly (DRIVER/VENDOR only) once none do; up() restores it', async () => {
    const runner = ds.createQueryRunner();
    await runner.connect();
    try {
      const { id, adminId } = await itemId();
      await insert(id, 'ADMIN', adminId);
      await expect(migration.down(runner)).rejects.toThrow(/Refusing to revert: 1 price confirmation/);
      await ds.query('DELETE FROM ad_hoc_purchase_records WHERE order_item_id = $1', [id]);

      await migration.down(runner);
      const second = await itemId();
      await expect(insert(second.id, 'ADMIN', second.adminId)).rejects.toMatchObject({ code: '23514' });
      await migration.up(runner);
      await insert(second.id, 'ADMIN', second.adminId);
      await ds.query('DELETE FROM ad_hoc_purchase_records WHERE order_item_id = $1', [second.id]);
    } finally {
      await runner.release();
    }
  });
});
