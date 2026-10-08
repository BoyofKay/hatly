import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { SearchAdminOrdersQueryDto } from './search-admin-orders-query.dto';

// Mirrors LoginDto's own spec exactly — the REAL production ValidationPipe config
// (app.setup.ts), not a bespoke class-validator call, since a query DTO with no
// decorator on some property would otherwise pass a raw class-validator check but
// still 400 for real under `forbidNonWhitelisted` (the exact Group 8 regression
// class that spec's own header documents).
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const meta: ArgumentMetadata = { type: 'query', metatype: SearchAdminOrdersQueryDto };

describe('SearchAdminOrdersQueryDto under the production ValidationPipe (M3b, G-04)', () => {
  it('accepts an empty query (every field optional)', async () => {
    await expect(pipe.transform({}, meta)).resolves.toEqual({});
  });

  it('accepts a fully-populated, valid query and coerces page/limit to numbers', async () => {
    const result = await pipe.transform(
      {
        page: '2',
        limit: '10',
        search: 'HT-100234',
        status: 'DELIVERED',
        dateFrom: '2026-01-01T00:00:00.000Z',
        dateTo: '2026-01-31T23:59:59.000Z',
        paymentStatus: 'PAID',
        paymentMethod: 'MANUAL_TRANSFER',
      },
      meta,
    );
    expect(result).toMatchObject({ page: 2, limit: 10, status: 'DELIVERED', paymentStatus: 'PAID', paymentMethod: 'MANUAL_TRANSFER' });
  });

  it.each([
    { page: 0 },
    { page: -1 },
    { page: 'not-a-number' },
    { limit: 0 },
    { limit: -5 },
  ])('rejects an invalid page/limit %j with a 400', async (query) => {
    await expect(pipe.transform(query, meta)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown order status', async () => {
    await expect(pipe.transform({ status: 'NOT_A_REAL_STATUS' }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown payment status', async () => {
    await expect(pipe.transform({ paymentStatus: 'NOT_A_REAL_STATUS' }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown payment method (not one of the real ORDER_PAYMENT_METHODS)', async () => {
    await expect(pipe.transform({ paymentMethod: 'BITCOIN' }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a malformed date', async () => {
    await expect(pipe.transform({ dateFrom: 'not-a-date' }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown/unwhitelisted property (defense against a client-controlled financial value smuggled in)', async () => {
    await expect(pipe.transform({ totalMinor: 100 }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a search string over the max length', async () => {
    await expect(pipe.transform({ search: 'x'.repeat(101) }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });
});
