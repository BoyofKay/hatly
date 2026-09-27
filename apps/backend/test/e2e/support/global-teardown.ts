import * as fs from 'fs';
import { applyE2eEnv, e2eEnv } from './config';

/**
 * Leaves no E2E residue behind: the disposable database is emptied (schema dropped and recreated,
 * so the next run — or anyone inspecting it — finds nothing), the dedicated Redis logical database
 * is flushed, and the temp uploads directory is removed. Never touches any other database or Redis db.
 */
export default async function globalTeardown(): Promise<void> {
  applyE2eEnv();
  const { AppDataSource } = await import('../../../src/database/data-source');
  const { E2E_DB_NAME, E2E_REDIS_DB, E2E_REDIS_URL } = await import('./config');
  const Redis = (await import('ioredis')).default;

  await AppDataSource.initialize();
  try {
    const [{ current_database }] = await AppDataSource.query('SELECT current_database()');
    if (current_database !== E2E_DB_NAME) throw new Error(`Refusing to clean unexpected database "${current_database}".`);
    await AppDataSource.query('DROP SCHEMA IF EXISTS public CASCADE');
    await AppDataSource.query('CREATE SCHEMA public');
  } finally {
    await AppDataSource.destroy();
  }

  const redis = new Redis(E2E_REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    if (redis.options.db !== E2E_REDIS_DB) throw new Error('Refusing to flush a non-dedicated Redis database.');
    await redis.flushdb();
  } finally {
    if (redis.status === 'ready') await redis.quit();
    else redis.disconnect();
  }
  fs.rmSync(e2eEnv().UPLOADS_LOCAL_DIR, { recursive: true, force: true });
}
