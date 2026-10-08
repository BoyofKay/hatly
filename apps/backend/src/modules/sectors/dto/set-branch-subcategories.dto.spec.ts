import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SetBranchSubcategoriesDto } from './set-branch-subcategories.dto';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const meta: ArgumentMetadata = { type: 'body', metatype: SetBranchSubcategoriesDto };
const id1 = randomUUID();
const id2 = randomUUID();

describe('SetBranchSubcategoriesDto under the production ValidationPipe', () => {
  it('accepts an empty array — a valid way to clear every assignment', async () => {
    await expect(pipe.transform({ subcategoryIds: [] }, meta)).resolves.toEqual({ subcategoryIds: [] });
  });

  it('accepts a list of valid UUIDs', async () => {
    await expect(pipe.transform({ subcategoryIds: [id1, id2] }, meta)).resolves.toEqual({ subcategoryIds: [id1, id2] });
  });

  it.each([
    {},
    { subcategoryIds: 'not-an-array' },
    { subcategoryIds: ['not-a-uuid'] },
    { subcategoryIds: [id1, id1] }, // ArrayUnique
    { subcategoryIds: Array.from({ length: 21 }, () => randomUUID()) }, // ArrayMaxSize(20)
  ])('rejects %j with a 400', async (body) => {
    await expect(pipe.transform(body, meta)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown properties', async () => {
    await expect(pipe.transform({ subcategoryIds: [id1], extra: true }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });
});
