import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

/**
 * Closes the shared Redis client when the Nest application shuts down.
 * Without this the connection (and its reconnect timers) outlives
 * `app.close()`: a graceful SIGTERM shutdown leaves an open socket
 * behind and any process/test harness waiting for the event loop to
 * drain never exits — found by the real-runtime integration suite, which
 * hung after `app.close()`.
 *
 * A healthy connection is closed with QUIT (lets in-flight commands
 * finish). A connection that is not ready (Redis down/reconnecting)
 * would queue QUIT forever behind the offline queue, so it is
 * disconnected immediately instead — shutdown must never hang on Redis.
 */
@Injectable()
export class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'ready') {
      try {
        await this.redis.quit();
        return;
      } catch {
        // fall through to a hard disconnect
      }
    }
    this.redis.disconnect();
  }
}
