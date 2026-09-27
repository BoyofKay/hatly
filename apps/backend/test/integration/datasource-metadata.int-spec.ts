import { DataSource } from 'typeorm';
import { entityClassNamesOnDisk } from './support/entity-files';

/**
 * Real TypeORM DataSource + real PostgreSQL. This is the check that
 * unit tests structurally cannot do: TypeORM only validates column
 * types (e.g. "Data type Object is not supported by postgres") when a
 * DataSource actually builds metadata.
 */
describe('Real DataSource initialization and entity metadata', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    const { AppDataSource } = await import('../../src/database/data-source');
    dataSource = AppDataSource;
    if (!dataSource.isInitialized) await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('initializes against the real PostgreSQL integration database and answers queries', async () => {
    expect(dataSource.isInitialized).toBe(true);
    const [row] = await dataSource.query('SELECT current_database() AS db, version() AS version');
    expect(row.db).toBe('hatly_integration_test');
    expect(row.version).toMatch(/PostgreSQL 16/);
  });

  it('registers EVERY @Entity class in the repository (CLI DataSource can never drift behind the app again)', () => {
    const registered = dataSource.entityMetadatas.map((m) => m.targetName).sort();
    expect(registered).toEqual(entityClassNamesOnDisk());
    expect(registered.length).toBeGreaterThanOrEqual(47);
  });

  it('has no column whose type TypeORM inferred as unsupported "Object" (e.g. `string | null` without an explicit type)', () => {
    const offenders = dataSource.entityMetadatas.flatMap((m) =>
      m.columns
        .filter((c) => (c.type as unknown) === Object || (c.type as unknown) === 'Object')
        .map((c) => `${m.targetName}.${c.propertyName}`),
    );
    expect(offenders).toEqual([]);
  });

  it('every nullable/union UUID-looking FK property (…Id, `string | null`) resolves to the uuid column type', () => {
    const offenders = dataSource.entityMetadatas.flatMap((m) =>
      m.columns
        .filter((c) => /Id$/.test(c.propertyName) && c.isNullable && c.type !== 'uuid' && !c.relationMetadata)
        // non-uuid identifiers are legitimate (e.g. string business keys); list them so a new one is a conscious decision
        .map((c) => `${m.targetName}.${c.propertyName}:${String(c.type)}`),
    );
    // Documented allowlist of nullable *Id columns that are NOT uuid by design — must stay empty unless a reviewer adds one deliberately.
    expect(offenders).toEqual([]);
  });

  it('OrderItemWeightRecord.recordedByUserId (the originally-reported Object-inference defect) is a real uuid column', () => {
    const meta = dataSource.getMetadata('OrderItemWeightRecord');
    const col = meta.findColumnWithPropertyName('recordedByUserId')!;
    expect(col.type).toBe('uuid');
    expect(col.isNullable).toBe(true);
  });
});
