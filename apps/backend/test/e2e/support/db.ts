import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { assertIsolatedInfrastructure, E2E_DB_NAME, E2E_REDIS_DB, E2E_REDIS_URL } from './config';

/** Empties the dedicated E2E database and re-runs every real migration (seed rows included), and flushes the dedicated Redis db. */
export async function resetE2eInfrastructure(): Promise<void> {
  assertIsolatedInfrastructure();
  const { AppDataSource } = await import('../../../src/database/data-source');
  const ds: DataSource = AppDataSource;
  if (!ds.isInitialized) await ds.initialize();
  try {
    const [{ current_database }] = await ds.query('SELECT current_database()');
    if (current_database !== E2E_DB_NAME) throw new Error(`Connected to unexpected database "${current_database}".`);
    await ds.query('DROP SCHEMA IF EXISTS public CASCADE');
    await ds.query('CREATE SCHEMA public');
    await ds.runMigrations({ transaction: 'each' });
  } finally {
    await ds.destroy();
  }
  const redis = new Redis(E2E_REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    if (redis.options.db !== E2E_REDIS_DB) throw new Error('Refusing to flush a non-dedicated Redis database.');
    await redis.flushdb();
  } finally {
    // quit() (not disconnect()): ioredis' disconnect() leaves a 2s ref'd timer that delays process exit.
    if (redis.status === 'ready') await redis.quit();
    else redis.disconnect();
  }
}
