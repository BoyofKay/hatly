import { DeviceTokensService } from './device-tokens.service';

function buildHarness(seed: { rows?: any[] } = {}) {
  const rows = new Map<string, any>((seed.rows ?? []).map((r) => [r.token, r]));

  const deviceTokensRepository = {
    findOne: jest.fn(async ({ where }: any) => rows.get(where.token) ?? null),
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (entity: any) => {
      rows.set(entity.token, entity);
      return entity;
    }),
    find: jest.fn(async ({ where }: any) =>
      [...rows.values()].filter((r) => r.userId === where.userId && r.isActive === where.isActive),
    ),
    update: jest.fn(async (where: any, patch: any) => {
      // TypeORM's In() FindOperator exposes the array via a `.value`
      // getter in current versions; fall back to the older internal
      // `_value` name defensively, since this test cannot execute
      // against a real installed TypeORM to confirm which applies.
      const tokensToMatch: string[] = where.token?.value ?? where.token?._value ?? [];
      for (const row of rows.values()) {
        if (tokensToMatch.includes(row.token)) Object.assign(row, patch);
      }
    }),
  };

  const service = new DeviceTokensService(deviceTokensRepository as any);
  return { service, rows, deviceTokensRepository };
}

describe('DeviceTokensService', () => {
  it('registers a brand-new token for the authenticated user', async () => {
    const { service, rows } = buildHarness();
    await service.registerToken({ userId: 'user-1', token: 'token-abc', platform: 'android' });
    expect(rows.get('token-abc')).toMatchObject({ userId: 'user-1', platform: 'android', isActive: true });
  });

  it('re-registering the SAME token upserts (updates userId/platform, reactivates) rather than creating a duplicate row', async () => {
    const { service, rows, deviceTokensRepository } = buildHarness({
      rows: [{ token: 'token-abc', userId: 'user-1', platform: 'android', isActive: false }],
    });
    await service.registerToken({ userId: 'user-1', token: 'token-abc', platform: 'ios' });
    expect(deviceTokensRepository.create).not.toHaveBeenCalled();
    expect(rows.get('token-abc')).toMatchObject({ platform: 'ios', isActive: true });
    expect(rows.size).toBe(1);
  });

  it('CRITICAL: re-registering a token that was stale-associated with another user corrects ownership to the new authenticated caller', async () => {
    const { service, rows } = buildHarness({
      rows: [{ token: 'token-abc', userId: 'stale-user', platform: 'android', isActive: true }],
    });
    await service.registerToken({ userId: 'user-2', token: 'token-abc', platform: 'android' });
    expect(rows.get('token-abc').userId).toBe('user-2');
  });

  it('getActiveTokensForUser returns only active tokens for that exact user', async () => {
    const { service } = buildHarness({
      rows: [
        { token: 't1', userId: 'user-1', isActive: true },
        { token: 't2', userId: 'user-1', isActive: false },
        { token: 't3', userId: 'user-2', isActive: true },
      ],
    });
    const tokens = await service.getActiveTokensForUser('user-1');
    expect(tokens).toEqual(['t1']);
  });

  it('deactivateTokens is a no-op for an empty list', async () => {
    const { service, deviceTokensRepository } = buildHarness();
    await service.deactivateTokens([]);
    expect(deviceTokensRepository.update).not.toHaveBeenCalled();
  });

  it('CRITICAL: deactivateTokens only touches the specific tokens given, never every token for a user', async () => {
    const { service, rows } = buildHarness({
      rows: [
        { token: 'bad-token', userId: 'user-1', isActive: true },
        { token: 'good-token', userId: 'user-1', isActive: true },
      ],
    });
    await service.deactivateTokens(['bad-token']);
    expect(rows.get('bad-token').isActive).toBe(false);
    expect(rows.get('good-token').isActive).toBe(true);
  });
});
