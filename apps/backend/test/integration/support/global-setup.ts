import Redis from 'ioredis';
import { applyIntegrationEnv, INTEGRATION_REDIS_DB, INTEGRATION_REDIS_URL } from './config';

/**
 * Runs once before the whole integration suite: guarantees the
 * dedicated database is clean and fully migrated, and that the
 * dedicated Redis logical database has no leftover test keys.
 */
export default async function globalSetup(): Promise<void> {
  applyIntegrationEnv();
  // Imported only AFTER the environment is applied — AppDataSource reads DATABASE_URL at import time.
  const { AppDataSource } = await import('../../../src/database/data-source');
  const { resetAndMigrate } = await import('./db');
  try {
    await AppDataSource.initialize();
  } catch (error) {
    throw new Error(
      `Cannot reach the integration database. Create it once with "npm run test:integration:setup". Cause: ${(error as Error).message}`,
    );
  }
  try {
    await resetAndMigrate(AppDataSource);
  } finally {
    await AppDataSource.destroy();
  }

  const redis = new Redis(INTEGRATION_REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    // The dedicated logical database belongs to this suite alone, so start it empty: keys left by a crashed/aborted earlier run
    // (e.g. a refresh-token or lock key from a different spec) must not make an order-dependent "database is empty" check fail.
    if (redis.options.db !== INTEGRATION_REDIS_DB) throw new Error('Refusing to flush a non-dedicated Redis database.');
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}
