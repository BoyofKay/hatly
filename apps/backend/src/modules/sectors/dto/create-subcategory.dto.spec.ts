import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateSubcategoryDto } from './create-subcategory.dto';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const meta: ArgumentMetadata = { type: 'body', metatype: CreateSubcategoryDto };
const validSectorId = randomUUID();

describe('CreateSubcategoryDto under the production ValidationPipe', () => {
  it('accepts a minimal valid payload (sectorId + name only)', async () => {
    await expect(pipe.transform({ sectorId: validSectorId, name: 'Burgers' }, meta)).resolves.toMatchObject({
      sectorId: validSectorId,
      name: 'Burgers',
    });
  });

  it('accepts the full optional field set', async () => {
    await expect(
      pipe.transform(
        {
          sectorId: validSectorId,
          name: 'Burgers',
          nameAr: 'برجر',
          imageUrl: 'https://cdn.hatly.example/subcategories/burgers.png',
          sortOrder: 3,
          isActive: false,
        },
        meta,
      ),
    ).resolves.toMatchObject({ nameAr: 'برجر', sortOrder: 3, isActive: false });
  });

  it.each([
    {},
    { sectorId: validSectorId },
    { name: 'Burgers' },
    { sectorId: 'not-a-uuid', name: 'Burgers' },
    { sectorId: validSectorId, name: 123 },
    { sectorId: validSectorId, name: 'x'.repeat(101) },
    { sectorId: validSectorId, name: 'Burgers', sortOrder: -1 },
    { sectorId: validSectorId, name: 'Burgers', sortOrder: 'first' },
    { sectorId: validSectorId, name: 'Burgers', isActive: 'yes' },
  ])('rejects %j with a 400', async (body) => {
    await expect(pipe.transform(body, meta)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown properties', async () => {
    await expect(
      pipe.transform({ sectorId: validSectorId, name: 'Burgers', slug: 'burgers' }, meta),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
