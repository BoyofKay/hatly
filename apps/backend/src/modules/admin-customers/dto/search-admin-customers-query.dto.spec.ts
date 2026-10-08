import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { SearchAdminCustomersQueryDto } from './search-admin-customers-query.dto';

// Mirrors SearchAdminOrdersQueryDto's own spec exactly — the REAL production ValidationPipe config.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const meta: ArgumentMetadata = { type: 'query', metatype: SearchAdminCustomersQueryDto };

describe('SearchAdminCustomersQueryDto under the production ValidationPipe (M3c, G-10)', () => {
  it('accepts an empty query (every field optional)', async () => {
    await expect(pipe.transform({}, meta)).resolves.toEqual({});
  });

  it('accepts a fully-populated, valid query and coerces page/limit/isActive to real types', async () => {
    const result = await pipe.transform({ page: '2', limit: '10', search: 'Sara', isActive: 'true' }, meta);
    expect(result).toEqual({ page: 2, limit: 10, search: 'Sara', isActive: true });
  });

  it('correctly parses isActive=false as boolean false, never truthy-string true (Boolean("false") === true is the classic JS gotcha this must avoid)', async () => {
    const result = await pipe.transform({ isActive: 'false' }, meta);
    expect(result.isActive).toBe(false);
  });

  it.each([{ page: 0 }, { page: -1 }, { limit: 0 }, { isActive: 'not-a-boolean' }])(
    'rejects an invalid query %j with a 400',
    async (query) => {
      await expect(pipe.transform(query, meta)).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('rejects an unknown/unwhitelisted property', async () => {
    await expect(pipe.transform({ role: 'ADMIN' }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a search string over the max length', async () => {
    await expect(pipe.transform({ search: 'x'.repeat(101) }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });
});
