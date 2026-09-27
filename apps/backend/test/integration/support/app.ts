import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module';
import { configureApp } from '../../../src/app.setup';
import { REDIS_CLIENT } from '../../../src/common/redis/redis.constants';
import { createRedisClient } from '../../../src/common/redis/redis-client.factory';

export interface IntegrationAppOptions {
  /** Point the application's shared REDIS_CLIENT somewhere else (still built by the production factory). */
  redisUrl?: string;
  /** Actually bind a TCP port (ephemeral) so requests can go over a real socket. */
  listen?: boolean;
}

/**
 * Boots the REAL `AppModule` — real TypeORM DataSource against the
 * isolated PostgreSQL database, real shared Redis client, real global
 * guards/filters/interceptors/middleware — configured through the very
 * same `configureApp()` production `main.ts` uses. Only the environment
 * (see support/config.ts) differs from production, and it deliberately
 * leaves every external provider (Unifonic SMS, FCM push, Google Maps)
 * unconfigured, so nothing external can ever be called.
 */
export async function createIntegrationApp(options: IntegrationAppOptions = {}): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.redisUrl) {
    const redisUrl = options.redisUrl;
    builder = builder.overrideProvider(REDIS_CLIENT).useFactory({ factory: () => createRedisClient(redisUrl) });
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  if (options.listen) await app.listen(0);
  return app;
}
