import { UploadsService } from './uploads.service';

interface MockUploadsQueryBuilder {
  where: jest.Mock<MockUploadsQueryBuilder, [string, any]>;
  andWhere: jest.Mock<MockUploadsQueryBuilder, [string, any]>;
  getMany: jest.Mock<Promise<any[]>, []>;
}

function buildMockRepo(initial: Array<any> = []) {
  const rows = [...initial];
  return {
    create: jest.fn((data: any) => ({ id: `new-${rows.length}`, ...data })),
    save: jest.fn(async (row: any) => {
      rows.push(row);
      return row;
    }),
    createQueryBuilder: jest.fn((): MockUploadsQueryBuilder => {
      let whereUrls: string[] = [];
      let uploadedByUserId: string | undefined;
      const qb: MockUploadsQueryBuilder = {
        where: jest.fn((_sql: string, params: any) => {
          whereUrls = params.urls;
          return qb;
        }),
        andWhere: jest.fn((_sql: string, params: any) => {
          uploadedByUserId = params.uploadedByUserId;
          return qb;
        }),
        getMany: jest.fn(async () =>
          rows.filter((r) => whereUrls.includes(r.url) && r.uploadedByUserId === uploadedByUserId),
        ),
      };
      return qb;
    }),
  };
}

describe('UploadsService', () => {
  it('upload() persists a row using whatever URL the provider returns', async () => {
    const repo = buildMockRepo();
    const provider = { store: jest.fn(async () => ({ url: 'stub-upload://abc/photo.png' })) };
    const service = new UploadsService(repo as any, provider as any);

    const result = await service.upload('base64...', 'photo.png', 'user-1');

    expect(provider.store).toHaveBeenCalledWith({ base64Content: 'base64...', filename: 'photo.png' });
    expect(result.url).toBe('stub-upload://abc/photo.png');
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('findOwnedUrls returns only URLs that exist AND belong to the given user', async () => {
    const repo = buildMockRepo([
      { url: 'stub-upload://a', uploadedByUserId: 'user-1' },
      { url: 'stub-upload://b', uploadedByUserId: 'user-2' }, // different owner
    ]);
    const provider = { store: jest.fn() };
    const service = new UploadsService(repo as any, provider as any);

    const owned = await service.findOwnedUrls(['stub-upload://a', 'stub-upload://b', 'stub-upload://c'], 'user-1');

    expect(owned).toEqual(new Set(['stub-upload://a']));
  });

  it('findOwnedUrls returns an empty set for an empty input without querying', async () => {
    const repo = buildMockRepo();
    const service = new UploadsService(repo as any, { store: jest.fn() } as any);

    const owned = await service.findOwnedUrls([], 'user-1');

    expect(owned.size).toBe(0);
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
  });
});
