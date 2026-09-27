import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * No imports needed: `DataSource` (from TypeOrmModule.forRootAsync in
 * app.module.ts) and `REDIS_CLIENT` (from the @Global() RedisModule,
 * Group 1) are both already resolvable app-wide.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
