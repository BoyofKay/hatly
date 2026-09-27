import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpsertBusinessConfigDto } from './upsert-business-config.dto';
import { UpsertHatlyServicePricingConfigDto } from './upsert-hatly-service-pricing-config.dto';

// Same options as production (app.setup.ts). Regression: an undecorated `unknown` property is
// rejected by forbidNonWhitelisted, which made both admin config endpoints unusable over HTTP.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const meta = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({ type: 'body', metatype });

describe('business-config upsert DTOs under the production ValidationPipe', () => {
  it.each([[true], [0], [1500], ['DAILY'], [{ label: 'Wallet', phoneOrAccountNumber: '010' }], [[1, 2]]])(
    'accepts value %p of any JSON type',
    async (value) => {
      const out = await pipe.transform({ value }, meta(UpsertBusinessConfigDto));
      expect(out.value).toEqual(value);
    },
  );

  it('still rejects a missing or null value (the column is NOT NULL)', async () => {
    await expect(pipe.transform({}, meta(UpsertBusinessConfigDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ value: null }, meta(UpsertBusinessConfigDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still rejects unknown properties', async () => {
    await expect(pipe.transform({ value: 1, extra: 1 }, meta(UpsertBusinessConfigDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts an opaque pricing config with or without isActive', async () => {
    const out = await pipe.transform({ config: { any: ['shape'] }, isActive: true }, meta(UpsertHatlyServicePricingConfigDto));
    expect(out.config).toEqual({ any: ['shape'] });
    await expect(pipe.transform({ isActive: false }, meta(UpsertHatlyServicePricingConfigDto))).resolves.toBeDefined();
    await expect(pipe.transform({ config: 1, bogus: 1 }, meta(UpsertHatlyServicePricingConfigDto))).rejects.toBeInstanceOf(BadRequestException);
  });
});
