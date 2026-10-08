import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { ListProductsQueryDto } from './products.controller';

/**
 * Filters V1 — DTO validation for the new Product List query params
 * (`availableOnly`, `hasOffers`, `minPriceMinor`, `maxPriceMinor`),
 * under the SAME real production `ValidationPipe` config every other
 * DTO-under-pipe spec in this codebase uses.
 */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const meta: ArgumentMetadata = { type: 'query', metatype: ListProductsQueryDto };

describe('ListProductsQueryDto (Filters V1 additions) under the production ValidationPipe', () => {
  it('accepts availableOnly/hasOffers as query-string booleans, transformed to real booleans', async () => {
    const result = await pipe.transform({ availableOnly: 'true', hasOffers: 'false' }, meta);
    expect(result.availableOnly).toBe(true);
    expect(result.hasOffers).toBe(false);
  });

  it('rejects a non-boolean availableOnly value', async () => {
    await expect(pipe.transform({ availableOnly: 'yes' }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts minPriceMinor/maxPriceMinor as non-negative integers', async () => {
    const result = await pipe.transform({ minPriceMinor: '100', maxPriceMinor: '5000' }, meta);
    expect(result.minPriceMinor).toBe(100);
    expect(result.maxPriceMinor).toBe(5000);
  });

  it.each([{ minPriceMinor: '-1' }, { minPriceMinor: '1.5' }, { maxPriceMinor: '-1' }, { minPriceMinor: 'free' }])(
    'rejects an invalid price bound %j',
    async (extra) => {
      await expect(pipe.transform({ ...extra }, meta)).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('accepts sort=offers alongside the pre-existing sort values', async () => {
    const result = await pipe.transform({ sort: 'offers' }, meta);
    expect(result.sort).toBe('offers');
  });

  it('omitting every Filters V1 field is still valid — fully backward compatible', async () => {
    await expect(pipe.transform({}, meta)).resolves.toEqual({});
  });
});
