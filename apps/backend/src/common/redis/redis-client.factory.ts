import { Logger } from '@nestjs/common';
import Redis from 'ioredis';

const REDIS_MAX_RETRIES_PER_REQUEST = 3;

/**
 * Constructs the single shared Redis client for the whole backend and
 * attaches the one required safety net: an `error` listener. Without
 * one, a Redis connection error becomes an unhandled EventEmitter
 * `error` event — which throws and can crash the whole process, not
 * just whatever feature happened to be using Redis. Previously four
 * independent clients (OtpService, RefreshTokenStore,
 * GoogleMapsProvider, DeliveryAssignmentService) each opened their own
 * connection with no such listener. Only the error message is logged —
 * never `url`, which may embed credentials.
 */
export function createRedisClient(url: string): Redis {
  const logger = new Logger('RedisClient');
  // ioredis' default (20 retries per command, with growing backoff)
  // makes every Redis-backed request hang for ~10 seconds during an
  // outage before failing — measured against a real unreachable Redis
  // by the integration suite (an OTP request took 10.5s to fail). Three
  // retries (~0.3s) still ride out a brief reconnect blip but fail
  // fast enough that a Redis outage cannot pile up hung requests.
  const client = new Redis(url, { maxRetriesPerRequest: REDIS_MAX_RETRIES_PER_REQUEST });
  client.on('error', (error: Error) => {
    logger.error(`Redis connection error: ${error.message}`);
  });
  return client;
}
