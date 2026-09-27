import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';

export type DependencyStatus = 'up' | 'down';

export interface ReadinessResult {
  status: 'ok' | 'degraded';
  checks: {
    database: DependencyStatus;
    redis: DependencyStatus;
  };
}

const CHECK_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Dependency check timed out.')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Backend readiness checks (Group 2 — Production Health & Readiness).
 * Deliberately hand-rolled rather than @nestjs/terminus: the two checks
 * needed are each a single, trivial, read-only operation against
 * infrastructure this backend already manages — the shared TypeORM
 * DataSource and the shared REDIS_CLIENT from Group 1 (Redis
 * reliability hardening) — never a second Redis/DB connection.
 *
 * Every result is reduced to a plain 'up'/'down' before it ever leaves
 * this class — no error message, stack trace, hostname, or connection
 * string is retained (see HealthController for the HTTP-facing
 * contract, which only ever sees this already-sanitized shape). A
 * hung dependency is treated as 'down' via a bounded timeout, so a
 * Postgres/Redis outage can never make this check itself hang.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async checkReadiness(): Promise<ReadinessResult> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    const status: 'ok' | 'degraded' = database === 'up' && redis === 'up' ? 'ok' : 'degraded';
    return { status, checks: { database, redis } };
  }

  /** Smallest safe read-only connectivity check — no schema/table access, no business data touched. */
  private async checkDatabase(): Promise<DependencyStatus> {
    try {
      await withTimeout(this.dataSource.query('SELECT 1'), CHECK_TIMEOUT_MS);
      return 'up';
    } catch {
      return 'down';
    }
  }

  /** PING is the standard harmless Redis liveness command — never writes or mutates a key. */
  private async checkRedis(): Promise<DependencyStatus> {
    try {
      await withTimeout(this.redis.ping(), CHECK_TIMEOUT_MS);
      return 'up';
    } catch {
      return 'down';
    }
  }
}
