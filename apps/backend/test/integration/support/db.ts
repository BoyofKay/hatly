import { DataSource } from 'typeorm';
import { assertIsolatedInfrastructure, databaseNameOf, INTEGRATION_DATABASE_URL } from './config';

/**
 * Drops EVERYTHING in the dedicated integration database's public
 * schema and runs every real migration, in order, via the same
 * `AppDataSource` the TypeORM CLI uses (never `synchronize`).
 * Returns the migrations that were applied.
 */
export async function resetAndMigrate(dataSource: DataSource): Promise<string[]> {
  assertIsolatedInfrastructure();
  const [{ current_database }] = await dataSource.query('SELECT current_database()');
  if (current_database !== databaseNameOf(INTEGRATION_DATABASE_URL)) {
    throw new Error(`Connected to unexpected database "${current_database}".`);
  }
  await dataSource.query('DROP SCHEMA IF EXISTS public CASCADE');
  await dataSource.query('CREATE SCHEMA public');
  const applied = await dataSource.runMigrations({ transaction: 'each' });
  return applied.map((m) => m.name);
}
