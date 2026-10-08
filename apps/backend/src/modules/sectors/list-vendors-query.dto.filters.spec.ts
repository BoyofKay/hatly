import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ListVendorsQueryDto } from './marketplace-vendors.controller';

/**
 * Filters V1 — DTO validation for the new Vendor List query params
 * (`openNow`, `hasOffers`, `minRating`), under the SAME real
 * production `ValidationPipe` config every other DTO-under-pipe spec
 * in this codebase uses (mirrors `LoginDto`'s own spec exactly).
 */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const meta: ArgumentMetadata = { type: 'query', metatype: ListVendorsQueryDto };
const validSectorId = randomUUID();

describe('ListVendorsQueryDto (Filters V1 additions) under the production ValidationPipe', () => {
  it('accepts openNow/hasOffers as query-string booleans, transformed to real booleans', async () => {
    const result = await pipe.transform({ sectorId: validSectorId, openNow: 'true', hasOffers: 'false' }, meta);
    expect(result.openNow).toBe(true);
    expect(result.hasOffers).toBe(false);
  });

  it.each(['true', 'false'])('accepts openNow=%s', async (value) => {
    const result = await pipe.transform({ sectorId: validSectorId, openNow: value }, meta);
    expect(result.openNow).toBe(value === 'true');
  });

  it('rejects a non-boolean openNow value', async () => {
    await expect(
      pipe.transform({ sectorId: validSectorId, openNow: 'maybe' }, meta),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts minRating within 0..5, transformed to a number', async () => {
    const result = await pipe.transform({ sectorId: validSectorId, minRating: '4' }, meta);
    expect(result.minRating).toBe(4);
  });

  it.each([{ minRating: '-1' }, { minRating: '5.5' }, { minRating: '6' }, { minRating: 'four' }])(
    'rejects an out-of-range or non-numeric minRating %j',
    async (extra) => {
      await expect(
        pipe.transform({ sectorId: validSectorId, ...extra }, meta),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('accepts sort=offers alongside the pre-existing sort values', async () => {
    const result = await pipe.transform({ sectorId: validSectorId, sort: 'offers' }, meta);
    expect(result.sort).toBe('offers');
  });

  it('omitting every Filters V1 field is still valid — fully backward compatible', async () => {
    await expect(pipe.transform({ sectorId: validSectorId }, meta)).resolves.toMatchObject({ sectorId: validSectorId });
  });
});
