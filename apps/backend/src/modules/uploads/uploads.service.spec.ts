import { BadRequestException } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { JPEG_BYTES, PNG_1X1_BASE64 } from './image-test-fixtures';

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
  it('upload() persists a row using whatever URL the provider returns (a valid image; the stored extension comes from the BYTES)', async () => {
    const repo = buildMockRepo();
    const provider = { store: jest.fn(async () => ({ url: 'stub-upload://abc/photo.png' })) };
    const service = new UploadsService(repo as any, provider as any);

    const result = await service.upload(PNG_1X1_BASE64, 'photo.png', 'user-1');

    expect(provider.store).toHaveBeenCalledWith({ base64Content: PNG_1X1_BASE64, filename: 'upload.png' });
    expect(result.url).toBe('stub-upload://abc/photo.png');
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('the client filename can NOT influence what is stored: a JPEG named "evil.html" / "../../x.png" is stored as upload.jpg', async () => {
    const repo = buildMockRepo();
    const provider = { store: jest.fn(async () => ({ url: '/uploads/files/x.jpg' })) };
    const service = new UploadsService(repo as any, provider as any);

    for (const filename of ['evil.html', '../../etc/passwd.png', 'a\0.png', 'x.svg', '']) {
      await service.upload(JPEG_BYTES.toString('base64'), filename, 'user-1');
    }
    for (const call of provider.store.mock.calls as any[]) expect(call[0].filename).toBe('upload.jpg');
  });

  it('rejects a non-image / oversized / malformed upload with a 400 and a stable code, BEFORE anything reaches storage or the database', async () => {
    const repo = buildMockRepo();
    const provider = { store: jest.fn() };
    const service = new UploadsService(repo as any, provider as any);
    const cases: Array<[string, string]> = [
      [Buffer.from('<html></html>............').toString('base64'), 'UNSUPPORTED_IMAGE_TYPE'],
      ['%%%not-base64%%%', 'UPLOAD_NOT_BASE64'],
      ['A'.repeat(8_000_000), 'UPLOAD_TOO_LARGE'],
    ];
    for (const [content, expected] of cases) {
      const error: any = await service.upload(content, 'photo.png', 'user-1').catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse().details.code).toBe(expected);
    }
    expect(provider.store).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
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
