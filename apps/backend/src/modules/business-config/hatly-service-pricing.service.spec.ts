import { HatlyServicePricingService } from './hatly-service-pricing.service';

function buildMockRepo(initial: Array<any> = []) {
  const rows = [...initial];
  return {
    find: jest.fn(async () => [...rows].sort((a, b) => b.createdAt - a.createdAt).slice(0, 1)),
    create: jest.fn((data: any) => ({ id: `new-${rows.length}`, isActive: false, createdAt: rows.length, ...data })),
    save: jest.fn(async (row: any) => {
      const index = rows.findIndex((r) => r.id === row.id);
      if (index >= 0) rows[index] = row;
      else rows.push(row);
      return row;
    }),
  };
}

describe('HatlyServicePricingService', () => {
  it('getCurrent returns null when no config has ever been saved', async () => {
    const service = new HatlyServicePricingService(buildMockRepo() as any);
    await expect(service.getCurrent()).resolves.toBeNull();
  });

  it('upsert creates the first row when none exists', async () => {
    const repo = buildMockRepo();
    const service = new HatlyServicePricingService(repo as any);

    const result = await service.upsert({ rule: 'placeholder' }, 'admin-1');

    expect(result.config).toEqual({ rule: 'placeholder' });
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('upsert updates the existing row on a second call rather than creating a second one', async () => {
    const repo = buildMockRepo();
    const service = new HatlyServicePricingService(repo as any);

    await service.upsert({ rule: 'first' }, 'admin-1');
    await service.upsert({ rule: 'second' }, 'admin-1', true);

    expect(repo.create).toHaveBeenCalledTimes(1); // only the first call created a row
    const current = await service.getCurrent();
    expect(current?.config).toEqual({ rule: 'second' });
    expect(current?.isActive).toBe(true);
  });
});
