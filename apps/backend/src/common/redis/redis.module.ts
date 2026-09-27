import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { REDIS_CLIENT } from './redis.constants';
import { createRedisClient } from './redis-client.factory';
import { RedisLifecycle } from './redis-lifecycle';

/**
 * Single shared ioredis client for the whole backend. Previously four
 * independent services — OtpService, RefreshTokenStore,
 * GoogleMapsProvider, DeliveryAssignmentService — each constructed
 * their own `new Redis(...)` against the identical `redis.url`, none
 * with an `error` listener. All four usages are plain GET/SET/DEL/
 * SET-NX commands (confirmed by inspection) — no Pub/Sub, blocking
 * commands, or MULTI/WATCH transactions anywhere in this codebase — so
 * one shared connection is safe.
 *
 * `@Global()` so every feature module can `@Inject(REDIS_CLIENT)`
 * without re-importing this module, matching
 * `ConfigModule.forRoot({ isGlobal: true })`'s own convention in
 * app.module.ts.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => createRedisClient(configService.get<string>('redis.url')!),
    },
    RedisLifecycle,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
