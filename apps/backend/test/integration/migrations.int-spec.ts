import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { resetAndMigrate } from './support/db';
import { TestData } from './support/test-data';
import { foreignKeyFixtures } from './support/fk-fixtures';
import { ADDED_FOREIGN_KEYS } from './support/referential-integrity';
import { LedgerReferentialIntegrity1700003800000 } from '../../src/database/migrations/1700003800000-LedgerReferentialIntegrity';
import { VendorCategoryLegacyNullable1700003900000 } from '../../src/database/migrations/1700003900000-VendorCategoryLegacyNullable';

/**
 * Starts from a genuinely empty schema and applies every real
 * migration through TypeORM's own migration mechanism (never
 * `synchronize`), then re-initializes the real DataSource against the
 * resulting schema.
 */
describe('Real migrations on a clean PostgreSQL database', () => {
  let dataSource: DataSource;
  const migrationFiles = fs
    .readdirSync(path.join(__dirname, '..', '..', 'src', 'database', 'migrations'))
    .filter((f) => f.endsWith('.ts'))
    .sort();

  beforeAll(async () => {
    const { AppDataSource } = await import('../../src/database/data-source');
    dataSource = AppDataSource;
    if (!dataSource.isInitialized) await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('the schema really is empty before migrating, then every migration applies successfully and in order', async () => {
    await dataSource.query('DROP SCHEMA IF EXISTS public CASCADE');
    await dataSource.query('CREATE SCHEMA public');
    const tablesBefore = await dataSource.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'",
    );
    expect(tablesBefore[0].n).toBe(0);

    const applied = await dataSource.runMigrations({ transaction: 'each' });

    expect(applied).toHaveLength(migrationFiles.length);
    expect(migrationFiles.length).toBeGreaterThanOrEqual(38);
    // Names embed a strictly increasing timestamp — applied order must equal that order.
    const timestamps = applied.map((m) => m.timestamp);
    expect([...timestamps].sort((a, b) => a - b)).toEqual(timestamps);
    expect(applied.map((m) => m.name)).toEqual(
      migrationFiles.map((f) => {
        const [ts, ...rest] = f.replace(/\.ts$/, '').split('-');
        return `${rest.join('-')}${ts}`;
      }),
    );
  });

  it('records exactly those migrations in the migrations table and reports nothing pending', async () => {
    const rows = await dataSource.query('SELECT name FROM migrations ORDER BY id');
    expect(rows).toHaveLength(migrationFiles.length);
    expect(await dataSource.showMigrations()).toBe(false);
  });

  it('re-running migrations is a no-op (idempotent runner)', async () => {
    const again = await dataSource.runMigrations({ transaction: 'each' });
    expect(again).toEqual([]);
  });

  it('the final schema exists and the real DataSource re-initializes cleanly against it', async () => {
    await dataSource.destroy();
    await dataSource.initialize();
    expect(dataSource.isInitialized).toBe(true);
    const tables = await dataSource.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
    );
    const names = tables.map((t: { table_name: string }) => t.table_name);
    for (const meta of dataSource.entityMetadatas) {
      expect(names).toContain(meta.tableName);
    }
  });

  it('leaves the database fully migrated for the specs that follow (helper parity)', async () => {
    expect(await resetAndMigrate(dataSource)).toHaveLength(migrationFiles.length);
  });

  describe('LedgerReferentialIntegrity over a schema that already holds data', () => {
    const migration = new LedgerReferentialIntegrity1700003800000();
    const names = ADDED_FOREIGN_KEYS.map((f) => `fk_${f.table}_${f.column}`);
    const fkCount = async () =>
      (await dataSource.query("SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f' AND conname = ANY($1)", [names]))[0].n;
    let data: TestData;
    const tables = [...new Set(ADDED_FOREIGN_KEYS.map((f) => f.table))];

    beforeAll(async () => {
      await resetAndMigrate(dataSource);
      data = new TestData(dataSource);
    });

    it('down() removes exactly its constraints; up() re-adds them all, validated, over EXISTING valid historical rows in every affected table', async () => {
      const { validProps } = foreignKeyFixtures(() => dataSource, () => data);
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      try {
        expect(await fkCount()).toBe(ADDED_FOREIGN_KEYS.length);
        await migration.down(runner);
        expect(await fkCount()).toBe(0);

        // Valid history written while the constraints are absent (as it would have been in a live database).
        const ids: Record<string, string> = {};
        for (const table of tables) {
          const target = dataSource.entityMetadatas.find((m) => m.tableName === table)!.target;
          ids[table] = ((await data.save<{ id: string }>(target as never, (await validProps(table)) as never)) as { id: string }).id;
        }

        await migration.up(runner); // must succeed without touching any row
        expect(await fkCount()).toBe(ADDED_FOREIGN_KEYS.length);
        const notValidated = await dataSource.query("SELECT conname FROM pg_constraint WHERE contype = 'f' AND conname = ANY($1) AND NOT convalidated", [names]);
        expect(notValidated).toEqual([]);
        for (const table of tables) {
          expect((await dataSource.query(`SELECT count(*)::int AS n FROM "${table}" WHERE id = $1`, [ids[table]]))[0].n).toBe(1);
        }
      } finally {
        await runner.release();
        await data.dispose();
      }
    });

    it('an orphan row makes up() REFUSE with a clear message — nothing is deleted or altered, and no constraint is half-applied', async () => {
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      const orphanId = data.newId();
      const bogusCustomer = data.newId();
      try {
        await migration.down(runner);
        await dataSource.query(
          `INSERT INTO wallet_transactions (id, customer_id, amount_delta_minor, type, idempotency_key)
           VALUES ($1, $2, 100, 'ADMIN_CREDIT', $3)`,
          [orphanId, bogusCustomer, `orphan-${orphanId}`],
        );

        await expect(migration.up(runner)).rejects.toThrow(/Refusing to add foreign keys.*wallet_transactions\.customer_id -> users: 1 orphan row/);

        expect(await fkCount()).toBe(0); // pre-check runs before any ALTER: no partial state
        const [orphan] = await dataSource.query('SELECT customer_id FROM wallet_transactions WHERE id = $1', [orphanId]);
        expect(orphan.customer_id).toBe(bogusCustomer); // the offending row was left exactly as it was
      } finally {
        await dataSource.query('DELETE FROM wallet_transactions WHERE id = $1', [orphanId]); // test cleanup only
        await migration.up(runner);
        await runner.release();
      }
      expect(await fkCount()).toBe(ADDED_FOREIGN_KEYS.length);
    });
  });

  describe('VendorCategoryLegacyNullable (Group 8: POST /admin/vendors was a 500)', () => {
    const migration = new VendorCategoryLegacyNullable1700003900000();
    const categoryNullable = async () =>
      (await dataSource.query("SELECT is_nullable FROM information_schema.columns WHERE table_name = 'vendors' AND column_name = 'category'"))[0].is_nullable;

    beforeAll(async () => {
      await resetAndMigrate(dataSource);
    });

    it('after migrating, a Vendor row can be inserted the way AdminVendorsService does — without a category', async () => {
      expect(await categoryNullable()).toBe('YES');
      const [row] = await dataSource.query("INSERT INTO vendors (name, is_active) VALUES ('No Category Vendor', false) RETURNING id, category");
      expect(row.category).toBeNull();
      await dataSource.query('DELETE FROM vendors WHERE id = $1', [row.id]);
    });

    it('down() restores NOT NULL (back-filling NULLs with the empty string so the revert cannot fail); up() makes it nullable again without touching data', async () => {
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      try {
        const [nullRow] = await dataSource.query("INSERT INTO vendors (name) VALUES ('Null Category') RETURNING id");
        const [keptRow] = await dataSource.query("INSERT INTO vendors (name, category) VALUES ('Has Category', 'legacy-cafe') RETURNING id");
        await migration.down(runner);
        expect(await categoryNullable()).toBe('NO');
        expect((await dataSource.query('SELECT category FROM vendors WHERE id = $1', [nullRow.id]))[0].category).toBe('');
        expect((await dataSource.query('SELECT category FROM vendors WHERE id = $1', [keptRow.id]))[0].category).toBe('legacy-cafe');
        await migration.up(runner);
        expect(await categoryNullable()).toBe('YES');
        expect((await dataSource.query('SELECT category FROM vendors WHERE id = $1', [keptRow.id]))[0].category).toBe('legacy-cafe'); // existing values are kept
        await dataSource.query('DELETE FROM vendors WHERE id = ANY($1)', [[nullRow.id, keptRow.id]]);
      } finally {
        await runner.release();
      }
    });
  });
});
