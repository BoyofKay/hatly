import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateSubcategoryDto } from './update-subcategory.dto';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const meta: ArgumentMetadata = { type: 'body', metatype: UpdateSubcategoryDto };

describe('UpdateSubcategoryDto under the production ValidationPipe', () => {
  it('accepts an empty body — every field is optional', async () => {
    await expect(pipe.transform({}, meta)).resolves.toEqual({});
  });

  it('accepts name/nameAr/imageUrl/sortOrder together', async () => {
    await expect(
      pipe.transform({ name: 'New Name', nameAr: 'اسم جديد', imageUrl: 'https://cdn.example/x.png', sortOrder: 2 }, meta),
    ).resolves.toMatchObject({ name: 'New Name', sortOrder: 2 });
  });

  it.each([{ sortOrder: -1 }, { name: 123 }, { sortOrder: 'first' }])('rejects %j with a 400', async (body) => {
    await expect(pipe.transform(body, meta)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects sectorId — deliberately not re-parentable through this endpoint', async () => {
    await expect(pipe.transform({ sectorId: '11111111-1111-1111-1111-111111111111' }, meta)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects isActive — activation has its own dedicated endpoints', async () => {
    await expect(pipe.transform({ isActive: true }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });
});
