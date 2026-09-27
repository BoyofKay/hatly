import { HealthService } from './health.service';

function buildService(
  opts: { dbThrows?: boolean; redisThrows?: boolean; dbError?: Error; redisError?: Error } = {},
) {
  const dataSource = {
    query: jest.fn(async () => {
      if (opts.dbThrows) throw opts.dbError ?? new Error('db down');
      return [{ '?column?': 1 }];
    }),
  };
  const redis = {
    ping: jest.fn(async () => {
      if (opts.redisThrows) throw opts.redisError ?? new Error('redis down');
      return 'PONG';
    }),
  };
  const service = new HealthService(dataSource as any, redis as any);
  return { service, dataSource, redis };
}

describe('HealthService.checkReadiness', () => {
  it('reports ok when both Postgres and Redis are reachable', async () => {
    const { service } = buildService();
    const result = await service.checkReadiness();
    expect(result).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  it('reports degraded (not ready) when Postgres is unavailable', async () => {
    const { service } = buildService({ dbThrows: true });
    const result = await service.checkReadiness();
    expect(result).toEqual({ status: 'degraded', checks: { database: 'down', redis: 'up' } });
  });

  it('reports degraded (not ready) when Redis is unavailable', async () => {
    const { service } = buildService({ redisThrows: true });
    const result = await service.checkReadiness();
    expect(result).toEqual({ status: 'degraded', checks: { database: 'up', redis: 'down' } });
  });

  it('reports degraded (not ready) when both Postgres and Redis are unavailable', async () => {
    const { service } = buildService({ dbThrows: true, redisThrows: true });
    const result = await service.checkReadiness();
    expect(result).toEqual({ status: 'degraded', checks: { database: 'down', redis: 'down' } });
  });

  it('CRITICAL: a dependency exception is contained — checkReadiness never throws, it resolves to a degraded result', async () => {
    const { service } = buildService({
      dbThrows: true,
      dbError: new Error('connection to postgres://hatly:s3cr3t@db-primary.internal:5432/hatly_prod failed'),
    });
    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'degraded',
      checks: { database: 'down', redis: 'up' },
    });
  });

  it('never leaks the underlying error message/connection string/credentials into the result', async () => {
    const { service } = buildService({
      dbThrows: true,
      dbError: new Error('postgres://hatly:s3cr3t@db-primary.internal:5432/hatly_prod'),
      redisThrows: true,
      redisError: new Error('redis://:hunter2@redis-primary.internal:6379'),
    });
    const result = await service.checkReadiness();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('s3cr3t');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('db-primary.internal');
    expect(serialized).not.toContain('redis-primary.internal');
  });
});
