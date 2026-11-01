import { BadRequestException, NotFoundException } from '@nestjs/common';
import { HomeBannersService } from './home-banners.service';
import { HomeBannerActionType } from './home-banner-action.enum';

/** Boundary rules that do not need a database (the end-to-end behaviour is proven by test/e2e/108-home-banners). */
describe('HomeBannersService', () => {
  const now = new Date('2026-10-28T12:00:00.000Z');
  const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);

  const make = (over: { found?: any; targetExists?: boolean } = {}) => {
    const repo: any = {
      findOne: jest.fn().mockResolvedValue(over.found ?? null),
      save: jest.fn(async (x: any) => ({ id: 'b1', createdAt: now, updatedAt: now, ...x })),
      create: jest.fn((x: any) => x),
      softRemove: jest.fn(),
    };
    const targets: any = { findOne: jest.fn().mockResolvedValue(over.targetExists === false ? null : { id: 't' }), find: jest.fn().mockResolvedValue([]) };
    const service = new HomeBannersService(repo, targets, targets, targets, { upload: jest.fn() } as any);
    return { service, repo, targets };
  };
  const banner = (over: Record<string, unknown> = {}) => ({
    id: 'b1', title: 'T', titleAr: null, imageUrl: '/uploads/files/x.png', actionType: HomeBannerActionType.NONE, actionTargetId: null,
    sortOrder: 0, isActive: true, startsAt: null, endsAt: null, createdAt: now, updatedAt: now, ...over,
  });

  describe('statusAt — the instant a banner appears and disappears', () => {
    const { service } = make();
    it('is a DRAFT when inactive or without an image, whatever the dates say', () => {
      expect(service.statusAt({ isActive: false, imageUrl: 'x', startsAt: null, endsAt: null }, now)).toBe('DRAFT');
      expect(service.statusAt({ isActive: true, imageUrl: null, startsAt: null, endsAt: null }, now)).toBe('DRAFT');
    });
    it('starts AT startsAt (inclusive) and ends AT endsAt (exclusive)', () => {
      expect(service.statusAt({ isActive: true, imageUrl: 'x', startsAt: at(1), endsAt: null }, now)).toBe('SCHEDULED');
      expect(service.statusAt({ isActive: true, imageUrl: 'x', startsAt: at(0), endsAt: null }, now)).toBe('LIVE');
      expect(service.statusAt({ isActive: true, imageUrl: 'x', startsAt: null, endsAt: at(1) }, now)).toBe('LIVE');
      expect(service.statusAt({ isActive: true, imageUrl: 'x', startsAt: null, endsAt: at(0) }, now)).toBe('EXPIRED');
    });
  });

  describe('writing', () => {
    it('creates an INACTIVE, image-less draft with trimmed text', async () => {
      const { service, repo } = make();
      const created = await service.create({ title: '  Eid sale  ', titleAr: '  عيد  ' });
      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ title: 'Eid sale', titleAr: 'عيد', isActive: false, imageUrl: null, actionType: 'NONE' }));
      expect(created.displayStatus).toBe('DRAFT');
    });

    it('refuses a backwards schedule, an action without a target, a target without an action and an unknown target — nothing is saved', async () => {
      const { service, repo } = make();
      const reason = async (p: Promise<unknown>) => ((await p.catch((e) => e)) as BadRequestException).getResponse() as any;
      expect((await reason(service.create({ title: 'x', startsAt: at(1000).toISOString(), endsAt: at(1000).toISOString() }))).details.code).toBe('BANNER_SCHEDULE_INVALID');
      expect((await reason(service.create({ title: 'x', actionType: HomeBannerActionType.PRODUCT }))).details.code).toBe('BANNER_ACTION_TARGET_REQUIRED');
      expect((await reason(service.create({ title: 'x', actionTargetId: '11111111-1111-4111-8111-111111111111' }))).details.code).toBe('BANNER_ACTION_TARGET_UNEXPECTED');
      const missing = make({ targetExists: false });
      expect((await reason(missing.service.create({ title: 'x', actionType: HomeBannerActionType.SECTOR, actionTargetId: '11111111-1111-4111-8111-111111111111' }))).details.code).toBe('BANNER_ACTION_TARGET_NOT_FOUND');
      expect(repo.save).not.toHaveBeenCalled();
      expect(missing.repo.save).not.toHaveBeenCalled();
    });

    it('activation needs an image; an unknown banner is a 404', async () => {
      const noImage = make({ found: banner({ imageUrl: null, isActive: false }) });
      await expect(noImage.service.activate('b1')).rejects.toMatchObject({ response: { details: { code: 'BANNER_IMAGE_REQUIRED' } } });
      expect(noImage.repo.save).not.toHaveBeenCalled();
      await expect(make().service.activate('missing')).rejects.toBeInstanceOf(NotFoundException);
      const ok = make({ found: banner({ isActive: false }) });
      expect((await ok.service.activate('b1')).isActive).toBe(true);
    });

    it('rejects an unsupported image type and an oversized image before touching storage', async () => {
      const { service } = make({ found: banner() });
      await expect(service.uploadImage('b1', { buffer: Buffer.from('x'), mimetype: 'image/gif', size: 1 }, 'u')).rejects.toMatchObject({ response: { details: { code: 'UNSUPPORTED_IMAGE_TYPE' } } });
      await expect(service.uploadImage('b1', { buffer: Buffer.from('x'), mimetype: 'image/png', size: 5 * 1024 * 1024 + 1 }, 'u')).rejects.toMatchObject({ response: { details: { code: 'IMAGE_TOO_LARGE' } } });
    });
  });
});
